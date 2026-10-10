import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { User } from "../../models/User.js";
import { Driver } from "../../models/Driver.js";
import { protect, requirePermission, orgScope } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "../../utils/errors.js";
import { meta, pageQuery, escapeRegex } from "../../utils/pagination.js";
import { ROLES, ROLE_PERMISSIONS } from "../../utils/permissions.js";
import { audit } from "../../models/AuditLog.js";
import {
  issueToken,
  sendSecurityEmail,
} from "../auth/passwordReset.service.js";

const r = Router();
r.use(protect, requirePermission("users:write"));
const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const phone = z
  .string()
  .trim()
  .regex(/^\+?\d[\d\s-]{7,15}$/, "Invalid phone number");
const PRIVILEGED = ["owner", "admin"];
const sanitize = (u) => ({
  _id: u._id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: u.role,
  status: u.status,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
  driver: u.driver ?? null,
});

/** Only owners may create, change or deactivate owner/admin accounts. Admins manage everyone else. */
function assertCanManage(actor, targetRole, newRole) {
  const touchesPrivileged =
    PRIVILEGED.includes(targetRole) ||
    (newRole && PRIVILEGED.includes(newRole));
  if (touchesPrivileged && actor.role !== "owner")
    throw forbidden("Only an owner can manage owner and admin accounts");
}

async function activeOwners(org, exceptId) {
  return User.countDocuments({
    organization: org,
    role: "owner",
    status: "active",
    ...(exceptId && { _id: { $ne: exceptId } }),
  });
}

async function inviteLink(req, user, { purpose }) {
  const { link } = await issueToken(user._id, {
    purpose,
    ttlMinutes: purpose === "invite" ? 7 * 24 * 60 : 60,
  });
  const mail = await sendSecurityEmail({
    org: user.organization,
    to: user.email,
    name: user.name,
    subject:
      purpose === "invite"
        ? "You've been invited to Nest Transport"
        : "Reset your Nest Transport password",
    body:
      purpose === "invite"
        ? `Hi ${user.name},\n\nAn account was created for you. Set your password here (valid for 7 days):\n${link}`
        : `Hi ${user.name},\n\nAn administrator started a password reset for you. Choose a new password here (valid for 60 minutes):\n${link}`,
  });
  return {
    link,
    emailed: mail.sent,
    emailNote: mail.sent ? undefined : mail.reason,
  };
}

const listQuery = pageQuery.extend({
  role: z.enum(ROLES).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
r.get(
  "/",
  validate(listQuery, "query"),
  ah(async (req, res) => {
    const q = req.query;
    const filter = { ...orgScope(req) };
    if (q.role) filter.role = q.role;
    if (q.status) filter.status = q.status;
    if (q.search) {
      const rx = new RegExp(escapeRegex(q.search), "i");
      filter.$or = [{ name: rx }, { email: rx }];
    }
    const [items, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      User.countDocuments(filter),
    ]);
    const links = await Driver.find({
      organization: req.user.organization,
      user: { $in: items.map((u) => u._id) },
    })
      .select("name user")
      .lean();
    const by = new Map(
      links.map((d) => [String(d.user), { _id: d._id, name: d.name }]),
    );
    res.json({
      success: true,
      data: items.map((u) => sanitize({ ...u, driver: by.get(String(u._id)) })),
      meta: meta(q.page, q.limit, total),
    });
  }),
);

r.get(
  "/roles",
  ah(async (_req, res) => {
    res.json({
      success: true,
      data: ROLES.map((role) => ({
        role,
        permissions: ROLE_PERMISSIONS[role],
      })),
    });
  }),
);

const createBody = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  phone: phone.optional(),
  role: z.enum(ROLES),
  driver: id.optional(), // link to an existing staff profile
});
r.post(
  "/",
  validate(createBody),
  ah(async (req, res) => {
    const b = req.body;
    assertCanManage(req.user, null, b.role);
    if (await User.exists({ email: b.email.toLowerCase() }))
      throw conflict("That email is already registered");
    let driver = null;
    if (b.driver) {
      driver = await Driver.findOne({
        _id: b.driver,
        ...orgScope(req),
        archivedAt: null,
      });
      if (!driver) throw notFound("Driver profile not found");
      if (driver.user) throw conflict("That profile already has a login");
    }
    // Nobody knows this password: the person sets their own through the emailed/copied link.
    const user = await User.create({
      organization: req.user.organization,
      name: b.name,
      email: b.email,
      phone: b.phone,
      role: b.role,
      password: await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10),
    });
    if (driver) {
      driver.user = user._id;
      await driver.save();
    }
    const invite = await inviteLink(req, user, { purpose: "invite" });
    await audit(req, "user.create", "User", user.id, { role: b.role });
    res
      .status(201)
      .json({
        success: true,
        data: sanitize({
          ...user.toObject(),
          driver: driver && { _id: driver._id, name: driver.name },
        }),
        invite,
      });
  }),
);

const updateBody = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  phone: phone.optional().or(z.literal("").transform(() => null)),
  role: z.enum(ROLES).optional(),
});
r.put(
  "/:id",
  validate(updateBody),
  ah(async (req, res) => {
    const user = await User.findOne({ _id: req.params.id, ...orgScope(req) });
    if (!user) throw notFound("User not found");
    const { role, ...rest } = req.body;
    if (role && role !== user.role) {
      assertCanManage(req.user, user.role, role);
      if (String(user._id) === String(req.user._id))
        throw forbidden("You can't change your own role");
      if (
        user.role === "owner" &&
        (await activeOwners(req.user.organization, user._id)) === 0
      )
        throw conflict("The organization needs at least one active owner");
      user.role = role;
      user.tokenVersion += 1; // permissions changed: old sessions must re-authenticate
    } else assertCanManage(req.user, user.role);
    Object.assign(user, rest);
    await user.save();
    await audit(req, "user.update", "User", user.id, { role });
    res.json({ success: true, data: sanitize(user) });
  }),
);

r.patch(
  "/:id/status",
  validate(z.object({ status: z.enum(["active", "inactive"]) })),
  ah(async (req, res) => {
    const user = await User.findOne({ _id: req.params.id, ...orgScope(req) });
    if (!user) throw notFound("User not found");
    assertCanManage(req.user, user.role);
    if (String(user._id) === String(req.user._id))
      throw forbidden("You can't deactivate your own account");
    if (
      req.body.status === "inactive" &&
      user.role === "owner" &&
      (await activeOwners(req.user.organization, user._id)) === 0
    )
      throw conflict("The organization needs at least one active owner");
    user.status = req.body.status;
    if (req.body.status === "inactive") user.tokenVersion += 1; // ends their sessions immediately
    await user.save();
    await audit(req, "user.status", "User", user.id, {
      status: req.body.status,
    });
    res.json({ success: true, data: sanitize(user) });
  }),
);

// Admin-initiated reset: returns a one-time link (and emails it when email is configured).
r.post(
  "/:id/reset-link",
  ah(async (req, res) => {
    const user = await User.findOne({
      _id: req.params.id,
      ...orgScope(req),
      status: "active",
    });
    if (!user) throw notFound("User not found");
    assertCanManage(req.user, user.role);
    const out = await inviteLink(req, user, { purpose: "reset" });
    await audit(req, "user.reset_link", "User", user.id);
    res.json({ success: true, data: out });
  }),
);

// Link / unlink a login to a driver or attendant profile (needed for them to use the mobile app).
r.put(
  "/:id/driver-link",
  validate(z.object({ driver: id.nullable() })),
  ah(async (req, res) => {
    const user = await User.findOne({ _id: req.params.id, ...orgScope(req) });
    if (!user) throw notFound("User not found");
    await Driver.updateMany(
      { ...orgScope(req), user: user._id },
      { user: null },
    );
    if (req.body.driver) {
      const d = await Driver.findOne({
        _id: req.body.driver,
        ...orgScope(req),
        archivedAt: null,
      });
      if (!d) throw notFound("Driver profile not found");
      if (d.user && String(d.user) !== String(user._id))
        throw conflict("That profile is already linked to another login");
      d.user = user._id;
      await d.save();
    }
    await audit(req, "user.driver_link", "User", user.id, {
      driver: req.body.driver,
    });
    res.json({ success: true });
  }),
);

export default r;
