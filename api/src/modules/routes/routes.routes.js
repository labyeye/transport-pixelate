import { Router } from "express";
import { z } from "zod";
import { Route } from "../../models/Route.js";
import { Vehicle } from "../../models/Vehicle.js";
import { Driver } from "../../models/Driver.js";
import { protect, requirePermission, orgScope } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import { conflict, notFound, badRequest } from "../../utils/errors.js";
import { escapeRegex, meta, pageQuery } from "../../utils/pagination.js";
import { audit } from "../../models/AuditLog.js";

const r = Router();
r.use(protect);

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");
const stopBody = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(300).optional(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  plannedArrival: hhmm.optional(),
  plannedDeparture: hhmm.optional(),
  dwellMinutes: z.coerce.number().min(0).max(240).default(0),
  allowsPickup: z.boolean().default(true),
  allowsDropoff: z.boolean().default(true),
  active: z.boolean().default(true),
});

const routeBody = z.object({
  name: z.string().trim().min(2).max(120),
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, "Letters, digits, - and _ only"),
  description: z.string().max(500).optional(),
  category: z.string().trim().max(40).default("regular"),
  branch: z.string().trim().max(80).optional(),
  stops: z.array(stopBody).max(100).default([]),
  plannedDistanceKm: z.coerce.number().min(0).max(5000).optional(),
  estimatedDurationMin: z.coerce.number().min(0).max(1440).optional(),
  operatingDays: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .default([1, 2, 3, 4, 5]),
  startTime: hhmm.optional(),
  endTime: hhmm.optional(),
  assignedVehicle: z.string().nullable().optional(),
  assignedDriver: z.string().nullable().optional(),
});

// Stops are stored in submitted order; sequence is derived server-side so clients can't create gaps.
const toStops = (stops) =>
  stops.map((s, i) => ({
    name: s.name,
    address: s.address,
    location: { lat: s.lat, lng: s.lng },
    sequence: i + 1,
    plannedArrival: s.plannedArrival,
    plannedDeparture: s.plannedDeparture,
    dwellMinutes: s.dwellMinutes,
    allowsPickup: s.allowsPickup,
    allowsDropoff: s.allowsDropoff,
    active: s.active,
  }));

function checkTimes(b) {
  if (b.startTime && b.endTime && b.endTime <= b.startTime)
    throw badRequest("End time must be after start time");
  let prev = "";
  for (const s of b.stops ?? []) {
    if (
      s.plannedArrival &&
      s.plannedDeparture &&
      s.plannedDeparture < s.plannedArrival
    )
      throw badRequest(`Stop "${s.name}": departure is before arrival`);
    if (s.plannedArrival) {
      if (prev && s.plannedArrival < prev)
        throw badRequest(
          `Stop "${s.name}": arrival is earlier than the previous stop`,
        );
      prev = s.plannedDeparture ?? s.plannedArrival;
    }
  }
}

// Resolve optional vehicle/driver references inside the caller's organization only.
async function resolveRefs(req, b) {
  const out = {};
  if (b.assignedVehicle !== undefined) {
    if (b.assignedVehicle === null) out.assignedVehicle = null;
    else {
      const v = await Vehicle.findOne({
        _id: b.assignedVehicle,
        ...orgScope(req),
        archivedAt: null,
      });
      if (!v) throw notFound("Vehicle not found");
      if (["maintenance", "out_of_service", "inactive"].includes(v.status))
        throw conflict("Vehicle is not available for assignment");
      out.assignedVehicle = v._id;
    }
  }
  if (b.assignedDriver !== undefined) {
    if (b.assignedDriver === null) out.assignedDriver = null;
    else {
      const d = await Driver.findOne({
        _id: b.assignedDriver,
        ...orgScope(req),
        archivedAt: null,
      });
      if (!d) throw notFound("Driver not found");
      if (["suspended", "inactive", "on_leave"].includes(d.status))
        throw conflict("Driver is not available for assignment");
      out.assignedDriver = d._id;
    }
  }
  return out;
}

const listQuery = pageQuery.extend({
  active: z.enum(["true", "false"]).optional(),
  category: z.string().optional(),
});

r.get(
  "/",
  requirePermission("routes:read"),
  validate(listQuery, "query"),
  ah(async (req, res) => {
    const q = req.query;
    const filter = { ...orgScope(req), archivedAt: null };
    if (q.active) filter.active = q.active === "true";
    if (q.category) filter.category = q.category;
    if (q.search) {
      const rx = new RegExp(escapeRegex(q.search), "i");
      filter.$or = [{ name: rx }, { code: rx }];
    }
    const [items, total] = await Promise.all([
      Route.find(filter)
        .populate("assignedVehicle", "registrationNumber")
        .populate("assignedDriver", "name")
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      Route.countDocuments(filter),
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
  requirePermission("routes:write"),
  validate(routeBody),
  ah(async (req, res) => {
    const b = req.body;
    checkTimes(b);
    if (
      await Route.exists({
        ...orgScope(req),
        code: b.code.toUpperCase(),
        archivedAt: null,
      })
    )
      throw conflict("A route with this code already exists");
    const refs = await resolveRefs(req, b);
    const { stops, assignedVehicle, assignedDriver, ...rest } = b;
    const route = await Route.create({
      ...rest,
      ...refs,
      stops: toStops(stops),
      ...orgScope(req),
      active: false,
    });
    await audit(req, "route.create", "Route", route.id);
    res.status(201).json({ success: true, data: route });
  }),
);

r.get(
  "/:id",
  requirePermission("routes:read"),
  ah(async (req, res) => {
    const route = await Route.findOne({ _id: req.params.id, ...orgScope(req) })
      .populate("assignedVehicle", "registrationNumber")
      .populate("assignedDriver", "name phone");
    if (!route) throw notFound("Route not found");
    res.json({ success: true, data: route });
  }),
);

r.put(
  "/:id",
  requirePermission("routes:write"),
  validate(routeBody),
  ah(async (req, res) => {
    const b = req.body;
    checkTimes(b);
    const route = await Route.findOne({
      _id: req.params.id,
      ...orgScope(req),
      archivedAt: null,
    });
    if (!route) throw notFound("Route not found");
    if (
      b.code.toUpperCase() !== route.code &&
      (await Route.exists({
        ...orgScope(req),
        code: b.code.toUpperCase(),
        archivedAt: null,
        _id: { $ne: route._id },
      }))
    )
      throw conflict("A route with this code already exists");
    if (route.active && b.stops.filter((s) => s.active).length < 2)
      throw conflict("An active route needs at least 2 active stops");
    const refs = await resolveRefs(req, b);
    const { stops, assignedVehicle, assignedDriver, ...rest } = b;
    route.set({ ...rest, ...refs, stops: toStops(stops) });
    route.version += 1; // trips created later snapshot this version; existing trips keep theirs
    await route.save();
    await audit(req, "route.update", "Route", route.id, {
      version: route.version,
    });
    res.json({ success: true, data: route });
  }),
);

r.patch(
  "/:id/active",
  requirePermission("routes:write"),
  validate(z.object({ active: z.boolean() })),
  ah(async (req, res) => {
    const route = await Route.findOne({
      _id: req.params.id,
      ...orgScope(req),
      archivedAt: null,
    });
    if (!route) throw notFound("Route not found");
    if (req.body.active && route.stops.filter((s) => s.active).length < 2)
      throw conflict("Add at least 2 active stops before activating");
    route.active = req.body.active;
    await route.save();
    await audit(req, "route.active", "Route", route.id, {
      active: route.active,
    });
    res.json({ success: true, data: route });
  }),
);

r.post(
  "/:id/duplicate",
  requirePermission("routes:write"),
  validate(
    z.object({
      code: z
        .string()
        .trim()
        .min(1)
        .max(20)
        .regex(/^[A-Za-z0-9_-]+$/),
      name: z.string().trim().min(2).max(120).optional(),
    }),
  ),
  ah(async (req, res) => {
    const src = await Route.findOne({
      _id: req.params.id,
      ...orgScope(req),
      archivedAt: null,
    });
    if (!src) throw notFound("Route not found");
    const code = req.body.code.toUpperCase();
    if (await Route.exists({ ...orgScope(req), code, archivedAt: null }))
      throw conflict("A route with this code already exists");
    const o = src.toObject();
    delete o._id;
    delete o.createdAt;
    delete o.updatedAt;
    o.stops = o.stops.map(({ _id, ...s }) => s);
    const copy = await Route.create({
      ...o,
      code,
      name: req.body.name ?? `${src.name} (copy)`,
      active: false,
      assignedVehicle: null,
      assignedDriver: null,
      version: 1,
    });
    await audit(req, "route.duplicate", "Route", copy.id, { from: src.id });
    res.status(201).json({ success: true, data: copy });
  }),
);

r.delete(
  "/:id",
  requirePermission("routes:write"),
  ah(async (req, res) => {
    const route = await Route.findOne({
      _id: req.params.id,
      ...orgScope(req),
      archivedAt: null,
    });
    if (!route) throw notFound("Route not found");
    if (route.active) throw conflict("Deactivate the route before archiving");
    route.archivedAt = new Date();
    await route.save();
    await audit(req, "route.archive", "Route", route.id);
    res.json({ success: true });
  }),
);

export default r;
