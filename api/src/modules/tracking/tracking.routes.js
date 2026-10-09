import { Router } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { GpsDevice } from "../../models/GpsDevice.js";
import { LocationPing } from "../../models/LocationPing.js";
import { VehiclePosition } from "../../models/VehiclePosition.js";
import { Vehicle } from "../../models/Vehicle.js";
import { Trip } from "../../models/Trip.js";
import { TripEvent } from "../../models/TripEvent.js";
import { Driver } from "../../models/Driver.js";
import { protect, requirePermission, orgScope } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  unauthorized,
} from "../../utils/errors.js";
import { audit } from "../../models/AuditLog.js";
import { providers, providerKeys } from "./providers/index.js";
import { freshness, ingest } from "./tracking.service.js";

const r = Router();
const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const safeEq = (a, b) =>
  a.length === b.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ---- Device ingestion (no user session; authenticated by per-device key) ----------------------
const deviceLimiter = rateLimit({
  windowMs: 60_000,
  limit: process.env.NODE_ENV === "test" ? 10_000 : 600,
  keyGenerator: (req) => (req.headers.authorization ?? req.ip).slice(0, 80),
  validate: { keyGeneratorIpFallback: false },
});

r.post(
  "/ingest",
  deviceLimiter,
  ah(async (req, res) => {
    const m = /^Device ([\w-]{6,64}):([a-f\d]{64})$/i.exec(
      req.headers.authorization ?? "",
    );
    if (!m) throw unauthorized("Device credentials required");
    const device = await GpsDevice.findOne({ publicId: m[1] }).select(
      "+keyHash",
    );
    // Same response for unknown device and wrong key.
    if (!device || !safeEq(device.keyHash, sha(m[2])))
      throw unauthorized("Invalid device credentials");
    if (!device.active) throw forbidden("Device is disabled");
    const vehicle = await Vehicle.findOne({
      _id: device.vehicle,
      organization: device.organization,
      archivedAt: null,
    }).select("_id");
    if (!vehicle) throw conflict("Device is not linked to an active vehicle");
    const adapter = providers[device.provider];
    if (!adapter) throw badRequest("Unsupported provider");
    let pings;
    try {
      pings = adapter.parse(req.body);
    } catch (e) {
      throw badRequest(
        "Malformed GPS payload",
        e.issues?.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })) ?? e.message,
      );
    }
    const out = await ingest({
      org: device.organization,
      vehicleId: vehicle._id,
      source: "device",
      deviceId: device._id,
      pings,
    });
    const now = new Date();
    await GpsDevice.updateOne(
      { _id: device._id },
      {
        lastSeenAt: now,
        ...(out.newestAt && { $max: { lastFixAt: out.newestAt } }),
      },
    );
    res
      .status(out.accepted || out.duplicates ? 200 : 400)
      .json({ success: out.accepted > 0 || out.duplicates > 0, data: out });
  }),
);

// ---- Everything below needs a user session ----------------------------------------------------
r.use(protect);

// Driver phone: allowed only while the user is the driver/attendant of a live trip (authorized tracking period).
const mobileBody = z.object({
  pings: z
    .array(
      z.object({
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        timestamp: z.coerce.date(),
        speedKmh: z.coerce.number().min(0).max(300).optional(),
        heading: z.coerce.number().min(0).max(360).optional(),
        accuracyM: z.coerce.number().min(0).max(100000).optional(),
      }),
    )
    .min(1)
    .max(100),
});
r.post(
  "/mobile/ping",
  requirePermission("trips:operate"),
  validate(mobileBody),
  ah(async (req, res) => {
    const me = await Driver.findOne({
      organization: req.user.organization,
      user: req.user._id,
      archivedAt: null,
    }).select("_id");
    if (!me) throw forbidden("Your account is not linked to a driver profile");
    const trip = await Trip.findOne({
      organization: req.user.organization,
      status: { $in: ["in_progress", "delayed"] },
      $or: [{ driver: me._id }, { attendant: me._id }],
    }).select("vehicle");
    if (!trip?.vehicle)
      throw forbidden(
        "Location sharing is only allowed during your active trip",
      );
    const out = await ingest({
      org: req.user.organization,
      vehicleId: trip.vehicle,
      source: "mobile",
      deviceId: null,
      pings: req.body.pings.map((p) => ({
        lat: p.lat,
        lng: p.lng,
        recordedAt: p.timestamp,
        speedKmh: p.speedKmh,
        heading: p.heading,
        accuracyM: p.accuracyM,
      })),
    });
    res.json({ success: true, data: out });
  }),
);

// Live board: every vehicle with its latest fix, freshness and current trip.
r.get(
  "/vehicles",
  requirePermission("tracking:read"),
  ah(async (req, res) => {
    const org = req.user.organization;
    const vehicles = await Vehicle.find({ ...orgScope(req), archivedAt: null })
      .select("registrationNumber fleetNumber status category")
      .lean();
    const [positions, trips, devices, anyPing] = await Promise.all([
      VehiclePosition.find(orgScope(req)).lean(),
      Trip.find({
        organization: org,
        status: { $in: ["in_progress", "delayed"] },
      })
        .select(
          "tripNumber status vehicle driver route routeSnapshot.code routeSnapshot.name routeSnapshot.stops.name routeSnapshot.stops.sequence expectedArrival",
        )
        .populate("driver", "name phone")
        .lean(),
      GpsDevice.countDocuments({ ...orgScope(req), active: true }),
      LocationPing.exists(orgScope(req)),
    ]);
    const pos = new Map(positions.map((p) => [String(p.vehicle), p]));
    const live = new Map(
      trips.filter((t) => t.vehicle).map((t) => [String(t.vehicle), t]),
    );
    // Next stop = stop after the highest "stop_reached" sequence on the trip (only if drivers record it).
    const reached = await TripEvent.aggregate([
      {
        $match: {
          organization: org,
          trip: { $in: trips.map((t) => t._id) },
          type: "stop_reached",
        },
      },
      { $group: { _id: "$trip", seq: { $max: "$stopSequence" } } },
    ]);
    const reachedBy = new Map(reached.map((x) => [String(x._id), x.seq]));
    const now = Date.now();
    const data = vehicles.map((v) => {
      const p = pos.get(String(v._id));
      const t = live.get(String(v._id));
      const seq = t ? reachedBy.get(String(t._id)) : undefined;
      const next =
        t && seq != null
          ? t.routeSnapshot.stops.find((s) => s.sequence > seq)
          : null;
      return {
        vehicle: v,
        position: p
          ? {
              lat: p.lat,
              lng: p.lng,
              speedKmh: p.speedKmh,
              heading: p.heading,
              accuracyM: p.accuracyM,
              recordedAt: p.recordedAt,
              receivedAt: p.receivedAt,
              source: p.source,
            }
          : null,
        freshness: freshness(p?.recordedAt, now),
        trip: t
          ? {
              _id: t._id,
              tripNumber: t.tripNumber,
              status: t.status,
              route: `${t.routeSnapshot.code} · ${t.routeSnapshot.name}`,
              driver: t.driver,
              expectedArrival: t.expectedArrival,
              nextStop: next?.name ?? null,
            }
          : null,
      };
    });
    res.json({
      success: true,
      data,
      sourceConfigured: devices > 0 || !!anyPing,
      serverTime: new Date(now),
    });
  }),
);

r.get(
  "/vehicles/:vehicleId/history",
  requirePermission("tracking:read"),
  validate(
    z.object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      limit: z.coerce.number().int().min(1).max(1000).default(500),
    }),
    "query",
  ),
  ah(async (req, res) => {
    const v = await Vehicle.findOne({
      _id: req.params.vehicleId,
      ...orgScope(req),
    }).select("_id");
    if (!v) throw notFound("Vehicle not found");
    const { from, to, limit } = req.query;
    const q = { ...orgScope(req), vehicle: v._id };
    if (from || to)
      q.recordedAt = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
    const pings = await LocationPing.find(q)
      .sort({ recordedAt: -1 })
      .limit(limit)
      .select("lat lng speedKmh recordedAt source")
      .lean();
    res.json({ success: true, data: pings.reverse() });
  }),
);

// ---- Device management ---------------------------------------------------------------------
const newKey = () => crypto.randomBytes(32).toString("hex");
const deviceBody = z.object({
  name: z.string().trim().min(2).max(80),
  provider: z.enum(providerKeys).default("generic"),
  externalId: z.string().trim().max(64).optional(),
  vehicle: id,
});

r.get(
  "/devices",
  requirePermission("tracking:write"),
  ah(async (req, res) => {
    const items = await GpsDevice.find(orgScope(req))
      .populate("vehicle", "registrationNumber")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: items, providers: providerKeys });
  }),
);

r.post(
  "/devices",
  requirePermission("tracking:write"),
  validate(deviceBody),
  ah(async (req, res) => {
    const v = await Vehicle.findOne({
      _id: req.body.vehicle,
      ...orgScope(req),
      archivedAt: null,
    });
    if (!v) throw notFound("Vehicle not found");
    const key = newKey();
    const d = await GpsDevice.create({
      ...req.body,
      ...orgScope(req),
      publicId: `dev_${crypto.randomBytes(8).toString("hex")}`,
      keyHash: sha(key),
      keyPrefix: key.slice(0, 6),
    });
    await audit(req, "gps.device.create", "GpsDevice", d.id);
    // The secret is returned once and never stored in clear text.
    res
      .status(201)
      .json({
        success: true,
        data: { _id: d._id, name: d.name, publicId: d.publicId, apiKey: key },
      });
  }),
);

r.post(
  "/devices/:id/rotate-key",
  requirePermission("tracking:write"),
  ah(async (req, res) => {
    const key = newKey();
    const d = await GpsDevice.findOneAndUpdate(
      { _id: req.params.id, ...orgScope(req) },
      { keyHash: sha(key), keyPrefix: key.slice(0, 6) },
      { new: true },
    );
    if (!d) throw notFound("Device not found");
    await audit(req, "gps.device.rotate", "GpsDevice", d.id);
    res.json({
      success: true,
      data: { _id: d._id, publicId: d.publicId, apiKey: key },
    });
  }),
);

r.patch(
  "/devices/:id",
  requirePermission("tracking:write"),
  validate(
    z.object({ active: z.boolean().optional(), vehicle: id.optional() }),
  ),
  ah(async (req, res) => {
    if (
      req.body.vehicle &&
      !(await Vehicle.exists({
        _id: req.body.vehicle,
        ...orgScope(req),
        archivedAt: null,
      }))
    )
      throw notFound("Vehicle not found");
    const d = await GpsDevice.findOneAndUpdate(
      { _id: req.params.id, ...orgScope(req) },
      req.body,
      { new: true },
    );
    if (!d) throw notFound("Device not found");
    res.json({ success: true, data: d });
  }),
);

r.delete(
  "/devices/:id",
  requirePermission("tracking:write"),
  ah(async (req, res) => {
    const d = await GpsDevice.findOneAndDelete({
      _id: req.params.id,
      ...orgScope(req),
    });
    if (!d) throw notFound("Device not found");
    await audit(req, "gps.device.delete", "GpsDevice", d.id);
    res.json({ success: true });
  }),
);

export default r;
