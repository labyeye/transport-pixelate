import { Alert } from "../../models/Alert.js";
import { Geofence } from "../../models/Geofence.js";
import { Organization } from "../../models/Organization.js";
import { Vehicle } from "../../models/Vehicle.js";
import { notify } from "../notifications/notify.service.js";
import { emitToOrg } from "../../realtime.js";
import {
  ensureSubscription,
  featuresFor,
} from "../saas/subscription.service.js";

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
/** Great-circle distance in metres. */
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Pure rule evaluation for one fix. `prev` is the vehicle's previous stored state
 * ({ inside: [geofenceId], overspeed } or null for a vehicle never seen before).
 * Alerts fire on transitions only, so a vehicle sitting in a zone or above the limit raises one alert, not one per ping.
 */
export function evaluateRules({ fix, prev, geofences, limitKmh }) {
  const inside = geofences
    .filter((g) => distanceM(fix, g.center) <= g.radiusM)
    .map((g) => String(g._id));
  const was = new Set((prev?.inside ?? []).map(String));
  const events = [];
  // A vehicle's first-ever fix sets the baseline silently: appearing inside a zone is not "entering" it.
  if (prev)
    for (const g of geofences) {
      const now = inside.includes(String(g._id));
      const before = was.has(String(g._id));
      if (now && !before && g.alertOn !== "exit")
        events.push({ type: "geofence_enter", geofence: g });
      if (!now && before && g.alertOn !== "enter")
        events.push({ type: "geofence_exit", geofence: g });
    }
  const overspeed = !!(limitKmh && fix.speedKmh > limitKmh);
  if (overspeed && !prev?.overspeed)
    events.push({ type: "overspeed", speedKmh: fix.speedKmh, limitKmh });
  return { state: { inside, overspeed }, events };
}

/**
 * Called from ingest for the newest fix. Returns the state to store on the vehicle's position.
 * Never throws: alerting must not be able to lose a location update.
 */
export async function runAlerts({ org, vehicleId, tripId, fix, prev }) {
  try {
    const sub = await ensureSubscription(org);
    if (!featuresFor(sub).alerts) return {};
    const [geofences, o] = await Promise.all([
      Geofence.find({ organization: org, active: true, archivedAt: null }).lean(),
      Organization.findById(org).select("speedLimitKmh").lean(),
    ]);
    const { state, events } = evaluateRules({
      fix,
      prev,
      geofences,
      limitKmh: o?.speedLimitKmh,
    });
    if (events.length) {
      const v = await Vehicle.findById(vehicleId)
        .select("registrationNumber")
        .lean();
      for (const e of events) {
        const alert = await Alert.create({
          organization: org,
          type: e.type,
          vehicle: vehicleId,
          trip: tripId,
          at: fix.recordedAt,
          lat: fix.lat,
          lng: fix.lng,
          speedKmh: e.speedKmh,
          limitKmh: e.limitKmh,
          geofence: e.geofence?._id,
          geofenceName: e.geofence?.name,
        });
        emitToOrg(org, "alert:new", { id: String(alert._id), type: e.type }, { tracking: true });
        await notify(e.type === "overspeed" ? "overspeed" : "geofence_alert", {
          org,
          dedupeKey: `alert:${alert._id}`,
          link: "/alerts",
          vars: {
            vehicle: v?.registrationNumber ?? "Vehicle",
            speed: Math.round(e.speedKmh ?? 0),
            limit: e.limitKmh,
            zone: e.geofence?.name,
            action: e.type === "geofence_enter" ? "entered" : "left",
          },
        });
      }
    }
    return state;
  } catch (err) {
    console.error("[alerts]", err.message);
    return {};
  }
}
