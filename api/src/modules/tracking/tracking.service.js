import { LocationPing } from "../../models/LocationPing.js";
import { VehiclePosition } from "../../models/VehiclePosition.js";
import { Trip } from "../../models/Trip.js";
import { emitToOrg } from "../../realtime.js";
import { badRequest } from "../../utils/errors.js";

export const LIVE_MS = 2 * 60 * 1000; // fresher than this => live
export const OFFLINE_MS = 15 * 60 * 1000; // older than this => offline
const MAX_AGE_MS = 24 * 3600 * 1000;
const MAX_FUTURE_MS = 2 * 60 * 1000;

/** Freshness is always computed from the fix time, so an old location is never presented as live. */
export function freshness(recordedAt, now = Date.now()) {
  if (!recordedAt) return "no_signal";
  const age = now - +new Date(recordedAt);
  if (age <= LIVE_MS) return "live";
  if (age <= OFFLINE_MS) return "stale";
  return "offline";
}

export function validatePing(p, now = Date.now()) {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng))
    throw badRequest("Invalid coordinates");
  if (p.lat === 0 && p.lng === 0)
    throw badRequest("Rejected null-island (0,0) coordinates");
  const t = +p.recordedAt;
  if (!Number.isFinite(t)) throw badRequest("Invalid timestamp");
  if (t > now + MAX_FUTURE_MS) throw badRequest("Timestamp is in the future");
  if (t < now - MAX_AGE_MS)
    throw badRequest("Timestamp is older than 24 hours");
}

/**
 * Store pings for one vehicle. Duplicates (same device + fix time) are ignored. The vehicle's latest
 * position only moves forward in device time, so late-arriving buffered fixes never rewind it.
 */
export async function ingest({ org, vehicleId, source, deviceId, pings }) {
  const now = Date.now();
  const valid = [];
  const rejected = [];
  pings.forEach((p, i) => {
    try {
      validatePing(p, now);
      valid.push(p);
    } catch (e) {
      rejected.push({ index: i, reason: e.message });
    }
  });
  if (!valid.length) return { accepted: 0, duplicates: 0, rejected };

  const trip = await Trip.findOne({
    organization: org,
    vehicle: vehicleId,
    status: { $in: ["in_progress", "delayed"] },
  }).select("_id");
  const docs = valid.map((p) => ({
    organization: org,
    vehicle: vehicleId,
    trip: trip?._id,
    device: deviceId,
    source,
    lat: p.lat,
    lng: p.lng,
    speedKmh: p.speedKmh,
    heading: p.heading,
    accuracyM: p.accuracyM,
    recordedAt: p.recordedAt,
    receivedAt: new Date(now),
  }));
  let inserted = [];
  try {
    inserted = await LocationPing.insertMany(docs, { ordered: false });
  } catch (e) {
    if (e?.code === 11000 || e?.writeErrors) inserted = e.insertedDocs ?? [];
    else throw e;
  }
  const newest = inserted.reduce(
    (a, b) => (!a || b.recordedAt > a.recordedAt ? b : a),
    null,
  );
  if (newest) {
    const res = await VehiclePosition.findOneAndUpdate(
      {
        organization: org,
        vehicle: vehicleId,
        $or: [{ recordedAt: { $lt: newest.recordedAt } }, { recordedAt: null }],
      },
      {
        $set: {
          trip: trip?._id,
          source,
          lat: newest.lat,
          lng: newest.lng,
          speedKmh: newest.speedKmh,
          heading: newest.heading,
          accuracyM: newest.accuracyM,
          recordedAt: newest.recordedAt,
          receivedAt: newest.receivedAt,
        },
      },
      { new: true },
    );
    // First fix for this vehicle has no document yet; create it (a concurrent winner makes this a no-op).
    if (!res) {
      try {
        await VehiclePosition.create({
          organization: org,
          vehicle: vehicleId,
          trip: trip?._id,
          source,
          lat: newest.lat,
          lng: newest.lng,
          speedKmh: newest.speedKmh,
          heading: newest.heading,
          accuracyM: newest.accuracyM,
          recordedAt: newest.recordedAt,
          receivedAt: newest.receivedAt,
        });
      } catch {
        /* position already exists and is newer */
      }
    }
    emitToOrg(
      org,
      "vehicle:position",
      {
        vehicleId: String(vehicleId),
        tripId: trip ? String(trip._id) : null,
        lat: newest.lat,
        lng: newest.lng,
        speedKmh: newest.speedKmh,
        heading: newest.heading,
        recordedAt: newest.recordedAt,
        source,
      },
      { tracking: true },
    );
  }
  return {
    accepted: inserted.length,
    duplicates: valid.length - inserted.length,
    rejected,
    newestAt: newest?.recordedAt ?? null,
  };
}

/** Delete history older than each organization's retention window. */
export async function purgeOldPings(Organization) {
  const orgs = await Organization.find().select("gpsRetentionDays").lean();
  let removed = 0;
  for (const o of orgs) {
    const cutoff = new Date(Date.now() - (o.gpsRetentionDays ?? 90) * 86400000);
    removed += (
      await LocationPing.deleteMany({
        organization: o._id,
        receivedAt: { $lt: cutoff },
      })
    ).deletedCount;
  }
  return removed;
}
