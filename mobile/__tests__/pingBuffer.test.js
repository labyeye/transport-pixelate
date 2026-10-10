import { add, clear, drop, size, takeBatch, toPing, trim } from '../src/lib/pingBuffer';

beforeEach(async () => { await clear(); });

describe('ping buffer', () => {
  it('uploads oldest first, in batches, and drops only what was sent', async () => {
    for (let i = 0; i < 5; i++) await add({ lat: i, lng: i, timestamp: `t${i}` });
    const batch = await takeBatch(3);
    expect(batch.map(p => p.timestamp)).toEqual(['t0', 't1', 't2']);
    await drop(3);
    expect((await takeBatch(10)).map(p => p.timestamp)).toEqual(['t3', 't4']);
    expect(await size()).toBe(2);
  });
  it('keeps only the newest fixes when the phone was offline for ages', () => {
    const list = Array.from({ length: 12 }, (_, i) => i);
    expect(trim(list, 5)).toEqual([7, 8, 9, 10, 11]);
  });
  it('converts a position to the API format, converting speed m/s to km/h and omitting unknowns', () => {
    const p = toPing({ timestamp: 1893456000000, coords: { latitude: 19.07, longitude: 72.87, speed: 10, heading: -1, accuracy: 6 } });
    expect(p).toEqual({ lat: 19.07, lng: 72.87, timestamp: new Date(1893456000000).toISOString(), speedKmh: 36, accuracyM: 6 });
    expect(toPing({ coords: { latitude: 1, longitude: 2, speed: -1, heading: NaN, accuracy: NaN }, timestamp: 0 })).not.toHaveProperty('speedKmh');
  });
});
