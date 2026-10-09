import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import { z } from "zod";
import { Document, DOC_TYPES, OWNER_TYPES } from "../../models/Document.js";
import { Organization } from "../../models/Organization.js";
import { protect, requirePermission, orgScope } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import { badRequest, forbidden, notFound } from "../../utils/errors.js";
import { escapeRegex, meta, pageQuery } from "../../utils/pagination.js";
import { audit } from "../../models/AuditLog.js";
import { can } from "../../utils/permissions.js";
import * as storage from "./storage.js";
import { safeName, sniff } from "./sniff.js";
import {
  DAY,
  OWNER_PERMS,
  expiryStatus,
  ownerExists,
  soonWindow,
  syncOwnerFields,
} from "./documents.service.js";

const r = Router();
r.use(protect);
const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const meta_ = z.object({
  ownerType: z.enum(OWNER_TYPES),
  owner: id.optional(),
  type: z.enum(DOC_TYPES),
  title: z.string().trim().max(120).optional(),
  number: z.string().trim().max(60).optional(),
  issueDate: z.coerce.date().optional(),
  expiryDate: z.coerce.date().optional(),
  notes: z.string().max(1000).optional(),
});
// multipart fields arrive as strings; blank strings mean "not provided"
const blankToUndef = (o) =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== "" && v != null),
  );

const guard = (req, ownerType, kind) => {
  const perm = OWNER_PERMS[ownerType][kind === "read" ? 0 : 1];
  if (!can(req.user.role, perm)) throw forbidden("Insufficient permissions");
};

const present = (d, soonDays) => {
  const o = d.toObject ? d.toObject() : d;
  delete o.file?.storageKey;
  return { ...o, expiryStatus: expiryStatus(o.expiryDate, soonDays) };
};

function checkDates(b) {
  if (b.issueDate && b.expiryDate && b.expiryDate < b.issueDate)
    throw badRequest("Expiry date is before the issue date");
}

async function readFile(req) {
  if (!req.file) return null;
  const kind = sniff(req.file.buffer);
  if (!kind) throw badRequest("Only PDF, JPEG, PNG or WebP files are allowed");
  const key = await storage.put(req.user.organization, req.file.buffer);
  return {
    storageKey: key,
    originalName: safeName(req.file.originalname),
    mimeType: kind.mime,
    size: req.file.size,
    sha256: crypto.createHash("sha256").update(req.file.buffer).digest("hex"),
  };
}

// ---- reminder intervals ------------------------------------------------------------------
r.get(
  "/settings/reminders",
  requirePermission("vehicles:read"),
  ah(async (req, res) => {
    res.json({
      success: true,
      data: { days: (await soonWindow(req.user.organization)).days },
    });
  }),
);
r.put(
  "/settings/reminders",
  requirePermission("settings:write"),
  validate(
    z.object({ days: z.array(z.number().int().min(1).max(365)).min(1).max(6) }),
  ),
  ah(async (req, res) => {
    const days = [...new Set(req.body.days)].sort((a, b) => b - a);
    await Organization.updateOne(
      { _id: req.user.organization },
      { docReminderDays: days },
    );
    await audit(
      req,
      "documents.reminders",
      "Organization",
      req.user.organization,
      { days },
    );
    res.json({ success: true, data: { days } });
  }),
);

// ---- dashboard counts --------------------------------------------------------------------
r.get(
  "/summary",
  requirePermission("vehicles:read"),
  ah(async (req, res) => {
    const { soonDays } = await soonWindow(req.user.organization);
    const now = new Date();
    const base = {
      ...orgScope(req),
      archivedAt: null,
      ownerType: { $in: ["vehicle", "driver", "organization"] },
    };
    const [expired, expiring, valid, awaiting] = await Promise.all([
      Document.countDocuments({ ...base, expiryDate: { $lt: now } }),
      Document.countDocuments({
        ...base,
        expiryDate: { $gte: now, $lte: new Date(+now + soonDays * DAY) },
      }),
      Document.countDocuments({
        ...base,
        $or: [
          { expiryDate: { $gt: new Date(+now + soonDays * DAY) } },
          { expiryDate: null },
        ],
      }),
      Document.countDocuments({ ...base, verification: "pending" }),
    ]);
    res.json({
      success: true,
      data: {
        expired,
        expiringSoon: expiring,
        valid,
        awaitingVerification: awaiting,
        soonDays,
      },
    });
  }),
);

const listQuery = pageQuery.extend({
  ownerType: z.enum(OWNER_TYPES).optional(),
  owner: id.optional(),
  type: z.enum(DOC_TYPES).optional(),
  status: z.enum(["expired", "expiring_soon", "valid"]).optional(),
  verification: z.enum(["pending", "verified", "rejected"]).optional(),
});
r.get(
  "/",
  validate(listQuery, "query"),
  ah(async (req, res) => {
    const q = req.query;
    // Listing across owner types requires read access to each; filter to what the caller may see.
    const allowed = OWNER_TYPES.filter((t) =>
      can(req.user.role, OWNER_PERMS[t][0]),
    );
    if (q.ownerType && !allowed.includes(q.ownerType))
      throw forbidden("Insufficient permissions");
    const { soonDays } = await soonWindow(req.user.organization);
    const filter = {
      ...orgScope(req),
      archivedAt: null,
      ownerType: q.ownerType ?? { $in: allowed },
    };
    if (q.owner) filter.owner = q.owner;
    if (q.type) filter.type = q.type;
    if (q.verification) filter.verification = q.verification;
    const now = new Date(),
      soon = new Date(+now + soonDays * DAY);
    if (q.status === "expired") filter.expiryDate = { $lt: now };
    if (q.status === "expiring_soon")
      filter.expiryDate = { $gte: now, $lte: soon };
    if (q.status === "valid")
      filter.$or = [{ expiryDate: { $gt: soon } }, { expiryDate: null }];
    if (q.search) {
      const rx = new RegExp(escapeRegex(q.search), "i");
      filter.$and = [
        { $or: [{ number: rx }, { title: rx }, { "file.originalName": rx }] },
      ];
    }
    const [items, total] = await Promise.all([
      Document.find(filter)
        .sort({ expiryDate: 1, createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      Document.countDocuments(filter),
    ]);
    // Resolve owner display names in two queries rather than per row.
    const names = await ownerNames(req.user.organization, items);
    res.json({
      success: true,
      data: items.map((d) => ({
        ...present(d, soonDays),
        ownerName: names.get(String(d.owner)),
      })),
      meta: meta(q.page, q.limit, total),
    });
  }),
);

async function ownerNames(org, docs) {
  const { Vehicle } = await import("../../models/Vehicle.js");
  const { Driver } = await import("../../models/Driver.js");
  const ids = (t) => docs.filter((d) => d.ownerType === t).map((d) => d.owner);
  const [v, dr] = await Promise.all([
    Vehicle.find({ organization: org, _id: { $in: ids("vehicle") } })
      .select("registrationNumber")
      .lean(),
    Driver.find({ organization: org, _id: { $in: ids("driver") } })
      .select("name")
      .lean(),
  ]);
  return new Map([
    ...v.map((x) => [String(x._id), x.registrationNumber]),
    ...dr.map((x) => [String(x._id), x.name]),
  ]);
}

r.post(
  "/",
  upload.single("file"),
  ah(async (req, res) => {
    const parsed = meta_.safeParse(blankToUndef(req.body));
    if (!parsed.success)
      throw badRequest(
        "Validation failed",
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      );
    const b = parsed.data;
    guard(req, b.ownerType, "write");
    if (!req.file) throw badRequest("A file is required");
    if (b.ownerType !== "organization" && !b.owner)
      throw badRequest("Owner is required");
    if (!(await ownerExists(req.user.organization, b.ownerType, b.owner)))
      throw notFound("Owner not found");
    checkDates(b);
    const file = await readFile(req);
    let doc;
    try {
      doc = await Document.create({
        ...b,
        ...orgScope(req),
        file,
        uploadedBy: req.user._id,
      });
    } catch (e) {
      await storage.remove(file.storageKey); // don't leave an orphaned file behind
      throw e;
    }
    await syncOwnerFields(doc);
    await audit(req, "document.upload", "Document", doc.id, {
      type: b.type,
      ownerType: b.ownerType,
    });
    const { soonDays } = await soonWindow(req.user.organization);
    res.status(201).json({ success: true, data: present(doc, soonDays) });
  }),
);

async function load(req, kind) {
  const doc = await Document.findOne({
    _id: req.params.id,
    ...orgScope(req),
    archivedAt: null,
  }).select("+file.storageKey");
  if (!doc) throw notFound("Document not found");
  guard(req, doc.ownerType, kind);
  return doc;
}

r.get(
  "/:id",
  ah(async (req, res) => {
    const doc = await load(req, "read");
    const { soonDays } = await soonWindow(req.user.organization);
    res.json({ success: true, data: present(doc, soonDays) });
  }),
);

// Authorized download. No public URL ever exists for a file.
r.get(
  "/:id/file",
  ah(async (req, res) => {
    const doc = await load(req, "read");
    if (!(await storage.exists(doc.file.storageKey)))
      throw notFound("File is missing from storage");
    res.setHeader("Content-Type", doc.file.mimeType);
    res.setHeader("Content-Length", doc.file.size);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.setHeader("Cache-Control", "private, no-store");
    const name = encodeURIComponent(doc.file.originalName ?? "document");
    res.setHeader(
      "Content-Disposition",
      `${req.query.download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${name}`,
    );
    await audit(req, "document.download", "Document", doc.id);
    storage
      .stream(doc.file.storageKey)
      .on("error", () => res.destroy())
      .pipe(res);
  }),
);

r.put(
  "/:id",
  upload.single("file"),
  ah(async (req, res) => {
    const doc = await load(req, "write");
    const parsed = meta_
      .pick({
        type: true,
        title: true,
        number: true,
        issueDate: true,
        expiryDate: true,
        notes: true,
      })
      .partial()
      .safeParse(blankToUndef(req.body));
    if (!parsed.success)
      throw badRequest(
        "Validation failed",
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      );
    const merged = {
      issueDate: doc.issueDate,
      expiryDate: doc.expiryDate,
      ...parsed.data,
    };
    checkDates(merged);
    const changedKey = ["type", "number", "issueDate", "expiryDate"].some(
      (k) =>
        parsed.data[k] != null && String(parsed.data[k]) !== String(doc[k]),
    );
    const file = await readFile(req);
    const oldKey = doc.file.storageKey;
    doc.set(parsed.data);
    if (file) doc.file = file;
    // Any change to what the document says (or its file) must be verified again.
    if (file || changedKey) {
      doc.verification = "pending";
      doc.verifiedBy = undefined;
      doc.verifiedAt = undefined;
      doc.verificationNote = undefined;
    }
    await doc.save();
    if (file) await storage.remove(oldKey);
    await syncOwnerFields(doc);
    await audit(req, "document.update", "Document", doc.id);
    const { soonDays } = await soonWindow(req.user.organization);
    res.json({ success: true, data: present(doc, soonDays) });
  }),
);

r.post(
  "/:id/verify",
  requirePermission("documents:verify"),
  validate(
    z.object({
      decision: z.enum(["verified", "rejected"]),
      note: z.string().trim().max(500).optional(),
    }),
  ),
  ah(async (req, res) => {
    const doc = await load(req, "read");
    if (req.body.decision === "rejected" && !req.body.note)
      throw badRequest("Give a reason for rejecting");
    Object.assign(doc, {
      verification: req.body.decision,
      verifiedBy: req.user._id,
      verifiedAt: new Date(),
      verificationNote: req.body.note,
    });
    await doc.save();
    await syncOwnerFields(doc);
    await audit(req, "document.verify", "Document", doc.id, {
      decision: req.body.decision,
    });
    const { soonDays } = await soonWindow(req.user.organization);
    res.json({ success: true, data: present(doc, soonDays) });
  }),
);

// Archive only; the file stays in storage for audit purposes.
r.delete(
  "/:id",
  ah(async (req, res) => {
    const doc = await load(req, "write");
    doc.archivedAt = new Date();
    await doc.save();
    await audit(req, "document.archive", "Document", doc.id);
    res.json({ success: true });
  }),
);

export default r;
