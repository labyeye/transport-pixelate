// GPS provider adapters. An adapter turns a provider's raw request body into normalized pings:
//   { lat, lng, recordedAt, speedKmh?, heading?, accuracyM? }
// To support a new tracker, add a module here that exports `parse(body)` and register it below.
// Each adapter must be tested against the real device/protocol before being relied upon.
import { z } from "zod";

const num = z.coerce.number();
const genericPing = z.object({
  lat: num.min(-90).max(90),
  lng: num.min(-180).max(180),
  timestamp: z.coerce.date(),
  speedKmh: num.min(0).max(300).optional(),
  heading: num.min(0).max(360).optional(),
  accuracyM: num.min(0).max(100000).optional(),
});

// Our documented JSON format: a single ping, or { pings: [...] } (max 100) for buffered batches.
const generic = {
  key: "generic",
  parse(body) {
    const list = Array.isArray(body?.pings) ? body.pings : [body];
    if (list.length > 100) throw new Error("At most 100 pings per request");
    return list.map((p) => {
      const r = genericPing.parse(p);
      return {
        lat: r.lat,
        lng: r.lng,
        recordedAt: r.timestamp,
        speedKmh: r.speedKmh,
        heading: r.heading,
        accuracyM: r.accuracyM,
      };
    });
  },
};

export const providers = { [generic.key]: generic };
export const providerKeys = Object.keys(providers);
