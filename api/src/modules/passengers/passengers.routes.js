import { Router } from "express";
import { z } from "zod";
import { Passenger } from "../../models/Passenger.js";
import { PassengerAssignment } from "../../models/PassengerAssignment.js";
import { Route } from "../../models/Route.js";
import { protect, requirePermission, orgScope } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import { conflict, notFound } from "../../utils/errors.js";
import { escapeRegex, meta, pageQuery } from "../../utils/pagination.js";
import { audit } from "../../models/AuditLog.js";

const r = Router();
r.use(protect);
const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const phone = z
  .string()
  .trim()
  .regex(/^[+\d][\d\s-]{7,15}$/, "Invalid phone number");

const body = z.object({
  name: z.string().trim().min(2).max(100),
  kind: z.enum(["student", "employee", "other"]).default("student"),
  identifier: z.string().trim().max(40).optional(),
  grade: z.string().trim().max(40).optional(),
  phone: phone.optional(),
  guardian: z
    .object({
      name: z.string().trim().max(100).optional(),
      phone: phone.optional(),
    })
    .optional(),
  notes: z.string().max(500).optional(),
});
const listQuery = pageQuery.extend({
  route: id.optional(),
  kind: z.enum(["student", "employee", "other"]).optional(),
});

r.get(
  "/",
  requirePermission("passengers:read"),
  validate(listQuery, "query"),
  ah(async (req, res) => {
    const q = req.query;
    const filter = { ...orgScope(req), archivedAt: null };
    if (q.kind) filter.kind = q.kind;
    if (q.search) {
      const rx = new RegExp(escapeRegex(q.search), "i");
      filter.$or = [{ name: rx }, { identifier: rx }];
    }
    if (q.route) {
      const ids = await PassengerAssignment.find({
        ...orgScope(req),
        route: q.route,
        active: true,
      }).distinct("passenger");
      filter._id = { $in: ids };
    }
    const [items, total] = await Promise.all([
      Passenger.find(filter)
        .sort({ name: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      Passenger.countDocuments(filter),
    ]);
    const asg = await PassengerAssignment.find({
      ...orgScope(req),
      passenger: { $in: items.map((i) => i._id) },
      active: true,
    })
      .populate("route", "code name")
      .lean();
    const by = new Map();
    for (const a of asg)
      by.set(String(a.passenger), [...(by.get(String(a.passenger)) ?? []), a]);
    res.json({
      success: true,
      data: items.map((p) => ({
        ...p,
        assignments: by.get(String(p._id)) ?? [],
      })),
      meta: meta(q.page, q.limit, total),
    });
  }),
);

r.post(
  "/",
  requirePermission("passengers:write"),
  validate(body),
  ah(async (req, res) => {
    const p = await Passenger.create({ ...req.body, ...orgScope(req) });
    await audit(req, "passenger.create", "Passenger", p.id);
    res.status(201).json({ success: true, data: p });
  }),
);

r.put(
  "/:id",
  requirePermission("passengers:write"),
  validate(body),
  ah(async (req, res) => {
    const p = await Passenger.findOne({
      _id: req.params.id,
      ...orgScope(req),
      archivedAt: null,
    });
    if (!p) throw notFound("Passenger not found");
    p.set(req.body);
    await p.save();
    await audit(req, "passenger.update", "Passenger", p.id);
    res.json({ success: true, data: p });
  }),
);

r.delete(
  "/:id",
  requirePermission("passengers:write"),
  ah(async (req, res) => {
    const p = await Passenger.findOne({
      _id: req.params.id,
      ...orgScope(req),
      archivedAt: null,
    });
    if (!p) throw notFound("Passenger not found");
    p.archivedAt = new Date();
    p.active = false;
    await p.save();
    await PassengerAssignment.updateMany(
      { ...orgScope(req), passenger: p._id },
      { active: false },
    );
    await audit(req, "passenger.archive", "Passenger", p.id);
    res.json({ success: true });
  }),
);

// Assign a passenger to a route with pickup and drop stops (must be stops on that route).
const assignBody = z.object({
  route: id,
  pickupStop: z.string().trim().min(1),
  dropStop: z.string().trim().min(1),
});
r.post(
  "/:id/assignments",
  requirePermission("passengers:write"),
  validate(assignBody),
  ah(async (req, res) => {
    const p = await Passenger.findOne({
      _id: req.params.id,
      ...orgScope(req),
      archivedAt: null,
    });
    if (!p) throw notFound("Passenger not found");
    const route = await Route.findOne({
      _id: req.body.route,
      ...orgScope(req),
      archivedAt: null,
    });
    if (!route) throw notFound("Route not found");
    const find = (name) => route.stops.find((s) => s.active && s.name === name);
    const pick = find(req.body.pickupStop),
      drop = find(req.body.dropStop);
    if (!pick || !pick.allowsPickup)
      throw conflict("Pickup stop is not a pickup point on this route");
    if (!drop || !drop.allowsDropoff)
      throw conflict("Drop stop is not a drop-off point on this route");
    if (pick.sequence === drop.sequence)
      throw conflict("Pickup and drop stops must differ");
    if (pick.sequence > drop.sequence)
      throw conflict("Pickup stop must come before the drop stop");
    const existing = await PassengerAssignment.findOne({
      ...orgScope(req),
      passenger: p._id,
      route: route._id,
      active: true,
    });
    if (existing) {
      existing.set({ pickupStop: pick.name, dropStop: drop.name });
      await existing.save();
      return res.json({ success: true, data: existing });
    }
    const a = await PassengerAssignment.create({
      ...orgScope(req),
      passenger: p._id,
      route: route._id,
      pickupStop: pick.name,
      dropStop: drop.name,
    });
    await audit(req, "passenger.assign", "Passenger", p.id, {
      route: route.code,
    });
    res.status(201).json({ success: true, data: a });
  }),
);

r.delete(
  "/:id/assignments/:aid",
  requirePermission("passengers:write"),
  ah(async (req, res) => {
    const a = await PassengerAssignment.findOneAndUpdate(
      {
        _id: req.params.aid,
        passenger: req.params.id,
        ...orgScope(req),
        active: true,
      },
      { active: false },
    );
    if (!a) throw notFound("Assignment not found");
    res.json({ success: true });
  }),
);

export default r;
