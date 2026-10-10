import { actionsFor, sortTrips, startWindow } from '../src/lib/tripRules';

const NOW = new Date('2030-01-15T06:00:00Z').getTime();
const trip = (over = {}) => ({ status: 'ready', myRole: 'driver', scheduledDeparture: new Date(NOW + 20 * 60000).toISOString(), ...over });
const rules = { earliestStartMinutes: 60, latestStartHours: 12 };

describe('start window', () => {
  it('opens 60 minutes before departure', () => {
    expect(startWindow(trip({ scheduledDeparture: new Date(NOW + 90 * 60000).toISOString() }), rules, NOW)).toMatchObject({ ok: false, opensInMinutes: 30 });
    expect(startWindow(trip(), rules, NOW).ok).toBe(true);
  });
  it('closes long after departure', () => {
    expect(startWindow(trip({ scheduledDeparture: new Date(NOW - 13 * 3600000).toISOString() }), rules, NOW).ok).toBe(false);
  });
});

describe('actions', () => {
  it('offers ready only for assigned trips and only to the driver', () => {
    expect(actionsFor(trip({ status: 'assigned' }), rules, NOW).ready).toBe(true);
    expect(actionsFor(trip({ status: 'assigned', myRole: 'attendant' }), rules, NOW).ready).toBe(false);
  });
  it('offers start only when ready and inside the window, with a reason otherwise', () => {
    expect(actionsFor(trip(), rules, NOW).start).toBe(true);
    const early = actionsFor(trip({ scheduledDeparture: new Date(NOW + 5 * 3600000).toISOString() }), rules, NOW);
    expect(early.start).toBe(false);
    expect(early.startBlockedReason).toMatch(/60 minutes/);
  });
  it('lets the whole crew record stops and report issues on live trips, but only the driver completes', () => {
    const d = actionsFor(trip({ status: 'in_progress' }), rules, NOW);
    expect(d).toMatchObject({ complete: true, recordStops: true, boarding: true, report: true, emergency: true, start: false });
    const a = actionsFor(trip({ status: 'delayed', myRole: 'attendant' }), rules, NOW);
    expect(a).toMatchObject({ complete: false, boarding: true, emergency: true });
  });
  it('offers nothing on finished trips', () => {
    const a = actionsFor(trip({ status: 'completed' }), rules, NOW);
    expect(Object.values(a).filter(v => v === true)).toHaveLength(0);
  });
});

describe('sorting', () => {
  it('puts live trips first, finished trips last, then by time', () => {
    const list = [trip({ status: 'completed', id: 1 }), trip({ status: 'assigned', id: 2 }), trip({ status: 'in_progress', id: 3 })];
    expect(sortTrips(list).map(t => t.id)).toEqual([3, 2, 1]);
  });
});
