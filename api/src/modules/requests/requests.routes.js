import { Router } from "express";
import { z } from "zod";
import {
  TransportRequest,
  REQUEST_STATUSES,
  REQUEST_TYPES,
} from "../../models/TransportRequest.js";
import { User } from "../../models/User.js";
import { nextSeq } from "../../models/Counter.js";
import { protect, requirePermission, orgScope } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "../../utils/errors.js";
import { meta, pageQuery } from "../../utils/pagination.js";
import { audit } from "../../models/AuditLog.js";
import { can } from "../../utils/permissions.js";
import { notify } from "../notifications/notify.service.js";
import { HANDLERS } from "./handlers.js";

const r = Router();
r.use(protect);
const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const isReviewer = (req) => can(req.user.role, "requests:review");
const isMine = (req, doc) =>
  String(doc.requester?._id ?? doc.requester) === String(req.user._id);

// Legal status moves; terminal states have none.
const NEXT = {
  submitted: ["under_review", "cancelled"],
  under_review: ["approved", "rejected", "cancelled"],
  approved: ["in_progress", "resolved"],
  in_progress: ["resolved"],
  rejected: [],
  resolved: [],
  cancelled: [],
};
const log = (doc, by, from, to, note) =>
  doc.history.push({ by, from, to, note });

async function load(req) {
  const doc = await TransportRequest.findOne({
    _id: req.params.id,
    ...orgScope(req),
  });
  if (!doc) throw notFound("Request not found");
  // Requesters see only their own; reviewers see all in the organization.
  if (!isReviewer(req) && !isMine(req, doc))
    throw notFound("Request not found");
  return doc;
}

const createBody = z.object({
  type: z.enum(REQUEST_TYPES),
  description: z.string().trim().min(5).max(1500),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  effectiveDate: z.coerce.date().optional(),
  branch: z.string().trim().max(80).optional(),
  payload: z.record(z.string(), z.any()).default({}),
});

const listQuery = pageQuery.extend({
  status: z.enum(REQUEST_STATUSES).optional(),
  type: z.enum(REQUEST_TYPES).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  scope: z.enum(["mine", "review"]).optional(),
});
r.get(
  "/",
  requirePermission("requests:create"),
  validate(listQuery, "query"),
  ah(async (req, res) => {
    const q = req.query;
    const filter = { ...orgScope(req) };
    if (!isReviewer(req) || q.scope === "mine") filter.requester = req.user._id;
    if (q.scope === "review")
      filter.status = { $in: ["submitted", "under_review"] };
    for (const k of ["status", "type", "priority"]) if (q[k]) filter[k] = q[k];
    if (q.search)
      filter.number = new RegExp(q.search.replace(/[^\w-]/g, ""), "i");
    const [items, total] = await Promise.all([
      TransportRequest.find(filter)
        .select("-history")
        .populate("requester", "name")
        .populate("reviewer", "name")
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      TransportRequest.countDocuments(filter),
    ]);
    res.json({
      success: true,
      data: items,
      meta: meta(q.page, q.limit, total),
    });
  }),
);

r.post(
  "/",
  requirePermission("requests:create"),
  validate(createBody),
  ah(async (req, res) => {
    const b = req.body;
    const h = HANDLERS[b.type];
    const parsed = h.schema.safeParse(b.payload);
    if (!parsed.success)
      throw badRequest(
        "Invalid request details",
        parsed.error.issues.map((i) => ({
          path: `payload.${i.path.join(".")}`,
          message: i.message,
        })),
      );
    const org = req.user.organization;
    // Refuse to file requests that point at things that don't exist (conflicts are judged at review time).
    const check = await h.validate(org, parsed.data);
    const bad = check.problems.filter((p) => p.code === "ref");
    if (bad.length) throw badRequest(bad[0].message);
    const seq = await nextSeq(org, "request");
    const doc = await TransportRequest.create({
      ...b,
      payload: parsed.data,
      related: h.related(parsed.data),
      organization: org,
      number: `REQ-${String(seq).padStart(5, "0")}`,
      requester: req.user._id,
      history: [{ by: req.user._id, to: "submitted" }],
    });
    notify("request_submitted", {
      org,
      link: "/requests",
      vars: {
        number: doc.number,
        requester: req.user.name,
        type: h.label,
        priority: doc.priority,
      },
      excludeUserId: req.user._id,
    });
    await audit(req, "request.create", "TransportRequest", doc.id, {
      type: b.type,
    });
    res.status(201).json({ success: true, data: doc });
  }),
);

r.get(
  "/:id",
  requirePermission("requests:create"),
  ah(async (req, res) => {
    const doc = await load(req);
    await doc.populate([
      { path: "requester", select: "name" },
      { path: "reviewer", select: "name" },
      { path: "history.by", select: "name" },
    ]);
    res.json({ success: true, data: doc });
  }),
);

// Dry run: what would approving this do, and does it still validate against today's schedules?
r.get(
  "/:id/preview",
  requirePermission("requests:review"),
  ah(async (req, res) => {
    const doc = await load(req);
    const h = HANDLERS[doc.type];
    const { problems, impact } = await h.validate(
      req.user.organization,
      doc.payload,
    );
    res.json({
      success: true,
      data: { canApply: problems.length === 0, problems, impact, auto: h.auto },
    });
  }),
);

r.post(
  "/:id/start-review",
  requirePermission("requests:review"),
  ah(async (req, res) => {
    const doc = await load(req);
    if (!NEXT[doc.status].includes("under_review"))
      throw conflict(
        `A ${doc.status.replace("_", " ")} request can't be taken for review`,
      );
    if (isMine(req, doc)) throw forbidden("You can't review your own request");
    const from = doc.status;
    Object.assign(doc, { status: "under_review", reviewer: req.user._id });
    log(doc, req.user._id, from, "under_review");
    await doc.save();
    res.json({ success: true, data: doc });
  }),
);

const reviewBody = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(500).optional(),
});
r.post(
  "/:id/review",
  requirePermission("requests:review"),
  validate(reviewBody),
  ah(async (req, res) => {
    const org = req.user.organization;
    const { decision, note } = req.body;
    const doc = await load(req);
    if (isMine(req, doc)) throw forbidden("You can't review your own request");
    if (doc.status !== "under_review")
      throw conflict(
        doc.status === "submitted"
          ? "Start the review first"
          : `This request is already ${doc.status.replace("_", " ")}`,
      );
    if (decision === "rejected" && !note)
      throw badRequest("Give a reason for rejecting");

    if (decision === "rejected") {
      Object.assign(doc, { status: "rejected", resolutionNotes: note });
      log(doc, req.user._id, "under_review", "rejected", note);
      await doc.save();
      notify("request_rejected", {
        org,
        link: "/requests",
        extra: [{ userId: doc.requester }],
        vars: { number: doc.number, reason: note },
      });
      await audit(req, "request.reject", "TransportRequest", doc.id);
      return res.json({ success: true, data: doc });
    }

    const h = HANDLERS[doc.type];
    // 1. Validate against the CURRENT state of trips, vehicles, drivers and routes. Nothing changes if this fails.
    const { problems } = await h.validate(org, doc.payload);
    if (problems.length) {
      doc.applyError = problems.map((p) => p.message).join("; ");
      await doc.save();
      throw conflict(
        "This request can't be applied as it stands",
        problems.map((p) => p.message),
      );
    }
    // 2. Claim atomically so two reviewers (or a double click) can never apply it twice.
    const claimed = await TransportRequest.findOneAndUpdate(
      { _id: doc._id, organization: org, status: "under_review" },
      { status: "approved" },
      { new: true },
    );
    if (!claimed)
      throw conflict("This request was just decided by someone else");
    // 3. Apply. If it fails, hand the request back to review rather than leaving it half-approved.
    let result;
    try {
      result = await h.apply(org, doc.payload, req.user._id);
    } catch (e) {
      await TransportRequest.updateOne(
        { _id: doc._id },
        { status: "under_review", applyError: e.message },
      );
      throw conflict(`Applying the change failed: ${e.message}`);
    }
    const final = h.auto ? "resolved" : "approved";
    Object.assign(claimed, {
      status: final,
      appliedChange: result,
      applyError: undefined,
      resolutionNotes: note,
    });
    log(claimed, req.user._id, "under_review", "approved", note);
    if (final === "resolved")
      log(claimed, req.user._id, "approved", "resolved", result);
    await claimed.save();
    notify("request_approved", {
      org,
      link: "/requests",
      extra: [{ userId: claimed.requester }],
      vars: { number: claimed.number, outcome: "approved", result },
    });
    await audit(req, "request.approve", "TransportRequest", claimed.id, {
      result,
    });
    res.json({ success: true, data: claimed });
  }),
);

// Manual follow-up after approval (e.g. special requirements).
r.post(
  "/:id/progress",
  requirePermission("requests:review"),
  validate(
    z.object({
      to: z.enum(["in_progress", "resolved"]),
      note: z.string().trim().max(500).optional(),
    }),
  ),
  ah(async (req, res) => {
    const doc = await load(req);
    if (!NEXT[doc.status].includes(req.body.to))
      throw conflict(
        `Can't move from ${doc.status.replace("_", " ")} to ${req.body.to.replace("_", " ")}`,
      );
    const from = doc.status;
    doc.status = req.body.to;
    if (req.body.note) doc.resolutionNotes = req.body.note;
    log(doc, req.user._id, from, req.body.to, req.body.note);
    await doc.save();
    res.json({ success: true, data: doc });
  }),
);

r.post(
  "/:id/cancel",
  requirePermission("requests:create"),
  ah(async (req, res) => {
    const doc = await load(req);
    if (!isMine(req, doc) && !isReviewer(req))
      throw forbidden("Only the requester or a reviewer can cancel");
    if (!NEXT[doc.status].includes("cancelled"))
      throw conflict(
        `A ${doc.status.replace("_", " ")} request can't be cancelled`,
      );
    const from = doc.status;
    doc.status = "cancelled";
    log(doc, req.user._id, from, "cancelled", req.body?.note);
    await doc.save();
    res.json({ success: true, data: doc });
  }),
);

export default r;
