// Pure helpers for what a person may do with a trip right now. The server enforces the same rules;
// this just avoids showing buttons that would be refused.
export const LIVE = ['in_progress', 'delayed'];

export function minutesUntil(iso, now = Date.now()) {
  return Math.round((new Date(iso).getTime() - now) / 60000);
}

export function startWindow(trip, rules = { earliestStartMinutes: 60, latestStartHours: 12 }, now = Date.now()) {
  const mins = minutesUntil(trip.scheduledDeparture, now);
  if (mins > rules.earliestStartMinutes) {
    return { ok: false, reason: `You can start ${rules.earliestStartMinutes} minutes before departure`, opensInMinutes: mins - rules.earliestStartMinutes };
  }
  if (mins < -rules.latestStartHours * 60) return { ok: false, reason: 'This trip is too far past its scheduled time. Contact dispatch.' };
  return { ok: true };
}

/** Which actions to offer for a trip, for a person acting as 'driver' or 'attendant'. */
export function actionsFor(trip, rules, now = Date.now()) {
  const isDriver = trip.myRole === 'driver';
  const live = LIVE.includes(trip.status);
  const w = startWindow(trip, rules, now);
  return {
    ready: isDriver && trip.status === 'assigned',
    start: isDriver && trip.status === 'ready' && w.ok,
    startBlockedReason: isDriver && trip.status === 'ready' && !w.ok ? w.reason : null,
    complete: isDriver && live,
    recordStops: live,
    boarding: live,
    report: live,
    emergency: live || trip.status === 'ready',
    waitingForDispatch: isDriver && ['scheduled', 'draft'].includes(trip.status),
  };
}

export function sortTrips(trips) {
  const order = { in_progress: 0, delayed: 0, ready: 1, assigned: 2, scheduled: 3, completed: 8, cancelled: 9, aborted: 9 };
  return [...trips].sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5) || new Date(a.scheduledDeparture) - new Date(b.scheduledDeparture));
}

export const STATUS_LABEL = {
  scheduled: 'Scheduled', assigned: 'Assigned', ready: 'Ready', in_progress: 'In progress', delayed: 'Delayed',
  completed: 'Completed', cancelled: 'Cancelled', aborted: 'Aborted', draft: 'Draft',
};

export const hhmm = iso => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
