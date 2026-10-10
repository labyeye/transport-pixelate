import { Trip, ACTIVE_STATUSES } from "../../models/Trip.js";
import { Vehicle } from "../../models/Vehicle.js";
import { Driver } from "../../models/Driver.js";
import { Route } from "../../models/Route.js";
import { nextSeq } from "../../models/Counter.js";
import { conflict, notFound, badRequest } from "../../utils/errors.js";
import { emitToOrg } from "../../realtime.js";
import { recordSystemEvent } from "../events/events.service.js";
import { tripStatusChanged } from "../notifications/triggers.js";

// Allowed status transitions. Terminal states have no exits, so a completed trip can't be restarted.
export const TRANSITIONS = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["assigned", "cancelled"],
  assigned: ["ready", "scheduled", "cancelled"],
  ready: ["in_progress", "assigned", "cancelled"],
  in_progress: ["delayed", "completed", "aborted"],
  delayed: ["in_progress", "completed", "aborted"],
  completed: [],
  cancelled: [],
  aborted: [],
};
export const EDITABLE = ["draft", "scheduled", "assigned", "ready"];
const UNAVAILABLE_VEHICLE = ["maintenance", "out_of_service", "inactive"];
const UNAVAILABLE_DRIVER = ["suspended", "inactive", "on_leave"];

/** Find another active trip that overlaps [start, end) for the same vehicle/driver/attendant. */
export async function findConflicts(
  org,
  { vehicle, driver, attendant, start, end, excludeId },
) {
  const resources = [];
  if (vehicle) resources.push({ vehicle });
  if (driver) resources.push({ driver }, { attendant: driver });
  if (attendant) resources.push({ attendant }, { driver: attendant });
  if (!resources.length) return [];
  const q = {
    organization: org,
    status: { $in: ACTIVE_STATUSES },
    scheduledDeparture: { $lt: end },
    expectedArrival: { $gt: start },
    $or: resources,
  };
  if (excludeId) q._id = { $ne: excludeId };
  return Trip.find(q)
    .select(
      "tripNumber vehicle driver attendant scheduledDeparture expectedArrival",
    )
    .lean();
}

export async function assertResources(
  org,
  { vehicle, driver, attendant, start, end, excludeId },
) {
  let v = null,
    d = null,
    a = null;
  if (vehicle) {
    v = await Vehicle.findOne({
      _id: vehicle,
      organization: org,
      archivedAt: null,
    });
    if (!v) throw notFound("Vehicle not found");
    if (UNAVAILABLE_VEHICLE.includes(v.status))
      throw conflict(
        `Vehicle ${v.registrationNumber} is ${v.status.replace("_", " ")}`,
      );
  }
  if (driver) {
    d = await Driver.findOne({
      _id: driver,
      organization: org,
      archivedAt: null,
    });
    if (!d) throw notFound("Driver not found");
    if (UNAVAILABLE_DRIVER.includes(d.status))
      throw conflict(`Driver ${d.name} is ${d.status.replace("_", " ")}`);
    if (d.licence?.expiryDate && d.licence.expiryDate < end)
      throw conflict(
        `Driver ${d.name}'s licence expires before this trip ends`,
      );
  }
  if (attendant) {
    a = await Driver.findOne({
      _id: attendant,
      organization: org,
      archivedAt: null,
    });
    if (!a) throw notFound("Attendant not found");
    if (UNAVAILABLE_DRIVER.includes(a.status))
      throw conflict(`${a.name} is ${a.status.replace("_", " ")}`);
  }
  if (driver && attendant && String(driver) === String(attendant))
    throw badRequest("Driver and attendant must be different people");
  const clashes = await findConflicts(org, {
    vehicle,
    driver,
    attendant,
    start,
    end,
    excludeId,
  });
  if (clashes.length) {
    throw conflict(
      `Assignment conflicts with trip ${clashes.map((c) => c.tripNumber).join(", ")}`,
      clashes.map((c) => c.tripNumber),
    );
  }
  return { v, d, a };
}

export async function buildSnapshot(org, routeId) {
  const route = await Route.findOne({
    _id: routeId,
    organization: org,
    archivedAt: null,
  });
  if (!route) throw notFound("Route not found");
  const stops = route.stops.filter((s) => s.active);
  if (stops.length < 2)
    throw conflict("The route needs at least 2 active stops");
  return {
    route,
    snapshot: {
      version: route.version,
      name: route.name,
      code: route.code,
      plannedDistanceKm: route.plannedDistanceKm,
      stops: stops.map((s) => ({
        name: s.name,
        address: s.address,
        location: { lat: s.location.lat, lng: s.location.lng },
        sequence: s.sequence,
        plannedArrival: s.plannedArrival,
        plannedDeparture: s.plannedDeparture,
        allowsPickup: s.allowsPickup,
        allowsDropoff: s.allowsDropoff,
      })),
    },
  };
}

export async function createTrip(org, userId, input, extra = {}) {
  const { route, snapshot } = await buildSnapshot(org, input.route);
  if (input.expectedArrival <= input.scheduledDeparture)
    throw badRequest("Expected arrival must be after departure");
  const hasResources = input.vehicle && input.driver;
  await assertResources(org, {
    vehicle: input.vehicle,
    driver: input.driver,
    attendant: input.attendant,
    start: input.scheduledDeparture,
    end: input.expectedArrival,
  });
  const seq = await nextSeq(org, "trip");
  const number = `TRP-${String(seq).padStart(5, "0")}`;
  return Trip.create({
    organization: org,
    tripNumber: number,
    tripType: input.tripType,
    route: route._id,
    routeSnapshot: snapshot,
    scheduledDate: input.scheduledDate,
    scheduledDeparture: input.scheduledDeparture,
    expectedArrival: input.expectedArrival,
    vehicle: input.vehicle ?? null,
    driver: input.driver ?? null,
    attendant: input.attendant ?? null,
    notes: input.notes,
    status: hasResources ? "assigned" : "scheduled",
    history: [
      {
        by: userId,
        action: "created",
        to: hasResources ? "assigned" : "scheduled",
      },
    ],
    ...extra,
  });
}

/** Free the vehicle and driver after a trip leaves in_progress/delayed. */
export async function releaseResources(org, trip) {
  if (trip.vehicle) {
    const v = await Vehicle.findOne({ _id: trip.vehicle, organization: org });
    if (v && v.status === "on_trip") {
      v.status = v.assignedDriver ? "assigned" : "available";
      await v.save();
    }
  }
  if (trip.driver)
    await Driver.updateOne(
      { _id: trip.driver, organization: org, status: "on_duty" },
      { status: "active" },
    );
}

const NEEDS_REASON = ["cancelled", "aborted", "delayed"];

/**
 * The single place a trip changes status. Used by dispatchers (web) and drivers (mobile) so both obey the
 * same rules: legal transitions only, availability checked at start, resources released at the end.
 */
export async function applyTransition(
  org,
  trip,
  to,
  { reason, actualDistanceKm, actor } = {},
) {
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
    if (!v || UNAVAILABLE_VEHICLE.includes(v.status))
      throw conflict("Vehicle is not available");
    if (v.status === "on_trip")
      throw conflict("Vehicle is already on another trip");
    if (!d || UNAVAILABLE_DRIVER.includes(d.status))
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
  trip.history.push({ by: actor, action: "status", from, to, note: reason });
  await trip.save();
  const EV = {
    in_progress: from === "ready" ? "trip_started" : null,
    delayed: "delay_reported",
    completed: "trip_completed",
    cancelled: "trip_cancelled",
    aborted: "trip_aborted",
  };
  if (EV[to]) await recordSystemEvent(trip, EV[to], { actor, notes: reason });
  emitToOrg(org, "trip:status", {
    tripId: trip.id,
    tripNumber: trip.tripNumber,
    status: to,
    vehicleId: trip.vehicle ? String(trip.vehicle) : null,
  });
  tripStatusChanged(trip, to, reason, actor);
  return { trip, from };
}
