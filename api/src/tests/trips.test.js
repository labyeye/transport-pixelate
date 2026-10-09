import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";

let mongod;
const app = createApp(["http://localhost"]);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
let n = 0;

async function world(email) {
  const t = (
    await request(app)
      .post("/api/v1/auth/register")
      .send({
        organizationName: "Org " + email,
        name: "Owner",
        email,
        password: "password123",
      })
  ).body.data.accessToken;
  const post = async (url, body) =>
    (await request(app).post(url).set(auth(t)).send(body)).body.data;
  const route = await post("/api/v1/routes", {
    name: "Route One",
    code: "R1",
    stops: [
      { name: "A", lat: 1, lng: 1 },
      { name: "B", lat: 2, lng: 2 },
    ],
  });
  const mkVehicle = () =>
    post("/api/v1/vehicles", {
      registrationNumber: `MH12AB${String(1000 + ++n)}`,
      capacity: 30,
    });
  const mkDriver = () =>
    post("/api/v1/drivers", {
      name: "Driver " + ++n,
      phone: "9876543210",
      licence: { number: "LIC" + n, expiryDate: "2035-01-01" },
    });
  return {
    t,
    post,
    route,
    mkVehicle,
    mkDriver,
    get: (u) => request(app).get(u).set(auth(t)),
  };
}
const tripBody = (w, extra = {}) => ({
  route: w.route._id,
  scheduledDate: "2030-01-15",
  departureTime: "07:00",
  durationMin: 60,
  ...extra,
});
const move = (w, id, to, extra = {}) =>
  request(app)
    .post(`/api/v1/trips/${id}/transition`)
    .set(auth(w.t))
    .send({ to, ...extra });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("trips", () => {
  it("creates a numbered trip with a route snapshot that survives route edits", async () => {
    const w = await world("t1@x.com");
    const trip = (
      await request(app).post("/api/v1/trips").set(auth(w.t)).send(tripBody(w))
    ).body.data;
    expect(trip.tripNumber).toBe("TRP-00001");
    expect(trip.status).toBe("scheduled");
    expect(trip.routeSnapshot.stops).toHaveLength(2);
    // 07:00 IST == 01:30 UTC
    expect(new Date(trip.scheduledDeparture).toISOString()).toBe(
      "2030-01-15T01:30:00.000Z",
    );
    await request(app)
      .put(`/api/v1/routes/${w.route._id}`)
      .set(auth(w.t))
      .send({
        name: "Route One",
        code: "R1",
        stops: [{ name: "Z", lat: 5, lng: 5 }],
      });
    const after = (await w.get(`/api/v1/trips/${trip._id}`)).body.data;
    expect(after.routeSnapshot.stops.map((s) => s.name)).toEqual(["A", "B"]);
    expect(after.routeSnapshot.version).toBe(1);
  });

  it("runs the full lifecycle and releases vehicle and driver", async () => {
    const w = await world("t2@x.com");
    const v = await w.mkVehicle(),
      d = await w.mkDriver();
    const trip = (
      await request(app)
        .post("/api/v1/trips")
        .set(auth(w.t))
        .send(tripBody(w, { vehicle: v._id, driver: d._id }))
    ).body.data;
    expect(trip.status).toBe("assigned");
    expect((await move(w, trip._id, "in_progress")).status).toBe(409); // must be ready first
    expect((await move(w, trip._id, "ready")).status).toBe(200);
    expect((await move(w, trip._id, "in_progress")).status).toBe(200);
    expect((await w.get(`/api/v1/vehicles/${v._id}`)).body.data.status).toBe(
      "on_trip",
    );
    expect((await move(w, trip._id, "delayed")).status).toBe(400); // reason required
    expect(
      (await move(w, trip._id, "delayed", { reason: "Traffic" })).status,
    ).toBe(200);
    expect(
      (await move(w, trip._id, "completed", { actualDistanceKm: 12 })).status,
    ).toBe(200);
    expect((await w.get(`/api/v1/vehicles/${v._id}`)).body.data.status).toBe(
      "available",
    );
    expect((await w.get(`/api/v1/drivers/${d._id}`)).body.data.status).toBe(
      "active",
    );
    // Terminal: cannot restart, cancel or edit.
    expect((await move(w, trip._id, "in_progress")).status).toBe(409);
    expect((await move(w, trip._id, "cancelled", { reason: "x" })).status).toBe(
      409,
    );
    expect(
      (
        await request(app)
          .put(`/api/v1/trips/${trip._id}`)
          .set(auth(w.t))
          .send(tripBody(w, { route: undefined }))
      ).status,
    ).toBe(409);
    const hist = (await w.get(`/api/v1/trips/${trip._id}`)).body.data.history;
    expect(hist.map((h) => h.to)).toEqual([
      "assigned",
      "ready",
      "in_progress",
      "delayed",
      "completed",
    ]);
  });

  it("prevents overlapping vehicle/driver assignments but allows back-to-back", async () => {
    const w = await world("t3@x.com");
    const v = await w.mkVehicle(),
      d = await w.mkDriver(),
      d2 = await w.mkDriver();
    const res = (b) =>
      request(app).post("/api/v1/trips").set(auth(w.t)).send(tripBody(w, b));
    expect((await res({ vehicle: v._id, driver: d._id })).status).toBe(201);
    expect((await res({ departureTime: "07:30", vehicle: v._id })).status).toBe(
      409,
    ); // same vehicle overlaps
    expect((await res({ departureTime: "07:30", driver: d._id })).status).toBe(
      409,
    ); // same driver overlaps
    expect(
      (await res({ departureTime: "07:30", vehicle: v._id, driver: d._id }))
        .status,
    ).toBe(409);
    expect((await res({ departureTime: "07:30", driver: d2._id })).status).toBe(
      201,
    ); // different resources fine
    expect(
      (await res({ departureTime: "08:00", vehicle: v._id, driver: d._id }))
        .status,
    ).toBe(201); // starts when previous ends
  });

  it("rejects unavailable vehicles/drivers and cross-tenant resources", async () => {
    const w = await world("t4@x.com");
    const other = await world("t4b@x.com");
    const v = await w.mkVehicle(),
      d = await w.mkDriver();
    await request(app)
      .patch(`/api/v1/vehicles/${v._id}/status`)
      .set(auth(w.t))
      .send({ status: "maintenance" });
    const post = (b) =>
      request(app).post("/api/v1/trips").set(auth(w.t)).send(tripBody(w, b));
    expect((await post({ vehicle: v._id })).status).toBe(409);
    await request(app)
      .patch(`/api/v1/drivers/${d._id}/status`)
      .set(auth(w.t))
      .send({ status: "suspended" });
    expect((await post({ driver: d._id })).status).toBe(409);
    const ov = await other.mkVehicle();
    expect((await post({ vehicle: ov._id })).status).toBe(404);
    expect(
      (await request(app).get(`/api/v1/trips`).set(auth(other.t))).body.data,
    ).toHaveLength(0);
  });

  it("cancels with reason and frees the slot; replaces a driver with history", async () => {
    const w = await world("t5@x.com");
    const v = await w.mkVehicle(),
      d = await w.mkDriver(),
      d2 = await w.mkDriver();
    const trip = (
      await request(app)
        .post("/api/v1/trips")
        .set(auth(w.t))
        .send(tripBody(w, { vehicle: v._id, driver: d._id }))
    ).body.data;
    expect((await move(w, trip._id, "cancelled")).status).toBe(400);
    const rep = await request(app)
      .post(`/api/v1/trips/${trip._id}/replace`)
      .set(auth(w.t))
      .send({ driver: d2._id, reason: "Driver sick" });
    expect(rep.status).toBe(200);
    expect(rep.body.data.driver).toBe(d2._id);
    expect(
      (await move(w, trip._id, "cancelled", { reason: "Holiday" })).status,
    ).toBe(200);
    // Slot is free again.
    expect(
      (
        await request(app)
          .post("/api/v1/trips")
          .set(auth(w.t))
          .send(tripBody(w, { vehicle: v._id, driver: d2._id }))
      ).status,
    ).toBe(201);
  });

  it("blocks starting when the vehicle is already on another trip", async () => {
    const w = await world("t6@x.com");
    const v = await w.mkVehicle(),
      d = await w.mkDriver(),
      d2 = await w.mkDriver();
    const a = (
      await request(app)
        .post("/api/v1/trips")
        .set(auth(w.t))
        .send(tripBody(w, { vehicle: v._id, driver: d._id }))
    ).body.data;
    const b = (
      await request(app)
        .post("/api/v1/trips")
        .set(auth(w.t))
        .send(
          tripBody(w, {
            departureTime: "09:00",
            vehicle: v._id,
            driver: d2._id,
          }),
        )
    ).body.data;
    await move(w, a._id, "ready");
    await move(w, a._id, "in_progress");
    await move(w, b._id, "ready");
    const start = await move(w, b._id, "in_progress");
    expect(start.status).toBe(409);
  });
});

describe("recurring schedules", () => {
  it("generates trips only on selected days, idempotently, within limits", async () => {
    const w = await world("s1@x.com");
    const v = await w.mkVehicle(),
      d = await w.mkDriver();
    const sch = (
      await request(app)
        .post("/api/v1/trip-schedules")
        .set(auth(w.t))
        .send({
          name: "Weekday morning",
          route: w.route._id,
          tripType: "morning",
          daysOfWeek: [1, 2, 3, 4, 5],
          startDate: "2030-02-01",
          departureTime: "07:00",
          durationMin: 60,
          vehicle: v._id,
          driver: d._id,
        })
    ).body.data;
    const gen = () =>
      request(app)
        .post(`/api/v1/trip-schedules/${sch._id}/generate`)
        .set(auth(w.t))
        .send({ from: "2030-02-04", to: "2030-02-10" }); // Mon..Sun
    const first = await gen();
    expect(first.body.data.created).toHaveLength(5);
    const second = await gen();
    expect(second.body.data.created).toHaveLength(0);
    expect(second.body.data.skipped).toHaveLength(5);
    const list = await w.get(
      "/api/v1/trips?from=2030-02-04&to=2030-02-10&limit=50",
    );
    expect(list.body.data).toHaveLength(5);
    expect(
      (
        await request(app)
          .post(`/api/v1/trip-schedules/${sch._id}/generate`)
          .set(auth(w.t))
          .send({ from: "2030-01-01", to: "2030-12-31" })
      ).status,
    ).toBe(400);
  });

  it("creates conflicting days unassigned and reports them", async () => {
    const w = await world("s2@x.com");
    const v = await w.mkVehicle(),
      d = await w.mkDriver();
    await request(app)
      .post("/api/v1/trips")
      .set(auth(w.t))
      .send(
        tripBody(w, {
          scheduledDate: "2030-03-05",
          vehicle: v._id,
          driver: d._id,
        }),
      );
    const sch = (
      await request(app)
        .post("/api/v1/trip-schedules")
        .set(auth(w.t))
        .send({
          name: "Tuesday run",
          route: w.route._id,
          daysOfWeek: [2],
          startDate: "2030-03-01",
          departureTime: "07:15",
          durationMin: 30,
          vehicle: v._id,
          driver: d._id,
        })
    ).body.data;
    const out = (
      await request(app)
        .post(`/api/v1/trip-schedules/${sch._id}/generate`)
        .set(auth(w.t))
        .send({ from: "2030-03-05", to: "2030-03-05" })
    ).body.data; // Tuesday
    expect(out.created).toHaveLength(0);
    expect(out.skipped[0].reason).toMatch(/created unassigned/);
    const t = (await w.get("/api/v1/trips?date=2030-03-05")).body.data;
    expect(
      t.find((x) => x.tripNumber === out.skipped[0].tripNumber).vehicle,
    ).toBeNull();
  });
});
