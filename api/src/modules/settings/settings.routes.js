import { Router } from "express";
import { z } from "zod";
import { Organization } from "../../models/Organization.js";
import { AuditLog } from "../../models/AuditLog.js";
import { protect, requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import { badRequest } from "../../utils/errors.js";
import { meta, pageQuery } from "../../utils/pagination.js";
import { audit } from "../../models/AuditLog.js";

const r = Router();
r.use(protect);

const validTz = (tz) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

r.get(
  "/organization",
  requirePermission("vehicles:read"),
  ah(async (req, res) => {
    const o = await Organization.findById(req.user.organization).lean();
    res.json({
      success: true,
      data: {
        name: o.name,
        category: o.category,
        currency: o.currency,
        timezone: o.timezone,
        modules: o.modules,
        gpsRetentionDays: o.gpsRetentionDays,
        docReminderDays: o.docReminderDays,
      },
    });
  }),
);

const orgBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  category: z
    .enum(["school", "employee", "institution", "contractor", "other"])
    .optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code")
    .optional(),
  timezone: z.string().trim().optional(),
  gpsRetentionDays: z.coerce.number().int().min(7).max(730).optional(),
  modules: z
    .object({
      fuelExpenses: z.boolean(),
      passengerManifest: z.boolean(),
      billing: z.boolean(),
      parentAccess: z.boolean(),
    })
    .partial()
    .optional(),
});
r.put(
  "/organization",
  requirePermission("settings:write"),
  validate(orgBody),
  ah(async (req, res) => {
    const { modules, ...rest } = req.body;
    if (rest.timezone && !validTz(rest.timezone))
      throw badRequest("Unknown timezone");
    const set = { ...rest };
    for (const [k, v] of Object.entries(modules ?? {})) set[`modules.${k}`] = v;
    if (!Object.keys(set).length) throw badRequest("Nothing to change");
    const o = await Organization.findByIdAndUpdate(
      req.user.organization,
      { $set: set },
      { new: true },
    ).lean();
    await audit(
      req,
      "organization.update",
      "Organization",
      req.user.organization,
      req.body,
    );
    res.json({
      success: true,
      data: {
        name: o.name,
        category: o.category,
        currency: o.currency,
        timezone: o.timezone,
        modules: o.modules,
        gpsRetentionDays: o.gpsRetentionDays,
      },
    });
  }),
);

// Audit trail viewer (read-only; entries are never editable through the API).
const logQuery = pageQuery.extend({
  action: z.string().max(60).optional(),
  entity: z.string().max(40).optional(),
  actor: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
r.get(
  "/audit-logs",
  requirePermission("settings:write"),
  validate(logQuery, "query"),
  ah(async (req, res) => {
    const q = req.query;
    const filter = { organization: req.user.organization };
    if (q.action)
      filter.action = new RegExp(`^${q.action.replace(/[^\w.]/g, "")}`);
    if (q.entity) filter.entity = q.entity;
    if (q.actor) filter.actor = q.actor;
    if (q.from || q.to)
      filter.createdAt = {
        ...(q.from && { $gte: q.from }),
        ...(q.to && { $lte: q.to }),
      };
    const [items, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .populate("actor", "name email")
        .lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({
      success: true,
      data: items.map((l) => ({
        _id: l._id,
        at: l.createdAt,
        action: l.action,
        entity: l.entity,
        entityId: l.entityId,
        actor: l.actor ? { name: l.actor.name, email: l.actor.email } : null,
        ip: l.ip,
        meta: l.meta,
      })),
      meta: meta(q.page, q.limit, total),
    });
  }),
);

export default r;
