import { Router } from "express";
import { z } from "zod";
import { Alert, ALERT_TYPES } from "../../models/Alert.js";
import { Geofence } from "../../models/Geofence.js";
import { Organization } from "../../models/Organization.js";
import { protect, requirePermission, orgScope } from "../../middleware/auth.js";
import { requireFeature } from "../../middleware/requireModule.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import { notFound } from "../../utils/errors.js";
import { meta, pageQuery } from "../../utils/pagination.js";
import { audit } from "../../models/AuditLog.js";

const r = Router();
r.use(protect);
const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

// ---- Speed limit (one organization-wide value; null switches overspeed alerts off) -------------
r.get(
  "/settings",
  requirePermission("tracking:read"),
  ah(async (req, res) => {
    const o = await Organization.findById(req.user.organization).select(
      "speedLimitKmh",
    );
    res.json({ success: true, data: { speedLimitKmh: o.speedLimitKmh ?? null } });
  }),
);
r.put(
  "/settings",
  requirePermission("settings:write"),
  requireFeature("alerts"),
  validate(
    z.object({ speedLimitKmh: z.number().int().min(10).max(200).nullable() }),
  ),
  ah(async (req, res) => {
    await Organization.updateOne(
      { _id: req.user.organization },
      { speedLimitKmh: req.body.speedLimitKmh },
    );
    await audit(req, "alerts.speed_limit", "Organization", req.user.organization, req.body);
    res.json({ success: true, data: req.body });
  }),
);

// ---- Geofences ----------------------------------------------------------------------------------
const fenceBody = z.object({
  name: z.string().trim().min(1).max(80),
  center: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  radiusM: z.number().min(20).max(50000),
  alertOn: z.enum(["enter", "exit", "both"]).default("both"),
  active: z.boolean().default(true),
});
r.get(
  "/geofences",
  requirePermission("tracking:read"),
  ah(async (req, res) => {
    const items = await Geofence.find({ ...orgScope(req), archivedAt: null }).sort({ name: 1 });
    res.json({ success: true, data: items });
  }),
);
r.post(
  "/geofences",
  requirePermission("tracking:write"),
  requireFeature("alerts"),
  validate(fenceBody),
  ah(async (req, res) => {
    const g = await Geofence.create({ ...req.body, ...orgScope(req) });
    await audit(req, "geofence.create", "Geofence", g.id);
    res.status(201).json({ success: true, data: g });
  }),
);
r.put(
  "/geofences/:id",
  requirePermission("tracking:write"),
  requireFeature("alerts"),
  validate(fenceBody),
  ah(async (req, res) => {
    const g = await Geofence.findOneAndUpdate(
      { _id: req.params.id, ...orgScope(req), archivedAt: null },
      req.body,
      { new: true },
    );
    if (!g) throw notFound("Geofence not found");
    await audit(req, "geofence.update", "Geofence", g.id);
    res.json({ success: true, data: g });
  }),
);
r.delete(
  "/geofences/:id",
  requirePermission("tracking:write"),
  ah(async (req, res) => {
    const g = await Geofence.findOneAndUpdate(
      { _id: req.params.id, ...orgScope(req), archivedAt: null },
      { archivedAt: new Date(), active: false },
    );
    if (!g) throw notFound("Geofence not found");
    await audit(req, "geofence.archive", "Geofence", g.id);
    res.json({ success: true });
  }),
);

// ---- Alerts -------------------------------------------------------------------------------------
const listQuery = pageQuery.extend({
  type: z.enum(ALERT_TYPES).optional(),
  vehicle: id.optional(),
  open: z.enum(["true", "false"]).optional(), // true = not yet acknowledged
});
r.get(
  "/",
  requirePermission("tracking:read"),
  validate(listQuery, "query"),
  ah(async (req, res) => {
    const q = req.query;
    const filter = { ...orgScope(req) };
    if (q.type) filter.type = q.type;
    if (q.vehicle) filter.vehicle = q.vehicle;
    if (q.open) filter.acknowledgedAt = q.open === "true" ? null : { $ne: null };
    const [items, total] = await Promise.all([
      Alert.find(filter)
        .populate("vehicle", "registrationNumber")
        .sort({ at: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      Alert.countDocuments(filter),
    ]);
    res.json({ success: true, data: items, meta: meta(q.page, q.limit, total) });
  }),
);
r.post(
  "/:id/acknowledge",
  requirePermission("tracking:write"),
  ah(async (req, res) => {
    const a = await Alert.findOneAndUpdate(
      { _id: req.params.id, ...orgScope(req), acknowledgedAt: null },
      { acknowledgedAt: new Date(), acknowledgedBy: req.user._id },
      { new: true },
    );
    if (!a) throw notFound("Alert not found or already acknowledged");
    res.json({ success: true, data: a });
  }),
);

export default r;
