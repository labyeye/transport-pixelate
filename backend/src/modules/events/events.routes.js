import { Router } from "express";
import { z } from "zod";
import { Trip } from "../../models/Trip.js";
import { TripEvent } from "../../models/TripEvent.js";
import { Passenger } from "../../models/Passenger.js";
import { PassengerAssignment } from "../../models/PassengerAssignment.js";
import { protect, requirePermission, orgScope } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import { badRequest, conflict, notFound } from "../../utils/errors.js";
import { audit } from "../../models/AuditLog.js";
import {
  breakdownReported,
  tripStatusChanged,
} from "../notifications/triggers.js";
import {
  assertCanOperate,
  effectiveEvents,
  passengerStates,
} from "./events.service.js";

const r = Router();
r.use(protect);
const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

async function loadTrip(req) {
  const trip = await Trip.findOne({ _id: req.params.id, ...orgScope(req) });
  if (!trip) throw notFound("Trip not found");
  // Reads of the manifest and event log are limited to assigned drivers/attendants too.
  await assertCanOperate(req, trip);
  return trip;
}

// Manifest: everyone assigned to the trip's route, with their current boarding state.
r.get(
  "/:id/manifest",
  requirePermission("passengers:read"),
  ah(async (req, res) => {
    const trip = await loadTrip(req);
    const [asg, { effective }] = await Promise.all([
      PassengerAssignment.find({
        ...orgScope(req),
        route: trip.route,
        active: true,
      })
        .populate("passenger")
        .lean(),
      effectiveEvents(req.user.organization, trip._id),
    ]);
    const states = passengerStates(effective);
    const seqOf = (name) =>
      trip.routeSnapshot.stops.find((s) => s.name === name)?.sequence ?? null;
    const rows = asg
      .filter((a) => a.passenger && !a.passenger.archivedAt)
      .map((a) => ({
        passenger: {
          _id: a.passenger._id,
          name: a.passenger.name,
          identifier: a.passenger.identifier,
          grade: a.passenger.grade,
          guardian: a.passenger.guardian,
        },
        pickupStop: a.pickupStop,
        pickupSequence: seqOf(a.pickupStop),
        dropStop: a.dropStop,
        dropSequence: seqOf(a.dropStop),
        status: states.get(String(a.passenger._id))?.status ?? "pending",
        at: states.get(String(a.passenger._id))?.at ?? null,
      }))
      .sort(
        (x, y) =>
          (x.pickupSequence ?? 999) - (y.pickupSequence ?? 999) ||
          x.passenger.name.localeCompare(y.passenger.name),
      );
    const counts = rows.reduce(
      (c, x) => ({ ...c, [x.status]: (c[x.status] ?? 0) + 1 }),
      {},
    );
    res.json({
      success: true,
      data: {
        trip: {
          _id: trip._id,
          tripNumber: trip.tripNumber,
          status: trip.status,
        },
        passengers: rows,
        counts,
      },
    });
  }),
);

r.get(
  "/:id/events",
  requirePermission("trips:read"),
  ah(async (req, res) => {
    const trip = await loadTrip(req);
    const { all, corrected } = await effectiveEvents(
      req.user.organization,
      trip._id,
    );
    const ids = [
      ...new Set(
        all
          .map((e) => e.passenger)
          .filter(Boolean)
          .map(String),
      ),
    ];
    const names = new Map(
      (
        await Passenger.find({ _id: { $in: ids } })
          .select("name")
          .lean()
      ).map((p) => [String(p._id), p.name]),
    );
    res.json({
      success: true,
      data: all.map((e) => ({
        ...e,
        passengerName: e.passenger ? names.get(String(e.passenger)) : undefined,
        superseded: corrected.has(String(e._id)),
      })),
    });
  }),
);

const MANUAL_TYPES = [
  "stop_reached",
  "passenger_boarded",
  "passenger_dropped",
  "passenger_missing",
  "delay_reported",
  "breakdown_reported",
  "incident_reported",
  "note",
];
const eventBody = z.object({
  type: z.enum(MANUAL_TYPES),
  at: z.coerce.date().optional(),
  stopSequence: z.coerce.number().int().min(1).optional(),
  passenger: id.optional(),
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .optional(),
  notes: z.string().trim().max(500).optional(),
  clientId: z.string().trim().min(8).max(80).optional(),
  source: z.enum(["web", "mobile"]).default("web"),
});
const PASSENGER_TYPES = [
  "passenger_boarded",
  "passenger_dropped",
  "passenger_missing",
];
const LIVE = ["in_progress", "delayed"];

// Validates a passenger event against the trip, manifest and current (effective) state.
async function validatePassengerEvent(req, trip, b, effective, ignoreEventId) {
  if (!b.passenger) throw badRequest("Passenger is required");
  if (!b.stopSequence) throw badRequest("Stop is required");
  const stop = trip.routeSnapshot.stops.find(
    (s) => s.sequence === b.stopSequence,
  );
  if (!stop) throw badRequest("Stop is not on this trip's route");
  const asg = await PassengerAssignment.findOne({
    ...orgScope(req),
    route: trip.route,
    passenger: b.passenger,
    active: true,
  });
  if (!asg) throw conflict("Passenger is not on this route's manifest");
  const eff = ignoreEventId
    ? effective.filter((e) => String(e._id) !== String(ignoreEventId))
    : effective;
  const cur =
    passengerStates(eff).get(String(b.passenger))?.status ?? "pending";
  if (b.type === "passenger_boarded") {
    if (!stop.allowsPickup)
      throw conflict("Boarding is not allowed at this stop");
    if (cur === "boarded") throw conflict("Passenger is already boarded");
    if (cur === "dropped")
      throw conflict("Passenger has already been dropped off");
  }
  if (b.type === "passenger_dropped") {
    if (!stop.allowsDropoff)
      throw conflict("Drop-off is not allowed at this stop");
    if (cur !== "boarded")
      throw conflict(
        cur === "dropped"
          ? "Passenger is already dropped off"
          : "Passenger has not boarded",
      );
  }
  if (b.type === "passenger_missing" && cur !== "pending")
    throw conflict(`Passenger is already ${cur}`);
}

function checkTime(trip, at) {
  if (+at > Date.now() + 5 * 60000)
    throw badRequest("Event time is in the future");
  // Events belong to the live trip, so they can't predate when it actually started.
  const floor = +(trip.actualStart ?? trip.scheduledDeparture) - 5 * 60000;
  if (+at < floor) throw badRequest("Event time is before the trip started");
}

r.post(
  "/:id/events",
  requirePermission("trips:operate"),
  validate(eventBody),
  ah(async (req, res) => {
    const b = req.body;
    const trip = await loadTrip(req);
    await assertCanOperate(req, trip);
    // Offline replay: the same clientId returns the stored event instead of duplicating it.
    if (b.clientId) {
      const dup = await TripEvent.findOne({
        organization: req.user.organization,
        clientId: b.clientId,
      });
      if (dup) return res.json({ success: true, data: dup, duplicate: true });
    }
    if (!LIVE.includes(trip.status))
      throw conflict(
        "Events can only be recorded while the trip is in progress",
      );
    const at = b.at ?? new Date();
    checkTime(trip, at);
    if (
      b.stopSequence &&
      !trip.routeSnapshot.stops.some((s) => s.sequence === b.stopSequence)
    )
      throw badRequest("Stop is not on this trip's route");
    if (PASSENGER_TYPES.includes(b.type)) {
      const { effective } = await effectiveEvents(
        req.user.organization,
        trip._id,
      );
      await validatePassengerEvent(req, trip, b, effective);
    }
    if (
      ["delay_reported", "breakdown_reported", "incident_reported"].includes(
        b.type,
      ) &&
      !b.notes
    )
      throw badRequest("Please describe what happened");
    const ev = await TripEvent.create({
      ...b,
      at,
      organization: req.user.organization,
      trip: trip._id,
      actor: req.user._id,
    });
    if (b.type === "delay_reported" && trip.status === "in_progress") {
      trip.status = "delayed";
      trip.delayReason = b.notes;
      trip.history.push({
        by: req.user._id,
        action: "status",
        from: "in_progress",
        to: "delayed",
        note: b.notes,
      });
      await trip.save();
    }
    if (b.type === "breakdown_reported") breakdownReported(trip, b.notes);
    if (b.type === "delay_reported")
      tripStatusChanged(trip, "delayed", b.notes);
    res.status(201).json({ success: true, data: ev });
  }),
);

// Correct a mistaken event: append a correction (and optional replacement). The original is untouched.
const correctBody = z.object({
  reason: z.string().trim().min(3).max(500),
  replacement: z
    .object({
      type: z.enum(MANUAL_TYPES),
      stopSequence: z.coerce.number().int().min(1).optional(),
      passenger: id.optional(),
      at: z.coerce.date().optional(),
      notes: z.string().trim().max(500).optional(),
    })
    .optional(),
});
r.post(
  "/:id/events/:eventId/correct",
  requirePermission("trips:dispatch"),
  validate(correctBody),
  ah(async (req, res) => {
    const trip = await loadTrip(req);
    const orig = await TripEvent.findOne({
      _id: req.params.eventId,
      trip: trip._id,
      ...orgScope(req),
    });
    if (!orig) throw notFound("Event not found");
    if (orig.type === "correction")
      throw conflict("Corrections can't be corrected");
    const { effective, corrected } = await effectiveEvents(
      req.user.organization,
      trip._id,
    );
    if (corrected.has(String(orig._id)))
      throw conflict("This event was already corrected");
    const { reason, replacement } = req.body;
    if (replacement) {
      const rb = { ...replacement, at: replacement.at ?? orig.at };
      if (PASSENGER_TYPES.includes(rb.type))
        await validatePassengerEvent(req, trip, rb, effective, orig._id);
    }
    const correction = await TripEvent.create({
      organization: req.user.organization,
      trip: trip._id,
      type: "correction",
      at: new Date(),
      actor: req.user._id,
      source: "web",
      corrects: orig._id,
      notes: reason,
    });
    let newEvent = null;
    if (replacement) {
      newEvent = await TripEvent.create({
        ...replacement,
        at: replacement.at ?? orig.at,
        organization: req.user.organization,
        trip: trip._id,
        actor: req.user._id,
        source: "web",
        replaces: orig._id,
      });
    }
    await audit(req, "trip.event.correct", "TripEvent", orig.id, { reason });
    res
      .status(201)
      .json({ success: true, data: { correction, replacement: newEvent } });
  }),
);

export default r;
