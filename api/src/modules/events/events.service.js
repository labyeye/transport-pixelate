import { TripEvent } from "../../models/TripEvent.js";
import { Driver } from "../../models/Driver.js";
import { forbidden } from "../../utils/errors.js";

/** Fire-and-forget system event; a logging failure must never fail the operation. */
export async function recordSystemEvent(trip, type, { actor, notes, at } = {}) {
  try {
    await TripEvent.create({
      organization: trip.organization,
      trip: trip._id,
      type,
      at: at ?? new Date(),
      actor,
      source: "system",
      notes,
    });
  } catch {
    /* ignore */
  }
}

/** Events that have been corrected (voided/replaced) are excluded from "effective" state. */
export async function effectiveEvents(org, tripId) {
  const all = await TripEvent.find({ organization: org, trip: tripId })
    .sort({ at: 1, receivedAt: 1 })
    .lean();
  const corrected = new Set(
    all.filter((e) => e.type === "correction").map((e) => String(e.corrects)),
  );
  return {
    all,
    corrected,
    effective: all.filter(
      (e) => e.type !== "correction" && !corrected.has(String(e._id)),
    ),
  };
}

/** Drivers/attendants can only operate trips they are assigned to; staff roles with broader rights pass. */
export async function assertCanOperate(req, trip) {
  if (!["driver", "attendant"].includes(req.user.role)) return;
  const me = await Driver.findOne({
    organization: req.user.organization,
    user: req.user._id,
  }).select("_id");
  const mine =
    me &&
    [trip.driver, trip.attendant].some(
      (x) => x && String(x) === String(me._id),
    );
  if (!mine) throw forbidden("You are not assigned to this trip");
}

/** Current state of each passenger on a trip, derived from effective events only. */
export function passengerStates(effective) {
  const state = new Map();
  for (const e of effective) {
    if (!e.passenger) continue;
    const k = String(e.passenger);
    if (e.type === "passenger_boarded")
      state.set(k, {
        status: "boarded",
        at: e.at,
        stopSequence: e.stopSequence,
      });
    else if (e.type === "passenger_dropped")
      state.set(k, {
        status: "dropped",
        at: e.at,
        stopSequence: e.stopSequence,
      });
    else if (e.type === "passenger_missing")
      state.set(k, {
        status: "missing",
        at: e.at,
        stopSequence: e.stopSequence,
      });
  }
  return state;
}
