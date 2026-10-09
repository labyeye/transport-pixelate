import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Driver } from "../models/Driver.js";
import { TripEvent } from "../models/TripEvent.js";

let mongod;
const app = createApp(["http://localhost"]);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
let n = 0;

async function setup(email) {
  const reg = (
    await request(app)
      .post("/api/v1/auth/register")
      .send({
        organizationName: "Org " + email,
        name: "Owner",
        email,
        password: "password123",
      })
  ).body.data;
  const t = reg.accessToken;
  const post = async (url, body) =>
    (await request(app).post(url).set(auth(t)).send(body)).body.data;
  const route = await post("/api/v1/routes", {
    name: "Route One",
    code: "R1",
    stops: [
      { name: "Home", lat: 1, lng: 1 },
      { name: "Mid", lat: 2, lng: 2, allowsPickup: false },
      { name: "School", lat: 3, lng: 3 },
    ],
  });
  const vehicle = await post("/api/v1/vehicles", {
    registrationNumber: `MH12AB${2000 + ++n}`,
    capacity: 30,
  });
  const driver = await post("/api/v1/drivers", {
    name: "Dev Driver",
    phone: "9876543210",
    licence: { number: "L" + n, expiryDate: "2035-01-01" },
  });
  const kid = await post("/api/v1/passengers", {
    name: "Asha Rao",
    identifier: "A-" + n,
  });
  const kid2 = await post("/api/v1/passengers", {
    name: "Bala Iyer",
    identifier: "B-" + n,
  });
  for (const k of [kid, kid2])
    await post(`/api/v1/passengers/${k._id}/assignments`, {
      route: route._id,
      pickupStop: "Home",
      dropStop: "School",
    });
  const trip = await post("/api/v1/trips", {
    route: route._id,
    scheduledDate: "2030-01-15",
    departureTime: "07:00",
    durationMin: 60,
    vehicle: vehicle._id,
    driver: driver._id,
  });
  const move = (to, extra = {}) =>
    request(app)
      .post(`/api/v1/trips/${trip._id}/transition`)
      .set(auth(t))
      .send({ to, ...extra });
  const ev = (body, token = t) =>
    request(app)
      .post(`/api/v1/trips/${trip._id}/events`)
      .set(auth(token))
      .send(body);
  const manifest = async () =>
    (await request(app).get(`/api/v1/trips/${trip._id}/manifest`).set(auth(t)))
      .body.data;
  return {
    reg,
    t,
    route,
    vehicle,
    driver,
    kid,
    kid2,
    trip,
    move,
    ev,
    manifest,
    post,
  };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("passengers", () => {
  it("validates assignments against route stops", async () => {
    const w = await setup("p1@x.com");
    const p = await w.post("/api/v1/passengers", { name: "Chitra Nair" });
    const asg = (b) =>
      request(app)
        .post(`/api/v1/passengers/${p._id}/assignments`)
        .set(auth(w.t))
        .send({ route: w.route._id, ...b });
    expect((await asg({ pickupStop: "Mid", dropStop: "School" })).status).toBe(
      409,
    ); // Mid doesn't allow pickup
    expect((await asg({ pickupStop: "School", dropStop: "Home" })).status).toBe(
      409,
    ); // order
    expect(
      (await asg({ pickupStop: "Nowhere", dropStop: "School" })).status,
    ).toBe(409);
    expect((await asg({ pickupStop: "Home", dropStop: "School" })).status).toBe(
      201,
    );
  });
});

describe("trip events & manifest", () => {
  it("only records events while the trip is live", async () => {
    const w = await setup("e1@x.com");
    expect((await w.ev({ type: "note", notes: "hi" })).status).toBe(409);
    await w.move("ready");
    await w.move("in_progress");
    expect((await w.ev({ type: "note", notes: "hi" })).status).toBe(201);
    expect((await w.ev({ type: "incident_reported" })).status).toBe(400); // needs description
    expect(
      (
        await w.ev({
          type: "note",
          notes: "x",
          at: new Date(Date.now() + 3600000).toISOString(),
        })
      ).status,
    ).toBe(400); // future
  });

  it("tracks boarding/drop-off and blocks duplicates", async () => {
    const w = await setup("e2@x.com");
    await w.move("ready");
    await w.move("in_progress");
    const board = {
      type: "passenger_boarded",
      passenger: w.kid._id,
      stopSequence: 1,
    };
    expect(
      (
        await w.ev({
          type: "passenger_dropped",
          passenger: w.kid._id,
          stopSequence: 3,
        })
      ).status,
    ).toBe(409); // not boarded
    expect((await w.ev(board)).status).toBe(201);
    expect((await w.ev(board)).status).toBe(409); // duplicate
    expect(
      (
        await w.ev({
          type: "passenger_dropped",
          passenger: w.kid._id,
          stopSequence: 2,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await w.ev({
          type: "passenger_dropped",
          passenger: w.kid._id,
          stopSequence: 3,
        })
      ).status,
    ).toBe(409); // already dropped
    expect(
      (
        await w.ev({
          type: "passenger_boarded",
          passenger: w.kid._id,
          stopSequence: 2,
        })
      ).status,
    ).toBe(409); // Mid doesn't allow boarding
    const m = await w.manifest();
    expect(m.passengers.find((p) => p.passenger._id === w.kid._id).status).toBe(
      "dropped",
    );
    expect(
      m.passengers.find((p) => p.passenger._id === w.kid2._id).status,
    ).toBe("pending");
    expect(
      (
        await w.ev({
          type: "passenger_missing",
          passenger: w.kid2._id,
          stopSequence: 1,
        })
      ).status,
    ).toBe(201);
    // Passenger not on this route's manifest is refused.
    const stranger = await w.post("/api/v1/passengers", {
      name: "Dev Stranger",
    });
    expect(
      (
        await w.ev({
          type: "passenger_boarded",
          passenger: stranger._id,
          stopSequence: 1,
        })
      ).status,
    ).toBe(409);
  });

  it("corrects mistakes without modifying history", async () => {
    const w = await setup("e3@x.com");
    await w.move("ready");
    await w.move("in_progress");
    const first = (
      await w.ev({
        type: "passenger_boarded",
        passenger: w.kid._id,
        stopSequence: 1,
      })
    ).body.data;
    const fix = await request(app)
      .post(`/api/v1/trips/${w.trip._id}/events/${first._id}/correct`)
      .set(auth(w.t))
      .send({ reason: "Wrong child tapped" });
    expect(fix.status).toBe(201);
    // Original document is byte-for-byte unchanged in the DB.
    const stored = await TripEvent.findById(first._id).lean();
    expect(stored.type).toBe("passenger_boarded");
    expect(stored.corrects).toBeUndefined();
    // Effective state reverts to pending, so boarding is possible again.
    expect(
      (await w.manifest()).passengers.find((p) => p.passenger._id === w.kid._id)
        .status,
    ).toBe("pending");
    expect(
      (
        await w.ev({
          type: "passenger_boarded",
          passenger: w.kid._id,
          stopSequence: 1,
        })
      ).status,
    ).toBe(201);
    // Double-correct refused; history shows original flagged superseded.
    expect(
      (
        await request(app)
          .post(`/api/v1/trips/${w.trip._id}/events/${first._id}/correct`)
          .set(auth(w.t))
          .send({ reason: "again" })
      ).status,
    ).toBe(409);
    const list = (
      await request(app)
        .get(`/api/v1/trips/${w.trip._id}/events`)
        .set(auth(w.t))
    ).body.data;
    expect(list.find((e) => e._id === first._id).superseded).toBe(true);
    expect(list.filter((e) => e.type === "correction")).toHaveLength(1);
  });

  it("is idempotent for offline replay via clientId", async () => {
    const w = await setup("e4@x.com");
    await w.move("ready");
    await w.move("in_progress");
    const body = {
      type: "note",
      notes: "queued",
      clientId: "device-1-0001",
      source: "mobile",
    };
    const a = await w.ev(body);
    const b = await w.ev(body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.duplicate).toBe(true);
    expect(await TripEvent.countDocuments({ clientId: "device-1-0001" })).toBe(
      1,
    );
  });

  it("records system events and delays move the trip to delayed", async () => {
    const w = await setup("e5@x.com");
    await w.move("ready");
    await w.move("in_progress");
    await w.ev({ type: "delay_reported", notes: "Road closed" });
    expect(
      (await request(app).get(`/api/v1/trips/${w.trip._id}`).set(auth(w.t)))
        .body.data.status,
    ).toBe("delayed");
    await w.move("completed");
    const types = (
      await request(app)
        .get(`/api/v1/trips/${w.trip._id}/events`)
        .set(auth(w.t))
    ).body.data.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "trip_created",
        "driver_assigned",
        "vehicle_assigned",
        "trip_started",
        "delay_reported",
        "trip_completed",
      ]),
    );
  });

  it("restricts drivers to their own trips and keeps tenants apart", async () => {
    const w = await setup("e6@x.com");
    await w.move("ready");
    await w.move("in_progress");
    const mk = async (email, link) => {
      const u = await User.create({
        organization: w.reg.user.organization,
        name: "Drv",
        email,
        password: await bcrypt.hash("password123", 4),
        role: "driver",
      });
      if (link) await Driver.updateOne({ _id: w.driver._id }, { user: u._id });
      return (
        await request(app)
          .post("/api/v1/auth/login")
          .send({ email, password: "password123" })
      ).body.data.accessToken;
    };
    const stranger = await mk("drv-other@x.com", false);
    const mine = await mk("drv-mine@x.com", true);
    expect((await w.ev({ type: "note", notes: "x" }, stranger)).status).toBe(
      403,
    );
    expect((await w.ev({ type: "note", notes: "x" }, mine)).status).toBe(201);
    // Drivers can't correct events (dispatch permission).
    const e = (await w.ev({ type: "note", notes: "y" }, mine)).body.data;
    expect(
      (
        await request(app)
          .post(`/api/v1/trips/${w.trip._id}/events/${e._id}/correct`)
          .set(auth(mine))
          .send({ reason: "nope" })
      ).status,
    ).toBe(403);
    const other = await setup("e6b@x.com");
    expect(
      (
        await request(app)
          .get(`/api/v1/trips/${w.trip._id}/manifest`)
          .set(auth(other.t))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/v1/trips/${w.trip._id}/events`)
          .set(auth(other.t))
      ).status,
    ).toBe(404);
  });
});
