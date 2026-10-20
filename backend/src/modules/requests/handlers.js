// One handler per request type. `validate` never changes data; it reports problems and the expected
// impact. `apply` performs the change and is only called after `validate` passes at approval time.
//   problem = { code: "ref" | "conflict", message }   ("ref" problems block even filing the request)
import { z } from "zod";
import { Trip } from "../../models/Trip.js";
import { Route } from "../../models/Route.js";
import { Passenger } from "../../models/Passenger.js";
import { PassengerAssignment } from "../../models/PassengerAssignment.js";
import { Organization } from "../../models/Organization.js";
import {
  assertResources,
  buildSnapshot,
  createTrip,
  EDITABLE,
} from "../trips/trip.service.js";
import { recordSystemEvent } from "../events/events.service.js";
import { zonedToUtc } from "../../utils/time.js";
import { HttpError } from "../../utils/errors.js";
import {
  routeChanged,
  tripAssigned,
  tripStatusChanged,
} from "../notifications/triggers.js";

const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const FUTURE_TRIP = ["scheduled", "assigned", "ready"];
const ref = (message) => ({ code: "ref", message });
const conflictP = (message) => ({ code: "conflict", message });
const UPCOMING = (org, filter) =>
  Trip.countDocuments({
    organization: org,
    status: {
      $in: ["scheduled", "assigned", "ready", "in_progress", "delayed"],
    },
    scheduledDeparture: { $gte: new Date() },
    ...filter,
  });
const tzOf = async (org) =>
  (await Organization.findById(org).select("timezone")).timezone;

async function loadTrip(org, tripId, problems) {
  const trip = await Trip.findOne({ _id: tripId, organization: org });
  if (!trip) problems.push(ref("Trip not found"));
  return trip;
}

/** Run assertResources and convert its HttpError into a problem. */
async function resourcesOk(org, args, problems) {
  try {
    await assertResources(org, args);
  } catch (e) {
    if (e instanceof HttpError) problems.push(conflictP(e.message));
    else throw e;
  }
}

export const HANDLERS = {
  trip_cancellation: {
    label: "Trip cancellation",
    auto: true,
    schema: z.object({ trip: id, reason: z.string().trim().min(3).max(300) }),
    related: (p) => ({ trip: p.trip }),
    async validate(org, p) {
      const problems = [];
      const trip = await loadTrip(org, p.trip, problems);
      if (!trip) return { problems, impact: {} };
      if (!FUTURE_TRIP.includes(trip.status))
        problems.push(
          conflictP(
            `Trip ${trip.tripNumber} is ${trip.status.replace("_", " ")}; only scheduled, assigned or ready trips can be cancelled by request`,
          ),
        );
      const riders = await PassengerAssignment.countDocuments({
        organization: org,
        route: trip.route,
        active: true,
      });
      return {
        problems,
        impact: {
          trip: trip.tripNumber,
          date: trip.scheduledDate,
          passengersOnRoute: riders,
        },
      };
    },
    async apply(org, p, actor) {
      const trip = await Trip.findOne({ _id: p.trip, organization: org });
      const from = trip.status;
      Object.assign(trip, {
        status: "cancelled",
        cancellationReason: p.reason,
      });
      trip.history.push({
        by: actor,
        action: "status",
        from,
        to: "cancelled",
        note: `Approved request: ${p.reason}`,
      });
      await trip.save();
      await recordSystemEvent(trip, "trip_cancelled", {
        actor,
        notes: p.reason,
      });
      tripStatusChanged(trip, "cancelled", p.reason);
      return `Cancelled trip ${trip.tripNumber}`;
    },
  },

  vehicle_replacement: swap("vehicle", "Vehicle replacement"),
  driver_replacement: swap("driver", "Driver replacement"),

  additional_trip: {
    label: "Additional trip",
    auto: true,
    schema: z.object({
      route: id,
      scheduledDate: ymd,
      departureTime: hhmm,
      durationMin: z.coerce.number().int().min(1).max(1440),
      vehicle: id.optional(),
      driver: id.optional(),
      attendant: id.optional(),
    }),
    related: (p) => ({ route: p.route }),
    async validate(org, p) {
      const problems = [];
      let tripWindow;
      try {
        await buildSnapshot(org, p.route);
      } catch (e) {
        if (e instanceof HttpError)
          problems.push(
            e.status === 404 ? ref(e.message) : conflictP(e.message),
          );
        else throw e;
      }
      const start = zonedToUtc(
        p.scheduledDate,
        p.departureTime,
        await tzOf(org),
      );
      tripWindow = { start, end: new Date(+start + p.durationMin * 60000) };
      if (start < new Date())
        problems.push(conflictP("The requested departure is in the past"));
      if (!problems.length)
        await resourcesOk(
          org,
          {
            vehicle: p.vehicle,
            driver: p.driver,
            attendant: p.attendant,
            ...tripWindow,
          },
          problems,
        );
      return {
        problems,
        impact: {
          date: p.scheduledDate,
          departure: p.departureTime,
          assigned: !!(p.vehicle && p.driver),
        },
      };
    },
    async apply(org, p, actor) {
      const start = zonedToUtc(
        p.scheduledDate,
        p.departureTime,
        await tzOf(org),
      );
      const trip = await createTrip(org, actor, {
        ...p,
        tripType: "custom",
        scheduledDeparture: start,
        expectedArrival: new Date(+start + p.durationMin * 60000),
      });
      await recordSystemEvent(trip, "trip_created", { actor });
      tripAssigned(trip);
      return `Created trip ${trip.tripNumber}${trip.vehicle && trip.driver ? "" : " (unassigned — assign a vehicle and driver)"}`;
    },
  },

  schedule_change: {
    label: "Schedule change",
    auto: true,
    schema: z.object({
      trip: id,
      scheduledDate: ymd,
      departureTime: hhmm,
      durationMin: z.coerce.number().int().min(1).max(1440).optional(),
    }),
    related: (p) => ({ trip: p.trip }),
    async validate(org, p) {
      const problems = [];
      const trip = await loadTrip(org, p.trip, problems);
      if (!trip) return { problems, impact: {} };
      if (!EDITABLE.includes(trip.status))
        problems.push(
          conflictP(
            `Trip ${trip.tripNumber} is ${trip.status.replace("_", " ")} and can't be rescheduled`,
          ),
        );
      const start = zonedToUtc(
        p.scheduledDate,
        p.departureTime,
        await tzOf(org),
      );
      if (start < new Date())
        problems.push(conflictP("The new departure is in the past"));
      const dur =
        p.durationMin ??
        Math.round((trip.expectedArrival - trip.scheduledDeparture) / 60000);
      const end = new Date(+start + dur * 60000);
      if (!problems.length)
        await resourcesOk(
          org,
          {
            vehicle: trip.vehicle,
            driver: trip.driver,
            attendant: trip.attendant,
            start,
            end,
            excludeId: trip._id,
          },
          problems,
        );
      return {
        problems,
        impact: {
          trip: trip.tripNumber,
          from: `${trip.scheduledDate}`,
          to: `${p.scheduledDate} ${p.departureTime}`,
        },
      };
    },
    async apply(org, p, actor) {
      const trip = await Trip.findOne({ _id: p.trip, organization: org });
      const start = zonedToUtc(
        p.scheduledDate,
        p.departureTime,
        await tzOf(org),
      );
      const dur =
        p.durationMin ??
        Math.round((trip.expectedArrival - trip.scheduledDeparture) / 60000);
      Object.assign(trip, {
        scheduledDate: p.scheduledDate,
        scheduledDeparture: start,
        expectedArrival: new Date(+start + dur * 60000),
      });
      trip.history.push({
        by: actor,
        action: "rescheduled",
        from: trip.status,
        to: trip.status,
        note: "Approved request",
      });
      await trip.save();
      return `Rescheduled ${trip.tripNumber} to ${p.scheduledDate} ${p.departureTime}`;
    },
  },

  passenger_assignment: {
    label: "Passenger assignment change",
    auto: true,
    schema: z
      .object({
        passenger: id,
        route: id,
        remove: z.boolean().default(false),
        pickupStop: z.string().trim().min(1).optional(),
        dropStop: z.string().trim().min(1).optional(),
      })
      .refine((p) => p.remove || (p.pickupStop && p.dropStop), {
        message: "Pickup and drop stops are required unless removing",
      }),
    related: (p) => ({ passenger: p.passenger, route: p.route }),
    async validate(org, p) {
      const problems = [];
      const [passenger, route] = await Promise.all([
        Passenger.findOne({
          _id: p.passenger,
          organization: org,
          archivedAt: null,
        }),
        Route.findOne({ _id: p.route, organization: org, archivedAt: null }),
      ]);
      if (!passenger) problems.push(ref("Passenger not found"));
      if (!route) problems.push(ref("Route not found"));
      if (passenger && route && !p.remove) {
        const find = (n) => route.stops.find((s) => s.active && s.name === n);
        const pick = find(p.pickupStop),
          drop = find(p.dropStop);
        if (!pick?.allowsPickup)
          problems.push(
            conflictP(
              `"${p.pickupStop}" is not a pickup point on ${route.code}`,
            ),
          );
        if (!drop?.allowsDropoff)
          problems.push(
            conflictP(
              `"${p.dropStop}" is not a drop-off point on ${route.code}`,
            ),
          );
        if (pick && drop && pick.sequence >= drop.sequence)
          problems.push(conflictP("Pickup must come before the drop stop"));
      }
      if (
        passenger &&
        route &&
        p.remove &&
        !(await PassengerAssignment.exists({
          organization: org,
          passenger: p.passenger,
          route: p.route,
          active: true,
        }))
      )
        problems.push(conflictP("Passenger is not assigned to this route"));
      return {
        problems,
        impact: {
          passenger: passenger?.name,
          route: route?.code,
          action: p.remove ? "remove" : "assign",
          upcomingTrips: route ? await UPCOMING(org, { route: route._id }) : 0,
        },
      };
    },
    async apply(org, p) {
      const base = {
        organization: org,
        passenger: p.passenger,
        route: p.route,
        active: true,
      };
      if (p.remove) {
        await PassengerAssignment.updateMany(base, { active: false });
        return "Removed passenger from the route";
      }
      await PassengerAssignment.findOneAndUpdate(
        base,
        { pickupStop: p.pickupStop, dropStop: p.dropStop },
        { upsert: true },
      );
      return `Assigned passenger: ${p.pickupStop} → ${p.dropStop}`;
    },
  },

  new_stop: {
    label: "New stop",
    auto: true,
    schema: z.object({
      route: id,
      name: z.string().trim().min(1).max(120),
      address: z.string().trim().max(300).optional(),
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
      afterSequence: z.coerce.number().int().min(0).default(999),
      allowsPickup: z.boolean().default(true),
      allowsDropoff: z.boolean().default(true),
    }),
    related: (p) => ({ route: p.route }),
    async validate(org, p) {
      const problems = [];
      const route = await Route.findOne({
        _id: p.route,
        organization: org,
        archivedAt: null,
      });
      if (!route) {
        problems.push(ref("Route not found"));
        return { problems, impact: {} };
      }
      if (
        route.stops.some((s) => s.name.toLowerCase() === p.name.toLowerCase())
      )
        problems.push(
          conflictP(`${route.code} already has a stop named "${p.name}"`),
        );
      return {
        problems,
        impact: {
          route: route.code,
          newVersion: route.version + 1,
          upcomingTripsKeepSnapshot: await UPCOMING(org, { route: route._id }),
        },
      };
    },
    async apply(org, p, actor) {
      const route = await Route.findOne({ _id: p.route, organization: org });
      const at = Math.min(p.afterSequence, route.stops.length);
      const stops = route.stops.map((s) => s.toObject());
      stops.splice(at, 0, {
        name: p.name,
        address: p.address,
        location: { lat: p.lat, lng: p.lng },
        allowsPickup: p.allowsPickup,
        allowsDropoff: p.allowsDropoff,
        active: true,
        dwellMinutes: 0,
      });
      route.stops = stops.map((s, i) => ({ ...s, sequence: i + 1 }));
      route.version += 1; // existing trips keep the plan they were created with
      await route.save();
      routeChanged(route);
      return `Added stop "${p.name}" to ${route.code} (now version ${route.version})`;
    },
  },

  new_route: {
    label: "New route",
    auto: true,
    schema: z.object({
      name: z.string().trim().min(2).max(120),
      code: z
        .string()
        .trim()
        .min(1)
        .max(20)
        .regex(/^[A-Za-z0-9_-]+$/),
      stops: z
        .array(
          z.object({
            name: z.string().trim().min(1).max(120),
            lat: z.coerce.number().min(-90).max(90),
            lng: z.coerce.number().min(-180).max(180),
          }),
        )
        .min(2)
        .max(60),
    }),
    related: () => ({}),
    async validate(org, p) {
      const problems = [];
      if (
        await Route.exists({
          organization: org,
          code: p.code.toUpperCase(),
          archivedAt: null,
        })
      )
        problems.push(
          conflictP(`Route code ${p.code.toUpperCase()} already exists`),
        );
      return {
        problems,
        impact: {
          code: p.code.toUpperCase(),
          stops: p.stops.length,
          createdInactive: true,
        },
      };
    },
    async apply(org, p) {
      const r = await Route.create({
        organization: org,
        name: p.name,
        code: p.code.toUpperCase(),
        active: false,
        stops: p.stops.map((s, i) => ({
          name: s.name,
          location: { lat: s.lat, lng: s.lng },
          sequence: i + 1,
        })),
      });
      return `Created route ${r.code} as inactive — review the stops and timings, then activate it`;
    },
  },

  special_requirement: {
    label: "Special requirement",
    auto: false,
    schema: z.object({}).passthrough(),
    related: () => ({}),
    async validate() {
      return { problems: [], impact: { manualFollowUp: true } };
    },
    async apply() {
      return "Approved — needs manual follow-up";
    },
  },
};

function swap(kind, label) {
  return {
    label: `${label}`,
    auto: true,
    schema: z.object({ trip: id, [kind]: id }),
    related: (p) => ({ trip: p.trip }),
    async validate(org, p) {
      const problems = [];
      const trip = await loadTrip(org, p.trip, problems);
      if (!trip) return { problems, impact: {} };
      if (!FUTURE_TRIP.includes(trip.status))
        problems.push(
          conflictP(
            `Trip ${trip.tripNumber} is ${trip.status.replace("_", " ")}; replacements for live trips are done by a dispatcher`,
          ),
        );
      if (String(trip[kind]) === p[kind])
        problems.push(
          conflictP(`That ${kind} is already assigned to the trip`),
        );
      if (!problems.length)
        await resourcesOk(
          org,
          {
            vehicle: trip.vehicle,
            driver: trip.driver,
            attendant: trip.attendant,
            [kind]: p[kind],
            start: trip.scheduledDeparture,
            end: trip.expectedArrival,
            excludeId: trip._id,
          },
          problems,
        );
      return {
        problems,
        impact: {
          trip: trip.tripNumber,
          date: trip.scheduledDate,
          replacing: kind,
        },
      };
    },
    async apply(org, p, actor) {
      const trip = await Trip.findOne({ _id: p.trip, organization: org });
      trip[kind] = p[kind];
      if (trip.status === "scheduled" && trip.vehicle && trip.driver)
        trip.status = "assigned";
      trip.history.push({
        by: actor,
        action: "replaced",
        from: trip.status,
        to: trip.status,
        note: `Approved request: ${kind} replacement`,
      });
      await trip.save();
      await recordSystemEvent(
        trip,
        kind === "driver" ? "driver_assigned" : "vehicle_assigned",
        { actor, notes: "Approved request" },
      );
      if (kind === "driver") tripAssigned(trip);
      return `Replaced the ${kind} on ${trip.tripNumber}`;
    },
  };
}
