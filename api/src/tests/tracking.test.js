import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import http from "http";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { io as ioc } from "socket.io-client";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { attachRealtime, closeRealtime } from "../realtime.js";
import { User } from "../models/User.js";
import { Driver } from "../models/Driver.js";
import { LocationPing } from "../models/LocationPing.js";
import { freshness } from "../modules/tracking/tracking.service.js";

let mongod, server, base;
const app = createApp(["http://localhost"]);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
let n = 0;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

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
  const vehicle = await post("/api/v1/vehicles", {
    registrationNumber: `MH12AB${3000 + ++n}`,
    capacity: 30,
  });
  const device = await post("/api/v1/tracking/devices", {
    name: "Tracker 1",
    vehicle: vehicle._id,
  });
  const ping = (body, key = device.apiKey, id = device.publicId) =>
    request(app)
      .post("/api/v1/tracking/ingest")
      .set("Authorization", `Device ${id}:${key}`)
      .send(body);
  const board = async () =>
    (await request(app).get("/api/v1/tracking/vehicles").set(auth(t))).body;
  return { reg, t, post, vehicle, device, ping, board };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  server = http.createServer(app);
  attachRealtime(server, ["http://localhost"]);
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
afterAll(async () => {
  closeRealtime();
  server.close();
  await mongoose.disconnect();
  await mongod.stop();
});

describe("freshness", () => {
  it("never labels an old fix as live", () => {
    const now = Date.now();
    expect(freshness(null)).toBe("no_signal");
    expect(freshness(new Date(now - 30_000), now)).toBe("live");
    expect(freshness(new Date(now - 5 * 60_000), now)).toBe("stale");
    expect(freshness(new Date(now - 60 * 60_000), now)).toBe("offline");
  });
});

describe("device ingestion", () => {
  it("authenticates devices and rejects bad credentials", async () => {
    const w = await setup("g1@x.com");
    const body = { lat: 19.07, lng: 72.87, timestamp: ago(1000) };
    expect((await w.ping(body)).status).toBe(200);
    expect((await w.ping(body, "a".repeat(64))).status).toBe(401); // wrong key
    expect((await w.ping(body, w.device.apiKey, "dev_unknown123")).status).toBe(
      401,
    );
    expect(
      (await request(app).post("/api/v1/tracking/ingest").send(body)).status,
    ).toBe(401); // no credentials
    // Disabled device
    await request(app)
      .patch(`/api/v1/tracking/devices/${w.device._id}`)
      .set(auth(w.t))
      .send({ active: false });
    expect((await w.ping({ ...body, timestamp: ago(500) })).status).toBe(403);
  });

  it("rejects malformed, null-island, future and ancient fixes", async () => {
    const w = await setup("g2@x.com");
    expect(
      (await w.ping({ lat: 91, lng: 0.5, timestamp: ago(1000) })).status,
    ).toBe(400);
    expect(
      (await w.ping({ lat: "abc", lng: 1, timestamp: ago(1000) })).status,
    ).toBe(400);
    expect(
      (await w.ping({ lat: 0, lng: 0, timestamp: ago(1000) })).status,
    ).toBe(400);
    expect(
      (
        await w.ping({
          lat: 10,
          lng: 10,
          timestamp: new Date(Date.now() + 3600_000).toISOString(),
        })
      ).status,
    ).toBe(400);
    expect(
      (await w.ping({ lat: 10, lng: 10, timestamp: ago(48 * 3600_000) }))
        .status,
    ).toBe(400);
    expect(await LocationPing.countDocuments({ vehicle: w.vehicle._id })).toBe(
      0,
    );
  });

  it("ignores duplicates and never rewinds the latest position with an older fix", async () => {
    const w = await setup("g3@x.com");
    const newer = { lat: 19.2, lng: 72.9, timestamp: ago(10_000) };
    const older = { lat: 19.1, lng: 72.8, timestamp: ago(60_000) };
    expect((await w.ping(newer)).body.data.accepted).toBe(1);
    const dup = await w.ping(newer);
    expect(dup.body.data.accepted).toBe(0);
    expect(dup.body.data.duplicates).toBe(1);
    // Buffered older fix arrives late: stored in history, but the live position stays on the newer one.
    expect((await w.ping(older)).body.data.accepted).toBe(1);
    const row = (await w.board()).data.find(
      (x) => x.vehicle._id === w.vehicle._id,
    );
    expect(row.position.lat).toBe(19.2);
    expect(row.freshness).toBe("live");
    expect(await LocationPing.countDocuments({ vehicle: w.vehicle._id })).toBe(
      2,
    );
  });

  it("accepts batches and reports partial rejection", async () => {
    const w = await setup("g4@x.com");
    const res = await w.ping({
      pings: [
        { lat: 12.9, lng: 77.5, timestamp: ago(30_000) },
        { lat: 12.91, lng: 77.51, timestamp: ago(20_000) },
        { lat: 0, lng: 0, timestamp: ago(10_000) },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.accepted).toBe(2);
    expect(res.body.data.rejected).toEqual([
      { index: 2, reason: expect.stringMatching(/null-island/) },
    ]);
  });

  it("reports staleness honestly on the board", async () => {
    const w = await setup("g5@x.com");
    await w.ping({ lat: 12.9, lng: 77.5, timestamp: ago(20 * 60_000) });
    const board = await w.board();
    expect(board.sourceConfigured).toBe(true);
    expect(board.data[0].freshness).toBe("offline");
    expect(board.data[0].position.recordedAt).toBeTruthy(); // timestamp is always exposed
  });

  it("invalidates the old key after rotation", async () => {
    const w = await setup("g6@x.com");
    const body = { lat: 12.9, lng: 77.5, timestamp: ago(5000) };
    const rot = (
      await request(app)
        .post(`/api/v1/tracking/devices/${w.device._id}/rotate-key`)
        .set(auth(w.t))
    ).body.data;
    expect((await w.ping(body)).status).toBe(401);
    expect((await w.ping(body, rot.apiKey)).status).toBe(200);
  });

  it("never exposes key material in listings", async () => {
    const w = await setup("g7@x.com");
    const list = (
      await request(app).get("/api/v1/tracking/devices").set(auth(w.t))
    ).body.data;
    expect(JSON.stringify(list)).not.toContain(w.device.apiKey);
    expect(list[0].keyHash).toBeUndefined();
  });
});

describe("tenant isolation & permissions", () => {
  it("keeps devices, positions and history private to each org", async () => {
    const a = await setup("t1@x.com");
    const b = await setup("t2@x.com");
    await a.ping({ lat: 12.9, lng: 77.5, timestamp: ago(5000) });
    expect(
      (await b.board()).data.every((x) => x.vehicle._id !== a.vehicle._id),
    ).toBe(true);
    expect(
      (
        await request(app)
          .get(`/api/v1/tracking/vehicles/${a.vehicle._id}/history`)
          .set(auth(b.t))
      ).status,
    ).toBe(404);
    expect(
      (await request(app).get("/api/v1/tracking/devices").set(auth(b.t))).body
        .data,
    ).toHaveLength(1);
    const steal = await request(app)
      .post("/api/v1/tracking/devices")
      .set(auth(b.t))
      .send({ name: "Steal", vehicle: a.vehicle._id });
    expect(steal.status).toBe(404);
    expect((await request(app).get("/api/v1/tracking/vehicles")).status).toBe(
      401,
    );
  });
});

describe("driver phone tracking", () => {
  it("only accepts locations during the driver's own active trip", async () => {
    const w = await setup("m1@x.com");
    const route = await w.post("/api/v1/routes", {
      name: "Route One",
      code: "R1",
      stops: [
        { name: "A", lat: 1, lng: 1 },
        { name: "B", lat: 2, lng: 2 },
      ],
    });
    const driver = await w.post("/api/v1/drivers", {
      name: "Dev Driver",
      phone: "9876543210",
      licence: { number: "LM1", expiryDate: "2035-01-01" },
    });
    const trip = await w.post("/api/v1/trips", {
      route: route._id,
      scheduledDate: "2030-01-15",
      departureTime: "07:00",
      durationMin: 60,
      vehicle: w.vehicle._id,
      driver: driver._id,
    });
    const user = await User.create({
      organization: w.reg.user.organization,
      name: "Drv",
      email: "drv-m1@x.com",
      password: await bcrypt.hash("password123", 4),
      role: "driver",
    });
    await Driver.updateOne({ _id: driver._id }, { user: user._id });
    const tok = (
      await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "drv-m1@x.com", password: "password123" })
    ).body.data.accessToken;
    const send = (ts = ago(1000)) =>
      request(app)
        .post("/api/v1/tracking/mobile/ping")
        .set(auth(tok))
        .send({ pings: [{ lat: 19.1, lng: 72.9, timestamp: ts }] });
    expect((await send()).status).toBe(403); // trip not started
    const move = (to) =>
      request(app)
        .post(`/api/v1/trips/${trip._id}/transition`)
        .set(auth(w.t))
        .send({ to });
    await move("ready");
    await move("in_progress");
    const ok = await send();
    expect(ok.status).toBe(200);
    expect(
      (await w.board()).data.find((x) => x.vehicle._id === w.vehicle._id).trip
        .tripNumber,
    ).toBe(trip.tripNumber);
    await move("completed");
    expect((await send(ago(500))).status).toBe(403); // sharing stops when the trip ends
  });
});

describe("realtime", () => {
  const connect = (token) =>
    new Promise((resolve) => {
      const s = ioc(base, {
        auth: { token },
        transports: ["websocket"],
        reconnection: false,
      });
      s.on("connect", () => resolve({ s, ok: true }));
      s.on("connect_error", () => resolve({ s, ok: false }));
    });

  it("rejects unauthenticated sockets and delivers positions only to the owning org", async () => {
    const a = await setup("r1@x.com");
    const b = await setup("r2@x.com");
    expect((await connect("garbage")).ok).toBe(false);
    const ca = await connect(a.reg.accessToken);
    const cb = await connect(b.reg.accessToken);
    expect(ca.ok && cb.ok).toBe(true);
    const got = { a: [], b: [] };
    ca.s.on("vehicle:position", (p) => got.a.push(p));
    cb.s.on("vehicle:position", (p) => got.b.push(p));
    await a.ping({ lat: 12.9, lng: 77.5, timestamp: ago(1000) });
    await new Promise((r) => setTimeout(r, 400));
    ca.s.close();
    cb.s.close();
    expect(got.a).toHaveLength(1);
    expect(got.a[0].vehicleId).toBe(a.vehicle._id);
    expect(got.b).toHaveLength(0);
  });
});
