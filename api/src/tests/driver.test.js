import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Driver } from "../models/Driver.js";
import { Trip } from "../models/Trip.js";
import { TripEvent } from "../models/TripEvent.js";
import { Vehicle } from "../models/Vehicle.js";

let mongod;
const app = createApp(["http://localhost"]);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

async function world(email) {
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
  const org = reg.user.organization;
  const t = reg.accessToken;
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
  const mkStaff = async (
    role,
    label,
    { link = true, phone = "9876543210" } = {},
  ) => {
    const profile = await post("/api/v1/drivers", {
      staffRole: role,
      name: `${label} ${++n}`,
      phone,
      licence:
        role === "driver"
          ? { number: "LD" + n, expiryDate: "2035-01-01" }
          : undefined,
    });
    const em = `${role}${n}@x.com`;
    const u = await User.create({
      organization: org,
      name: profile.name,
      email: em,
      password: await bcrypt.hash("password123", 4),
      role,
    });
    if (link) await Driver.updateOne({ _id: profile._id }, { user: u._id });
    const tok = (
      await request(app)
        .post("/api/v1/auth/login")
        .send({ email: em, password: "password123" })
    ).body.data.accessToken;
    return { profile, tok, user: u };
  };
  const vehicle = await post("/api/v1/vehicles", {
    registrationNumber: `MH12AB${9000 + ++n}`,
    capacity: 30,
  });
  const trip = async (driver, extra = {}) => {
    const d = await post("/api/v1/trips", {
      route: route._id,
      scheduledDate: today(),
      departureTime: "07:00",
      durationMin: 60,
      vehicle: vehicle._id,
      driver: driver.profile._id,
      ...extra,
    });
    return d;
  };
  // Put the departure at a chosen offset from now so time-window rules are testable.
  const departIn = (tripDoc, minutes) =>
    Trip.updateOne(
      { _id: tripDoc._id },
      {
        scheduledDeparture: new Date(Date.now() + minutes * 60000),
        expectedArrival: new Date(Date.now() + (minutes + 60) * 60000),
      },
    );
  const call = (method, url, tok, body) =>
    request(app)[method](url).set(auth(tok)).send(body);
  return {
    reg,
    org,
    t,
    post,
    route,
    vehicle,
    mkStaff,
    trip,
    departIn,
    call,
    get: (u, tok = t) => request(app).get(u).set(auth(tok)),
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

describe("driver profile & trip list", () => {
  it("requires a linked profile and returns the driver's context", async () => {
    const w = await world("d1@x.com");
    const unlinked = await w.mkStaff("driver", "Unlinked", { link: false });
    expect((await w.get("/api/v1/driver/me", unlinked.tok)).status).toBe(403);
    expect((await w.get("/api/v1/driver/trips", unlinked.tok)).status).toBe(
      403,
    );
    await w.post("/api/v1/users", {
      name: "Dina Dispatch",
      email: "dina-d1@x.com",
      role: "dispatcher",
      phone: "9000000001",
    });
    const d = await w.mkStaff("driver", "Linked");
    const me = (await w.get("/api/v1/driver/me", d.tok)).body.data;
    expect(me.driver.name).toBe(d.profile.name);
    expect(me.organization.timezone).toBe("Asia/Kolkata");
    expect(me.rules.earliestStartMinutes).toBe(60);
    expect(me.contacts.some((c) => c.name === "Dina Dispatch")).toBe(true);
    expect((await request(app).get("/api/v1/driver/me")).status).toBe(401);
    const viewer = await w.get("/api/v1/driver/me", w.t); // owner with no driver profile
    expect(viewer.status).toBe(403);
  });

  it("lists only my trips (as driver or attendant) and hides everyone else's everywhere", async () => {
    const w = await world("d2@x.com");
    const d1 = await w.mkStaff("driver", "One"),
      d2 = await w.mkStaff("driver", "Two");
    const att = await w.mkStaff("attendant", "Helper");
    const mine = await w.trip(d1, { attendant: att.profile._id });
    const theirs = await w.trip(d2, {
      departureTime: "11:00",
      vehicle: undefined,
    });
    const l1 = (await w.get("/api/v1/driver/trips", d1.tok)).body.data;
    expect(l1.map((t) => t.tripNumber)).toEqual([mine.tripNumber]);
    expect(l1[0].myRole).toBe("driver");
    expect(l1[0].route.stops).toHaveLength(2);
    expect(
      (await w.get("/api/v1/driver/trips", att.tok)).body.data[0],
    ).toMatchObject({ tripNumber: mine.tripNumber, myRole: "attendant" });
    // General endpoints are restricted to the same set.
    expect(
      (await w.get("/api/v1/trips", d1.tok)).body.data.map((t) => t.tripNumber),
    ).toEqual([mine.tripNumber]);
    expect((await w.get(`/api/v1/trips/${theirs._id}`, d1.tok)).status).toBe(
      403,
    );
    expect(
      (await w.get(`/api/v1/trips/${theirs._id}/manifest`, d1.tok)).status,
    ).toBe(403);
    expect(
      (await w.get(`/api/v1/trips/${theirs._id}/events`, d1.tok)).status,
    ).toBe(403);
    expect((await w.get(`/api/v1/trips/${mine._id}`, d1.tok)).status).toBe(200);
    expect((await w.get("/api/v1/trips", w.t)).body.data).toHaveLength(2); // staff still see all
    const other = await world("d2b@x.com");
    expect((await other.get("/api/v1/driver/trips", w.t)).status).toBe(403);
  });
});

describe("running a trip from the phone", () => {
  it("follows ready → start → complete with time-window and role checks", async () => {
    const w = await world("d3@x.com");
    const d = await w.mkStaff("driver", "Runner");
    const att = await w.mkStaff("attendant", "Helper");
    const t = await w.trip(d, { attendant: att.profile._id });
    const act = (what, tok = d.tok, body) =>
      w.call("post", `/api/v1/driver/trips/${t._id}/${what}`, tok, body);
    expect((await act("start")).status).toBe(409); // must confirm ready first
    expect((await act("ready", att.tok)).status).toBe(403); // attendants can't
    await w.departIn(t, 180);
    expect((await act("ready")).status).toBe(200);
    expect((await act("ready")).body.repeated).toBe(true);
    expect((await act("start")).status).toBe(409); // 3 hours early
    await w.departIn(t, 30);
    expect((await act("start", att.tok)).status).toBe(403);
    const start = await act("start");
    expect(start.status).toBe(200);
    expect(start.body.data.status).toBe("in_progress");
    expect((await Vehicle.findById(w.vehicle._id)).status).toBe("on_trip");
    expect((await act("start")).body.repeated).toBe(true); // queued replay is harmless
    expect(
      (await act("complete", d.tok, { actualDistanceKm: 18.5 })).status,
    ).toBe(200);
    expect((await act("complete")).body.repeated).toBe(true);
    const done = await Trip.findById(t._id);
    expect(done).toMatchObject({ status: "completed", actualDistanceKm: 18.5 });
    expect((await Vehicle.findById(w.vehicle._id)).status).not.toBe("on_trip");
    expect((await act("start")).status).toBe(409); // a completed trip can't be restarted
  });

  it("refuses to restart a completed trip and trips that are too stale", async () => {
    const w = await world("d4@x.com");
    const d = await w.mkStaff("driver", "Late");
    const t = await w.trip(d);
    const act = (what, body) =>
      w.call("post", `/api/v1/driver/trips/${t._id}/${what}`, d.tok, body);
    await w.departIn(t, -13 * 60); // 13 hours ago
    expect((await act("ready")).status).toBe(200);
    const late = await act("start");
    expect(late.status).toBe(409);
    expect(late.body.message).toMatch(/too far past/);
    await Trip.updateOne({ _id: t._id }, { status: "completed" });
    expect((await act("start")).status).toBe(409);
    expect((await act("ready")).status).toBe(409);
  });

  it("won't start when the vehicle is already out, or in the workshop", async () => {
    const w = await world("d5@x.com");
    const d1 = await w.mkStaff("driver", "A"),
      d2 = await w.mkStaff("driver", "B");
    const t1 = await w.trip(d1),
      t2 = await w.trip(d2, { departureTime: "09:00" });
    for (const t of [t1, t2]) await w.departIn(t, 20);
    const go = (t, tok) =>
      w.call("post", `/api/v1/driver/trips/${t._id}/ready`, tok);
    await go(t1, d1.tok);
    await go(t2, d2.tok);
    expect(
      (await w.call("post", `/api/v1/driver/trips/${t1._id}/start`, d1.tok))
        .status,
    ).toBe(200);
    const clash = await w.call(
      "post",
      `/api/v1/driver/trips/${t2._id}/start`,
      d2.tok,
    );
    expect(clash.status).toBe(409);
    expect(clash.body.message).toMatch(/already on another trip/);
  });

  it("accepts location pings and events only for my live trip", async () => {
    const w = await world("d6@x.com");
    const d = await w.mkStaff("driver", "Tracker");
    const t = await w.trip(d);
    const ping = () =>
      w.call("post", "/api/v1/tracking/mobile/ping", d.tok, {
        pings: [{ lat: 19.1, lng: 72.9, timestamp: new Date().toISOString() }],
      });
    expect((await ping()).status).toBe(403);
    await w.departIn(t, 10);
    await w.call("post", `/api/v1/driver/trips/${t._id}/ready`, d.tok);
    await w.call("post", `/api/v1/driver/trips/${t._id}/start`, d.tok);
    expect((await ping()).status).toBe(200);
    const ev = await w.call("post", `/api/v1/trips/${t._id}/events`, d.tok, {
      type: "stop_reached",
      stopSequence: 1,
      clientId: "mobile-event-0001",
      source: "mobile",
    });
    expect(ev.status).toBe(201);
    expect(
      (
        await w.call("post", `/api/v1/trips/${t._id}/events`, d.tok, {
          type: "stop_reached",
          stopSequence: 1,
          clientId: "mobile-event-0001",
          source: "mobile",
        })
      ).body.duplicate,
    ).toBe(true);
  });
});

describe("emergencies", () => {
  it("records an emergency, escalates to staff, and is idempotent", async () => {
    const w = await world("e1@x.com");
    const d = await w.mkStaff("driver", "Alarm");
    const att = await w.mkStaff("attendant", "Helper");
    const t = await w.trip(d, { attendant: att.profile._id });
    const raise = (tok, body) =>
      w.call("post", `/api/v1/driver/trips/${t._id}/emergency`, tok, body);
    expect((await raise(d.tok, { notes: "Smoke from engine" })).status).toBe(
      409,
    ); // trip not under way yet
    await w.departIn(t, 10);
    await w.call("post", `/api/v1/driver/trips/${t._id}/ready`, d.tok);
    const first = await raise(att.tok, {
      notes: "Smoke from engine",
      location: { lat: 19.1, lng: 72.9 },
      clientId: "emergency-0001",
    }); // attendants can raise it too
    expect(first.status).toBe(201);
    const again = await raise(att.tok, {
      notes: "Smoke from engine",
      clientId: "emergency-0001",
    });
    expect(again.body.duplicate).toBe(true);
    expect(
      await TripEvent.countDocuments({
        trip: t._id,
        type: "emergency_reported",
      }),
    ).toBe(1);
    let hit;
    for (let i = 0; i < 40 && !hit; i++) {
      hit = (await w.get("/api/v1/notifications")).body.data.find(
        (x) => x.event === "emergency",
      );
      if (!hit) await sleep(50);
    }
    expect(hit).toMatchObject({ severity: "critical" });
    expect(hit.title).toMatch(/EMERGENCY/);
    expect(hit.body).toContain("Smoke from engine");
    // Another driver can't raise one on someone else's trip.
    const other = await w.mkStaff("driver", "Other");
    expect(
      (
        await w.call(
          "post",
          `/api/v1/driver/trips/${t._id}/emergency`,
          other.tok,
          {},
        )
      ).status,
    ).toBe(404);
  });
});
