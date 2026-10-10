import { Router } from "express";
import { z } from "zod";
import { Driver } from "../../models/Driver.js";
import { Trip } from "../../models/Trip.js";
import { TripEvent } from "../../models/TripEvent.js";
import { User } from "../../models/User.js";
import { Vehicle } from "../../models/Vehicle.js";
import { Organization } from "../../models/Organization.js";
import { protect, requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import { conflict, forbidden, notFound } from "../../utils/errors.js";
import { audit } from "../../models/AuditLog.js";
import { dateInZone } from "../../utils/time.js";
import { applyTransition } from "../trips/trip.service.js";
import { emergencyReported } from "../notifications/triggers.js";

// Endpoints for the mobile app. Everything is scoped to the signed-in person's own staff profile and trips.
const r = Router();
r.use(protect, requirePermission("trips:operate"));
const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const EARLIEST_START_MIN = 60; // a trip can't be started more than this long before its departure
export const LATEST_START_HOURS = 12; // ...or this long after it

async function me(req) {
  const d = await Driver.findOne({
    organization: req.user.organization,
    user: req.user._id,
    archivedAt: null,
  });
  if (!d)
    throw forbidden(
      "Your login isn't linked to a driver profile. Ask your administrator.",
    );
  return d;
}

async function myTrip(req, driver) {
  const trip = await Trip.findOne({
    _id: req.params.id,
    organization: req.user.organization,
    $or: [{ driver: driver._id }, { attendant: driver._id }],
  });
  if (!trip) throw notFound("Trip not found");
  return trip;
}
const mustBeDriver = (trip, driver) => {
  if (String(trip.driver) !== String(driver._id))
    throw forbidden("Only the assigned driver can do this");
};

const shape = (t, driver) => ({
  _id: t._id,
  tripNumber: t.tripNumber,
  status: t.status,
  tripType: t.tripType,
  scheduledDate: t.scheduledDate,
  scheduledDeparture: t.scheduledDeparture,
  expectedArrival: t.expectedArrival,
  actualStart: t.actualStart,
  myRole:
    String(t.driver?._id ?? t.driver) === String(driver._id)
      ? "driver"
      : "attendant",
  route: {
    code: t.routeSnapshot.code,
    name: t.routeSnapshot.name,
    stops: t.routeSnapshot.stops,
  },
  vehicle: t.vehicle
    ? { _id: t.vehicle._id, registrationNumber: t.vehicle.registrationNumber }
    : null,
  driver: t.driver?.name ? { name: t.driver.name } : null,
  notes: t.notes,
});

r.get(
  "/me",
  ah(async (req, res) => {
    const driver = await me(req);
    const org = await Organization.findById(req.user.organization).select(
      "name timezone",
    );
    const [live, staff, vehicle] = await Promise.all([
      Trip.findOne({
        organization: req.user.organization,
        status: { $in: ["in_progress", "delayed"] },
        $or: [{ driver: driver._id }, { attendant: driver._id }],
      })
        .select("_id tripNumber status")
        .lean(),
      // People to call for help: dispatch and management staff who have a phone number on file.
      User.find({
        organization: req.user.organization,
        role: { $in: ["dispatcher", "admin", "owner"] },
        status: "active",
        phone: { $ne: null },
      })
        .select("name phone role")
        .lean(),
      driver.assignedVehicle
        ? Vehicle.findById(driver.assignedVehicle)
            .select("registrationNumber status")
            .lean()
        : null,
    ]);
    res.json({
      success: true,
      data: {
        user: { id: req.user.id, name: req.user.name, role: req.user.role },
        driver: {
          _id: driver._id,
          name: driver.name,
          phone: driver.phone,
          status: driver.status,
          staffRole: driver.staffRole,
          emergencyContact: driver.emergencyContact,
        },
        vehicle,
        organization: { name: org.name, timezone: org.timezone },
        activeTrip: live,
        contacts: staff.map((s) => ({
          name: s.name,
          phone: s.phone,
          role: s.role,
        })),
        rules: {
          earliestStartMinutes: EARLIEST_START_MIN,
          latestStartHours: LATEST_START_HOURS,
        },
      },
    });
  }),
);

// Today's trips plus anything currently running, then the next 7 days.
r.get(
  "/trips",
  ah(async (req, res) => {
    const driver = await me(req);
    const org = await Organization.findById(req.user.organization).select(
      "timezone",
    );
    const today = dateInZone(new Date(), org.timezone);
    const horizon = dateInZone(
      new Date(Date.now() + 7 * 86400000),
      org.timezone,
    );
    const trips = await Trip.find({
      organization: req.user.organization,
      $or: [{ driver: driver._id }, { attendant: driver._id }],
      $and: [
        {
          $or: [
            { scheduledDate: { $gte: today, $lte: horizon } },
            { status: { $in: ["in_progress", "delayed"] } },
          ],
        },
        { status: { $ne: "draft" } },
      ],
    })
      .populate("vehicle", "registrationNumber")
      .populate("driver", "name")
      .sort({ scheduledDeparture: 1 })
      .limit(100);
    res.json({
      success: true,
      data: trips.map((t) => shape(t, driver)),
      today,
      serverTime: new Date(),
    });
  }),
);

// "I'm at the vehicle and ready." Driver only; repeating it is harmless.
r.post(
  "/trips/:id/ready",
  ah(async (req, res) => {
    const driver = await me(req);
    const trip = await myTrip(req, driver);
    mustBeDriver(trip, driver);
    if (trip.status === "ready")
      return res.json({
        success: true,
        data: { status: trip.status },
        repeated: true,
      });
    await applyTransition(req.user.organization, trip, "ready", {
      actor: req.user._id,
    });
    res.json({ success: true, data: { status: trip.status } });
  }),
);

r.post(
  "/trips/:id/start",
  ah(async (req, res) => {
    const driver = await me(req);
    const trip = await myTrip(req, driver);
    mustBeDriver(trip, driver);
    // A queued "start" replayed after reconnecting must not error or restart anything.
    if (["in_progress", "delayed"].includes(trip.status))
      return res.json({
        success: true,
        data: { status: trip.status, actualStart: trip.actualStart },
        repeated: true,
      });
    if (trip.status !== "ready")
      throw conflict(
        trip.status === "assigned"
          ? "Confirm you're ready first"
          : `This trip is ${trip.status.replace("_", " ")} and can't be started`,
      );
    const mins = (+trip.scheduledDeparture - Date.now()) / 60000;
    if (mins > EARLIEST_START_MIN)
      throw conflict(
        `Too early. You can start ${EARLIEST_START_MIN} minutes before departure.`,
      );
    if (mins < -LATEST_START_HOURS * 60)
      throw conflict(
        "This trip is too far past its scheduled time. Contact dispatch.",
      );
    await applyTransition(req.user.organization, trip, "in_progress", {
      actor: req.user._id,
    });
    await audit(req, "driver.trip_start", "Trip", trip.id);
    res.json({
      success: true,
      data: { status: trip.status, actualStart: trip.actualStart },
    });
  }),
);

r.post(
  "/trips/:id/complete",
  validate(
    z.object({
      actualDistanceKm: z.coerce.number().min(0).max(5000).optional(),
    }),
  ),
  ah(async (req, res) => {
    const driver = await me(req);
    const trip = await myTrip(req, driver);
    mustBeDriver(trip, driver);
    if (trip.status === "completed")
      return res.json({
        success: true,
        data: { status: "completed", actualEnd: trip.actualEnd },
        repeated: true,
      });
    if (!["in_progress", "delayed"].includes(trip.status))
      throw conflict("Only a trip that is under way can be completed");
    await applyTransition(req.user.organization, trip, "completed", {
      actor: req.user._id,
      actualDistanceKm: req.body.actualDistanceKm,
    });
    await audit(req, "driver.trip_complete", "Trip", trip.id);
    res.json({
      success: true,
      data: { status: trip.status, actualEnd: trip.actualEnd },
    });
  }),
);

// A real emergency (as opposed to a delay or breakdown report): recorded and escalated to staff immediately.
r.post(
  "/trips/:id/emergency",
  validate(
    z.object({
      notes: z.string().trim().max(500).optional(),
      location: z
        .object({
          lat: z.number().min(-90).max(90),
          lng: z.number().min(-180).max(180),
        })
        .optional(),
      clientId: z.string().trim().min(8).max(80).optional(),
    }),
  ),
  ah(async (req, res) => {
    const driver = await me(req);
    const trip = await myTrip(req, driver);
    if (req.body.clientId) {
      const dup = await TripEvent.findOne({
        organization: req.user.organization,
        clientId: req.body.clientId,
      });
      if (dup) return res.json({ success: true, data: dup, duplicate: true });
    }
    if (!["in_progress", "delayed", "ready"].includes(trip.status))
      throw conflict(
        "Emergencies can be raised once the trip is ready or under way. Phone dispatch otherwise.",
      );
    const ev = await TripEvent.create({
      organization: req.user.organization,
      trip: trip._id,
      type: "emergency_reported",
      at: new Date(),
      actor: req.user._id,
      source: "mobile",
      notes: req.body.notes,
      location: req.body.location,
      clientId: req.body.clientId,
    });
    emergencyReported(trip, req.body.notes, driver.name);
    await audit(req, "driver.emergency", "Trip", trip.id);
    res.status(201).json({ success: true, data: ev });
  }),
);

export default r;
