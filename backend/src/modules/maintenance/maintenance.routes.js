import { Router } from "express";
import { z } from "zod";
import {
  Maintenance,
  MAINT_STATUSES,
  MAINT_TYPES,
} from "../../models/Maintenance.js";
import { Vehicle } from "../../models/Vehicle.js";
import { Trip, ACTIVE_STATUSES } from "../../models/Trip.js";
import { nextSeq } from "../../models/Counter.js";
import { protect, requirePermission, orgScope } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import { badRequest, conflict, notFound } from "../../utils/errors.js";
import { meta, pageQuery } from "../../utils/pagination.js";
import { audit } from "../../models/AuditLog.js";
import { emitToOrg } from "../../realtime.js";

const r = Router();
r.use(protect);
const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const TRANSITIONS = {
  reported: ["scheduled", "in_progress", "cancelled"],
  scheduled: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};
const TERMINAL = ["completed", "cancelled"];

const body = z.object({
  vehicle: id,
  type: z.enum(MAINT_TYPES),
  issue: z.string().trim().min(3).max(200),
  description: z.string().max(2000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  scheduledDate: z.coerce.date().optional(),
  odometer: z.coerce.number().min(0).optional(),
  workshop: z.string().trim().max(120).optional(),
  parts: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        quantity: z.coerce.number().min(0).default(1),
        cost: z.coerce.number().min(0).default(0),
      }),
    )
    .max(50)
    .default([]),
  nextServiceDate: z.coerce.date().optional(),
  nextServiceOdometer: z.coerce.number().min(0).optional(),
  notes: z.string().max(2000).optional(),
  trip: id.optional(),
});

/** Put the vehicle out of service for the duration of the work. */
async function takeOffline(org, vehicleId) {
  const v = await Vehicle.findOne({ _id: vehicleId, organization: org });
  if (v.status === "on_trip")
    throw conflict(
      "The vehicle is on a trip. Abort or complete the trip before starting maintenance.",
    );
  if (["available", "assigned"].includes(v.status)) {
    v.status = "maintenance";
    await v.save();
  }
}
/** Bring it back only if nothing else is keeping it in the workshop. */
async function restoreIfIdle(org, vehicleId, exceptId) {
  const stillOpen = await Maintenance.exists({
    organization: org,
    vehicle: vehicleId,
    status: "in_progress",
    _id: { $ne: exceptId },
  });
  if (stillOpen) return;
  const v = await Vehicle.findOne({ _id: vehicleId, organization: org });
  if (v?.status === "maintenance") {
    v.status = v.assignedDriver ? "assigned" : "available";
    await v.save();
  }
}
const affectedTrips = (org, vehicleId) =>
  Trip.find({
    organization: org,
    vehicle: vehicleId,
    status: {
      $in: ACTIVE_STATUSES.filter(
        (s) => s !== "in_progress" && s !== "delayed",
      ),
    },
    scheduledDeparture: { $gte: new Date() },
  })
    .select("tripNumber scheduledDate scheduledDeparture status")
    .sort({ scheduledDeparture: 1 })
    .limit(50)
    .lean();

const listQuery = pageQuery.extend({
  status: z.enum(MAINT_STATUSES).optional(),
  vehicle: id.optional(),
  type: z.enum(MAINT_TYPES).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
});

r.get(
  "/",
  requirePermission("maintenance:read"),
  validate(listQuery, "query"),
  ah(async (req, res) => {
    const q = req.query;
    const filter = { ...orgScope(req) };
    for (const k of ["status", "vehicle", "type", "priority"])
      if (q[k]) filter[k] = q[k];
    const [items, total] = await Promise.all([
      Maintenance.find(filter)
        .populate("vehicle", "registrationNumber")
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      Maintenance.countDocuments(filter),
    ]);
    res.json({
      success: true,
      data: items,
      meta: meta(q.page, q.limit, total),
    });
  }),
);

// Service reminders: open work due soon, plus vehicles whose last completed service set a next date/odometer.
r.get(
  "/due",
  requirePermission("maintenance:read"),
  ah(async (req, res) => {
    const soon = new Date(Date.now() + 14 * 86400000);
    const [scheduled, completed, vehicles] = await Promise.all([
      Maintenance.find({
        ...orgScope(req),
        status: { $in: ["reported", "scheduled"] },
        scheduledDate: { $lte: soon },
      })
        .populate("vehicle", "registrationNumber")
        .lean(),
      Maintenance.aggregate([
        {
          $match: {
            organization: req.user.organization,
            status: "completed",
            $or: [
              { nextServiceDate: { $ne: null } },
              { nextServiceOdometer: { $ne: null } },
            ],
          },
        },
        { $sort: { serviceDate: -1 } },
        {
          $group: {
            _id: "$vehicle",
            nextServiceDate: { $first: "$nextServiceDate" },
            nextServiceOdometer: { $first: "$nextServiceOdometer" },
            number: { $first: "$number" },
          },
        },
      ]),
      Vehicle.find({ ...orgScope(req), archivedAt: null })
        .select("registrationNumber odometer")
        .lean(),
    ]);
    const byV = new Map(vehicles.map((v) => [String(v._id), v]));
    const services = completed.flatMap((c) => {
      const v = byV.get(String(c._id));
      if (!v) return [];
      const byDate = c.nextServiceDate && c.nextServiceDate <= soon;
      const byKm =
        c.nextServiceOdometer != null &&
        v.odometer >= c.nextServiceOdometer - 500;
      return byDate || byKm
        ? [
            {
              vehicle: v,
              basedOn: c.number,
              nextServiceDate: c.nextServiceDate,
              nextServiceOdometer: c.nextServiceOdometer,
              overdue:
                (c.nextServiceDate && c.nextServiceDate < new Date()) ||
                (c.nextServiceOdometer != null &&
                  v.odometer >= c.nextServiceOdometer),
            },
          ]
        : [];
    });
    res.json({ success: true, data: { scheduled, services } });
  }),
);

r.post(
  "/",
  requirePermission("maintenance:write"),
  validate(body),
  ah(async (req, res) => {
    const v = await Vehicle.findOne({
      _id: req.body.vehicle,
      ...orgScope(req),
      archivedAt: null,
    });
    if (!v) throw notFound("Vehicle not found");
    if (
      req.body.trip &&
      !(await Trip.exists({ _id: req.body.trip, ...orgScope(req) }))
    )
      throw notFound("Trip not found");
    const seq = await nextSeq(req.user.organization, "maintenance");
    const m = await Maintenance.create({
      ...req.body,
      ...orgScope(req),
      number: `MNT-${String(seq).padStart(5, "0")}`,
      reportedBy: req.user._id,
      status: req.body.scheduledDate ? "scheduled" : "reported",
    });
    await audit(req, "maintenance.create", "Maintenance", m.id);
    res.status(201).json({ success: true, data: m });
  }),
);

r.get(
  "/:id",
  requirePermission("maintenance:read"),
  ah(async (req, res) => {
    const m = await Maintenance.findOne({
      _id: req.params.id,
      ...orgScope(req),
    }).populate("vehicle", "registrationNumber status odometer");
    if (!m) throw notFound("Record not found");
    res.json({ success: true, data: m });
  }),
);

r.put(
  "/:id",
  requirePermission("maintenance:write"),
  validate(body.omit({ vehicle: true }).partial()),
  ah(async (req, res) => {
    const m = await Maintenance.findOne({
      _id: req.params.id,
      ...orgScope(req),
    });
    if (!m) throw notFound("Record not found");
    if (TERMINAL.includes(m.status))
      throw conflict(`A ${m.status} record can't be edited`);
    m.set(req.body);
    await m.save();
    await audit(req, "maintenance.update", "Maintenance", m.id);
    res.json({ success: true, data: m });
  }),
);

const transitionBody = z.object({
  to: z.enum(MAINT_STATUSES),
  serviceDate: z.coerce.date().optional(),
  cost: z.coerce.number().min(0).optional(),
  odometer: z.coerce.number().min(0).optional(),
  notes: z.string().max(1000).optional(),
});
r.post(
  "/:id/transition",
  requirePermission("maintenance:write"),
  validate(transitionBody),
  ah(async (req, res) => {
    const org = req.user.organization;
    const { to, serviceDate, cost, odometer, notes } = req.body;
    const m = await Maintenance.findOne({
      _id: req.params.id,
      ...orgScope(req),
    });
    if (!m) throw notFound("Record not found");
    if (!TRANSITIONS[m.status].includes(to))
      throw conflict(
        `Can't move from ${m.status.replace("_", " ")} to ${to.replace("_", " ")}`,
      );
    let warn = [];
    if (to === "in_progress") {
      await takeOffline(org, m.vehicle);
      m.startedAt = new Date();
      warn = await affectedTrips(org, m.vehicle);
    }
    if (to === "completed") {
      const finalCost = cost ?? m.cost;
      if (finalCost == null) throw badRequest("Enter the final cost");
      const od = odometer ?? m.odometer;
      const v = await Vehicle.findOne({ _id: m.vehicle, organization: org });
      if (od != null) {
        if (od < v.odometer - 1)
          throw badRequest(
            `Odometer ${od} is below the vehicle's current reading (${v.odometer})`,
          );
        if (od > v.odometer) {
          v.odometer = od;
          await v.save();
        }
        m.odometer = od;
      }
      m.cost = finalCost;
      m.serviceDate = serviceDate ?? new Date();
      if (m.serviceDate.getTime() > Date.now() + 86400000)
        throw badRequest("Service date is in the future");
    }
    if (notes) m.notes = m.notes ? `${m.notes}\n${notes}` : notes;
    const from = m.status;
    m.status = to;
    await m.save();
    if (to === "completed" || to === "cancelled")
      await restoreIfIdle(org, m.vehicle, m._id);
    emitToOrg(org, "vehicle:status", { vehicleId: String(m.vehicle) });
    await audit(req, "maintenance.transition", "Maintenance", m.id, {
      from,
      to,
    });
    res.json({ success: true, data: m, affectedTrips: warn });
  }),
);

export default r;
