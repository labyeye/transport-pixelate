// Thin helpers that business code calls after its own transaction has succeeded. They never throw
// and are not awaited by callers, so notification problems cannot affect trips, routes or events.
import { Driver } from "../../models/Driver.js";
import { Vehicle } from "../../models/Vehicle.js";
import { Organization } from "../../models/Organization.js";
import { Trip, ACTIVE_STATUSES } from "../../models/Trip.js";
import { notify } from "./notify.service.js";

const safe = (fn) => fn().catch((e) => console.error("[trigger]", e.message));

async function context(trip) {
  const [org, driver] = await Promise.all([
    Organization.findById(trip.organization).select("timezone").lean(),
    trip.driver
      ? Driver.findById(trip.driver).select("name phone user").lean()
      : null,
  ]);
  const tz = org?.timezone ?? "Asia/Kolkata";
  const vars = {
    tripNumber: trip.tripNumber,
    route: trip.routeSnapshot?.code,
    date: trip.scheduledDate,
    time: new Date(trip.scheduledDeparture).toLocaleTimeString("en-IN", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  };
  const extra = driver
    ? [
        {
          userId: driver.user ?? undefined,
          name: driver.name,
          phone: driver.phone,
        },
      ]
    : [];
  return { vars, extra, driver };
}

export const tripAssigned = (trip) =>
  trip.driver &&
  safe(async () => {
    const { vars, extra } = await context(trip);
    // Same trip + same driver never re-notifies; a different driver (replacement) does.
    await notify("trip_assigned", {
      org: trip.organization,
      vars,
      extra,
      link: "/trips",
      dedupeKey: `assigned:${trip._id}:${trip.driver}`,
    });
  });

export const tripStatusChanged = (trip, to, reason, actorId) =>
  safe(async () => {
    const { vars, extra } = await context(trip);
    const v = { ...vars, reason: reason ?? "" };
    if (to === "in_progress")
      return notify("trip_started", {
        org: trip.organization,
        vars: v,
        link: "/tracking",
      });
    if (to === "delayed")
      return notify("trip_delayed", {
        org: trip.organization,
        vars: v,
        link: "/trips",
      });
    if (to === "cancelled" || to === "aborted")
      return notify("trip_cancelled", {
        org: trip.organization,
        vars: v,
        extra,
        link: "/trips",
      });
  });

export const breakdownReported = (trip, notes) =>
  safe(async () => {
    const [{ vars }, vehicle] = await Promise.all([
      context(trip),
      trip.vehicle
        ? Vehicle.findById(trip.vehicle).select("registrationNumber").lean()
        : null,
    ]);
    await notify("vehicle_breakdown", {
      org: trip.organization,
      vars: {
        ...vars,
        vehicle: vehicle?.registrationNumber ?? "Vehicle",
        reason: notes,
      },
      link: "/trips",
    });
  });

export const routeChanged = (route) =>
  safe(async () => {
    const upcoming = await Trip.countDocuments({
      organization: route.organization,
      route: route._id,
      status: { $in: ACTIVE_STATUSES },
      scheduledDeparture: { $gte: new Date() },
    });
    await notify("route_changed", {
      org: route.organization,
      vars: { route: route.code, version: route.version, upcoming },
      link: "/routes",
    });
  });
