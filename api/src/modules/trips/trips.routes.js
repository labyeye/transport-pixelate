import { recordSystemEvent } from "../events/events.service.js";
import { Router } from "express";
import { z } from "zod";
import { Trip, TRIP_STATUSES } from "../../models/Trip.js";
import { Vehicle } from "../../models/Vehicle.js";
import { Driver } from "../../models/Driver.js";
import { Organization } from "../../models/Organization.js";
import { protect, requirePermission, orgScope } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import { badRequest, conflict, notFound } from "../../utils/errors.js";
import { meta, pageQuery } from "../../utils/pagination.js";
import { audit } from "../../models/AuditLog.js";
import { zonedToUtc } from "../../utils/time.js";
import {
  TRANSITIONS,
  EDITABLE,
  assertResources,
  createTrip,
  releaseResources,
} from "./trip.service.js";

const r = Router();
r.use(protect);

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const TYPES = ["morning", "afternoon", "outbound", "return", "custom"];

const tripBody = z.object({
  route: id,
  tripType: z.enum(TYPES).default("custom"),
  scheduledDate: ymd,
  departureTime: hhmm,
  durationMin: z.coerce.number().int().min(1).max(1440),
  vehicle: id.nullable().optional(),
  driver: id.nullable().optional(),
  attendant: id.nullable().optional(),
  notes: z.string().max(1000).optional(),
});

const orgTz = async (req) =>
  (await Organization.findById(req.user.organization).select("timezone"))
    .timezone;
const window = (b, tz) => {
  const start = zonedToUtc(b.scheduledDate, b.departureTime, tz);
  return { start, end: new Date(start.getTime() + b.durationMin * 60000) };
};

const listQuery = pageQuery.extend({
  status: z.enum(TRIP_STATUSES).optional(),
  date: ymd.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  route: id.optional(),
  vehicle: id.optional(),
  driver: id.optional(),
});

r.get(
  "/",
  requirePermission("trips:read"),
  validate(listQuery, "query"),
  ah(async (req, res) => {
    const q = req.query;
    const filter = { ...orgScope(req) };
    if (q.status) filter.status = q.status;
    if (q.date) filter.scheduledDate = q.date;
    else if (q.from || q.to)
      filter.scheduledDate = {
        ...(q.from && { $gte: q.from }),
        ...(q.to && { $lte: q.to }),
      };
    if (q.route) filter.route = q.route;
    if (q.vehicle) filter.vehicle = q.vehicle;
    if (q.driver) filter.driver = q.driver;
    if (q.search)
      filter.tripNumber = new RegExp(q.search.replace(/[^\w-]/g, ""), "i");
    const [items, total] = await Promise.all([
      Trip.find(filter)
        .select("-history -routeSnapshot.stops")
        .populate("vehicle", "registrationNumber")
        .populate("driver", "name")
        .populate("attendant", "name")
        .sort({ scheduledDeparture: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      Trip.countDocuments(filter),
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
  requirePermission("trips:write"),
  validate(tripBody),
  ah(async (req, res) => {
    const b = req.body;
    const { start, end } = window(b, await orgTz(req));
    const trip = await createTrip(req.user.organization, req.user._id, {
      ...b,
      scheduledDeparture: start,
      expectedArrival: end,
    });
    await recordSystemEvent(trip, "trip_created", { actor: req.user._id });
    if (trip.driver)
      await recordSystemEvent(trip, "driver_assigned", { actor: req.user._id });
    if (trip.vehicle)
      await recordSystemEvent(trip, "vehicle_assigned", {
        actor: req.user._id,
      });
    await audit(req, "trip.create", "Trip", trip.id);
    res.status(201).json({ success: true, data: trip });
  }),
);

r.get(
  "/:id",
  requirePermission("trips:read"),
  ah(async (req, res) => {
    const t = await Trip.findOne({ _id: req.params.id, ...orgScope(req) })
      .populate("vehicle", "registrationNumber status")
      .populate("driver", "name phone")
      .populate("attendant", "name phone")
      .populate("history.by", "name");
    if (!t) throw notFound("Trip not found");
    res.json({ success: true, data: t });
  }),
);

// Edit schedule/resources before the trip starts. Route cannot change (create a new trip instead).
r.put(
  "/:id",
  requirePermission("trips:write"),
  validate(tripBody.omit({ route: true })),
  ah(async (req, res) => {
    const b = req.body;
    const trip = await Trip.findOne({ _id: req.params.id, ...orgScope(req) });
    if (!trip) throw notFound("Trip not found");
    if (!EDITABLE.includes(trip.status))
      throw conflict(`A ${trip.status.replace("_", " ")} trip can't be edited`);
    const { start, end } = window(b, await orgTz(req));
    await assertResources(req.user.organization, {
      vehicle: b.vehicle,
      driver: b.driver,
      attendant: b.attendant,
      start,
      end,
      excludeId: trip._id,
    });
    const rescheduled =
      +start !== +trip.scheduledDeparture || +end !== +trip.expectedArrival;
    Object.assign(trip, {
      tripType: b.tripType,
      scheduledDate: b.scheduledDate,
      scheduledDeparture: start,
      expectedArrival: end,
      vehicle: b.vehicle ?? null,
      driver: b.driver ?? null,
      attendant: b.attendant ?? null,
      notes: b.notes,
    });
    const complete = trip.vehicle && trip.driver;
    const prev = trip.status;
    if (prev === "scheduled" && complete) trip.status = "assigned";
    if ((prev === "assigned" || prev === "ready") && !complete)
      trip.status = "scheduled";
    trip.history.push({
      by: req.user._id,
      action: rescheduled ? "rescheduled" : "updated",
      from: prev,
      to: trip.status,
    });
    await trip.save();
    await audit(req, "trip.update", "Trip", trip.id);
    res.json({ success: true, data: trip });
  }),
);

const transitionBody = z.object({
  to: z.enum(TRIP_STATUSES),
  reason: z.string().trim().max(500).optional(),
  actualDistanceKm: z.coerce.number().min(0).optional(),
});
const NEEDS_REASON = ["cancelled", "aborted", "delayed"];

r.post(
  "/:id/transition",
  requirePermission("trips:dispatch"),
  validate(transitionBody),
  ah(async (req, res) => {
    const { to, reason, actualDistanceKm } = req.body;
    const org = req.user.organization;
    const trip = await Trip.findOne({ _id: req.params.id, ...orgScope(req) });
    if (!trip) throw notFound("Trip not found");
    const from = trip.status;
    if (!TRANSITIONS[from].includes(to))
      throw conflict(
        `A ${from.replace("_", " ")} trip can't move to ${to.replace("_", " ")}`,
      );
    if (NEEDS_REASON.includes(to) && !reason)
      throw badRequest("A reason is required");
    if (
      ["assigned", "ready", "in_progress"].includes(to) &&
      !(trip.vehicle && trip.driver)
    )
      throw conflict("Assign a vehicle and a driver first");

    if (to === "in_progress" && from === "ready") {
      const v = await Vehicle.findOne({ _id: trip.vehicle, organization: org });
      const d = await Driver.findOne({ _id: trip.driver, organization: org });
      if (
        !v ||
        ["maintenance", "out_of_service", "inactive"].includes(v.status)
      )
        throw conflict("Vehicle is not available");
      if (v.status === "on_trip")
        throw conflict("Vehicle is already on another trip");
      if (!d || ["suspended", "inactive", "on_leave"].includes(d.status))
        throw conflict("Driver is not available");
      if (d.status === "on_duty")
        throw conflict("Driver is already on another trip");
      v.status = "on_trip";
      d.status = "on_duty";
      await Promise.all([v.save(), d.save()]);
      trip.actualStart = new Date();
    }
    if (to === "delayed") trip.delayReason = reason;
    if (to === "cancelled") trip.cancellationReason = reason;
    if (to === "completed" || to === "aborted") {
      trip.actualEnd = new Date();
      if (actualDistanceKm != null) trip.actualDistanceKm = actualDistanceKm;
      if (to === "aborted") trip.cancellationReason = reason;
      await releaseResources(org, trip);
    }
    trip.status = to;
    trip.history.push({
      by: req.user._id,
      action: "status",
      from,
      to,
      note: reason,
    });
    await trip.save();
    const EV = {
      in_progress: from === "ready" ? "trip_started" : null,
      delayed: "delay_reported",
      completed: "trip_completed",
      cancelled: "trip_cancelled",
      aborted: "trip_aborted",
    };
    if (EV[to])
      await recordSystemEvent(trip, EV[to], {
        actor: req.user._id,
        notes: reason,
      });
    await audit(req, "trip.transition", "Trip", trip.id, { from, to });
    res.json({ success: true, data: trip });
  }),
);

// Swap vehicle/driver/attendant, including mid-trip (e.g. breakdown). Always recorded in history.
const replaceBody = z.object({
  vehicle: id.optional(),
  driver: id.optional(),
  attendant: id.optional(),
  reason: z.string().trim().min(3).max(500),
});
r.post(
  "/:id/replace",
  requirePermission("trips:dispatch"),
  validate(replaceBody),
  ah(async (req, res) => {
    const org = req.user.organization;
    const b = req.body;
    if (!b.vehicle && !b.driver && !b.attendant)
      throw badRequest("Choose something to replace");
    const trip = await Trip.findOne({ _id: req.params.id, ...orgScope(req) });
    if (!trip) throw notFound("Trip not found");
    if (
      !["scheduled", "assigned", "ready", "in_progress", "delayed"].includes(
        trip.status,
      )
    )
      throw conflict("This trip can no longer be changed");
    const live = ["in_progress", "delayed"].includes(trip.status);
    const next = {
      vehicle: b.vehicle ?? trip.vehicle,
      driver: b.driver ?? trip.driver,
      attendant: b.attendant ?? trip.attendant,
    };
    const { v, d } = await assertResources(org, {
      ...next,
      start: trip.scheduledDeparture,
      end: trip.expectedArrival,
      excludeId: trip._id,
    });
    if (live) {
      if (b.vehicle && v.status === "on_trip")
        throw conflict("Replacement vehicle is on another trip");
      if (b.driver && d.status === "on_duty")
        throw conflict("Replacement driver is on another trip");
      if (b.vehicle) {
        await releaseVehicleOnly(org, trip.vehicle);
        v.status = "on_trip";
        await v.save();
      }
      if (b.driver) {
        await Driver.updateOne(
          { _id: trip.driver, organization: org, status: "on_duty" },
          { status: "active" },
        );
        d.status = "on_duty";
        await d.save();
      }
    }
    Object.assign(trip, next);
    trip.history.push({
      by: req.user._id,
      action: "replaced",
      from: trip.status,
      to: trip.status,
      note: b.reason,
    });
    await trip.save();
    if (b.vehicle)
      await recordSystemEvent(trip, "vehicle_assigned", {
        actor: req.user._id,
        notes: b.reason,
      });
    if (b.driver)
      await recordSystemEvent(trip, "driver_assigned", {
        actor: req.user._id,
        notes: b.reason,
      });
    await audit(req, "trip.replace", "Trip", trip.id, b);
    res.json({ success: true, data: trip });
  }),
);

async function releaseVehicleOnly(org, vehicleId) {
  const v = await Vehicle.findOne({ _id: vehicleId, organization: org });
  if (v && v.status === "on_trip") {
    v.status = v.assignedDriver ? "assigned" : "available";
    await v.save();
  }
}

export default r;
