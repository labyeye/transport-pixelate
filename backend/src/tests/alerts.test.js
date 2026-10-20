import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { distanceM, evaluateRules } from "../modules/alerts/alerts.service.js";
import { ingest } from "../modules/tracking/tracking.service.js";
import { Alert } from "../models/Alert.js";
import { Subscription } from "../models/Subscription.js";
import { Vehicle } from "../models/Vehicle.js";
import { Organization } from "../models/Organization.js";

let mongod;
const app = createApp(["http://localhost"]);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
let n = 0;
async function signup() {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      organizationName: `Alerts ${++n}`,
      name: "Owner",
      email: `alerts${n}@x.com`,
      password: "password123",
    });
  const org = (await Organization.findOne({ name: `Alerts ${n}` }))._id;
  const vehicle = await Vehicle.create({
    organization: org,
    registrationNumber: `MH12AB${3000 + n}`,
  });
  return { token: res.body.data.accessToken, org, vehicle };
}
let minute = 0;
const fix = (lat, lng, speedKmh = 20) => ({
  lat,
  lng,
  speedKmh,
  recordedAt: new Date(Date.now() - 60_000 * (30 - ++minute)),
});
const send = (w, p) =>
  ingest({ org: w.org, vehicleId: w.vehicle._id, source: "mobile", pings: [p] });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("rules", () => {
  const gate = { _id: "g1", name: "Gate", center: { lat: 19.0, lng: 72.8 }, radiusM: 200, alertOn: "both" };
  it("measures distance", () => {
    expect(Math.round(distanceM({ lat: 19, lng: 72.8 }, { lat: 19.001, lng: 72.8 }))).toBe(111);
  });
  it("raises enter/exit on transitions only, and nothing on a first fix", () => {
    const at = { lat: 19.0, lng: 72.8, speedKmh: 10 };
    const far = { lat: 19.1, lng: 72.8, speedKmh: 10 };
    const first = evaluateRules({ fix: at, prev: null, geofences: [gate] });
    expect(first.events).toEqual([]);
    expect(first.state.inside).toEqual(["g1"]);
    expect(evaluateRules({ fix: at, prev: first.state, geofences: [gate] }).events).toEqual([]);
    expect(evaluateRules({ fix: far, prev: first.state, geofences: [gate] }).events.map((e) => e.type)).toEqual(["geofence_exit"]);
    expect(evaluateRules({ fix: at, prev: { inside: [] }, geofences: [gate] }).events.map((e) => e.type)).toEqual(["geofence_enter"]);
  });
  it("honours enter-only / exit-only zones", () => {
    const enterOnly = { ...gate, alertOn: "enter" };
    const far = { lat: 19.1, lng: 72.8 };
    expect(evaluateRules({ fix: far, prev: { inside: ["g1"] }, geofences: [enterOnly] }).events).toEqual([]);
  });
  it("raises overspeed once per excursion", () => {
    const f = { lat: 19, lng: 72.8, speedKmh: 70 };
    const a = evaluateRules({ fix: f, prev: { inside: [], overspeed: false }, geofences: [], limitKmh: 60 });
    expect(a.events.map((e) => e.type)).toEqual(["overspeed"]);
    expect(evaluateRules({ fix: f, prev: a.state, geofences: [], limitKmh: 60 }).events).toEqual([]);
    expect(evaluateRules({ fix: { ...f, speedKmh: 40 }, prev: a.state, geofences: [], limitKmh: 60 }).state.overspeed).toBe(false);
    expect(evaluateRules({ fix: f, prev: null, geofences: [], limitKmh: null }).events).toEqual([]); // off
  });
});

describe("through ingest and the API", () => {
  it("creates alerts, lists and acknowledges them", async () => {
    const w = await signup();
    const g = await request(app).post("/api/v1/alerts/geofences").set(auth(w.token))
      .send({ name: "School gate", center: { lat: 19.0, lng: 72.8 }, radiusM: 150 });
    expect(g.status).toBe(201);
    expect((await request(app).put("/api/v1/alerts/settings").set(auth(w.token)).send({ speedLimitKmh: 60 })).status).toBe(200);

    await send(w, fix(19.1, 72.8, 30)); // baseline, far away
    await send(w, fix(19.0, 72.8, 30)); // enters the gate
    await send(w, fix(19.0, 72.8, 80)); // overspeed
    await send(w, fix(19.0, 72.8, 85)); // still overspeed: no second alert
    await send(w, fix(19.1, 72.8, 30)); // leaves

    const types = (await Alert.find({ organization: w.org }).sort({ at: 1 })).map((a) => a.type);
    expect(types).toEqual(["geofence_enter", "overspeed", "geofence_exit"]);

    const list = await request(app).get("/api/v1/alerts?open=true").set(auth(w.token));
    expect(list.body.meta.total).toBe(3);
    const id = list.body.data[0]._id;
    expect((await request(app).post(`/api/v1/alerts/${id}/acknowledge`).set(auth(w.token))).status).toBe(200);
    expect((await request(app).post(`/api/v1/alerts/${id}/acknowledge`).set(auth(w.token))).status).toBe(404);
    expect((await request(app).get("/api/v1/alerts?open=true").set(auth(w.token))).body.meta.total).toBe(2);
  });

  it("is a Pro feature and stays tenant-scoped", async () => {
    const a = await signup();
    const b = await signup();
    await Subscription.updateOne({ organization: a.org }, { tier: "basic" });
    const denied = await request(app).post("/api/v1/alerts/geofences").set(auth(a.token))
      .send({ name: "Zone", center: { lat: 19, lng: 72.8 }, radiusM: 100 });
    expect(denied.status).toBe(403);
    await request(app).post("/api/v1/alerts/geofences").set(auth(b.token))
      .send({ name: "B zone", center: { lat: 19, lng: 72.8 }, radiusM: 100 });
    expect((await request(app).get("/api/v1/alerts/geofences").set(auth(a.token))).body.data).toEqual([]);
    // Basic orgs get no alerts from ingest either.
    await Organization.updateOne({ _id: a.org }, { speedLimitKmh: 50 });
    await send(a, fix(19.1, 72.8, 90));
    expect(await Alert.countDocuments({ organization: a.org })).toBe(0);
  });

  it("validates geofence input", async () => {
    const w = await signup();
    const r = await request(app).post("/api/v1/alerts/geofences").set(auth(w.token))
      .send({ name: "", center: { lat: 200, lng: 0 }, radiusM: 5 });
    expect(r.status).toBe(400);
  });
});
