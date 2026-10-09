import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Organization } from "../models/Organization.js";

let mongod;
const app = createApp(["http://localhost"]);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
let n = 0;
const T0 = Date.now();
const hoursAgo = (h) => new Date(T0 - h * 3600_000).toISOString(); // stable per run so repeated calls are identical

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
    registrationNumber: `MH12AB${4000 + ++n}`,
    capacity: 30,
    odometer: 1000,
  });
  const as = async (role, em) => {
    await User.create({
      organization: reg.user.organization,
      name: role + " user",
      email: em,
      password: await bcrypt.hash("password123", 4),
      role,
    });
    return (
      await request(app)
        .post("/api/v1/auth/login")
        .send({ email: em, password: "password123" })
    ).body.data.accessToken;
  };
  return {
    reg,
    t,
    post,
    vehicle,
    as,
    get: (u, tok = t) => request(app).get(u).set(auth(tok)),
  };
}
const mnt = (w, extra = {}) =>
  request(app)
    .post("/api/v1/maintenance")
    .set(auth(w.t))
    .send({
      vehicle: w.vehicle._id,
      type: "repair",
      issue: "Brake pads worn",
      ...extra,
    });
const mmove = (w, id, to, extra = {}) =>
  request(app)
    .post(`/api/v1/maintenance/${id}/transition`)
    .set(auth(w.t))
    .send({ to, ...extra });
const vstatus = async (w) =>
  (await w.get(`/api/v1/vehicles/${w.vehicle._id}`)).body.data.status;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("maintenance", () => {
  it("takes the vehicle out of service while in the workshop and restores it after", async () => {
    const w = await setup("m1@x.com");
    const rec = (await mnt(w)).body.data;
    expect(rec.number).toBe("MNT-00001");
    expect(rec.status).toBe("reported");
    expect(await vstatus(w)).toBe("available");
    expect((await mmove(w, rec._id, "in_progress")).status).toBe(200);
    expect(await vstatus(w)).toBe("maintenance");
    // Cannot be assigned to a new trip while under maintenance.
    const route = await w.post("/api/v1/routes", {
      name: "Route One",
      code: "R1",
      stops: [
        { name: "A", lat: 1, lng: 1 },
        { name: "B", lat: 2, lng: 2 },
      ],
    });
    const tr = await request(app).post("/api/v1/trips").set(auth(w.t)).send({
      route: route._id,
      scheduledDate: "2030-01-15",
      departureTime: "07:00",
      durationMin: 60,
      vehicle: w.vehicle._id,
    });
    expect(tr.status).toBe(409);
    expect((await mmove(w, rec._id, "completed")).status).toBe(400); // final cost required
    const done = await mmove(w, rec._id, "completed", {
      cost: 4500,
      odometer: 1200,
    });
    expect(done.status).toBe(200);
    expect(await vstatus(w)).toBe("available");
    expect(
      (await w.get(`/api/v1/vehicles/${w.vehicle._id}`)).body.data.odometer,
    ).toBe(1200);
    // Terminal: no further changes.
    expect((await mmove(w, rec._id, "in_progress")).status).toBe(409);
    expect(
      (
        await request(app)
          .put(`/api/v1/maintenance/${rec._id}`)
          .set(auth(w.t))
          .send({ issue: "Changed" })
      ).status,
    ).toBe(409);
  });

  it("refuses to start work on a vehicle that is on a trip and warns about upcoming trips", async () => {
    const w = await setup("m2@x.com");
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
      licence: { number: "LF1", expiryDate: "2035-01-01" },
    });
    const future = await w.post("/api/v1/trips", {
      route: route._id,
      scheduledDate: "2030-05-05",
      departureTime: "07:00",
      durationMin: 60,
      vehicle: w.vehicle._id,
      driver: driver._id,
    });
    const rec = (await mnt(w)).body.data;
    const started = await mmove(w, rec._id, "in_progress");
    expect(started.body.affectedTrips.map((t) => t.tripNumber)).toEqual([
      future.tripNumber,
    ]);
    await mmove(w, rec._id, "cancelled");
    expect(await vstatus(w)).toBe("available"); // cancelled work releases the vehicle
    // Now put it on a live trip.
    const live = await w.post("/api/v1/trips", {
      route: route._id,
      scheduledDate: "2030-06-06",
      departureTime: "07:00",
      durationMin: 60,
      vehicle: w.vehicle._id,
      driver: driver._id,
    });
    const mv = (to) =>
      request(app)
        .post(`/api/v1/trips/${live._id}/transition`)
        .set(auth(w.t))
        .send({ to });
    await mv("ready");
    await mv("in_progress");
    const rec2 = (await mnt(w, { issue: "Strange noise" })).body.data;
    expect((await mmove(w, rec2._id, "in_progress")).status).toBe(409);
  });

  it("keeps the vehicle offline until all open work is done; rejects a lower odometer", async () => {
    const w = await setup("m3@x.com");
    const a = (await mnt(w)).body.data;
    const b = (await mnt(w, { issue: "AC failure" })).body.data;
    await mmove(w, a._id, "in_progress");
    await mmove(w, b._id, "in_progress");
    await mmove(w, a._id, "completed", { cost: 100 });
    expect(await vstatus(w)).toBe("maintenance");
    expect(
      (await mmove(w, b._id, "completed", { cost: 100, odometer: 10 })).status,
    ).toBe(400);
    await mmove(w, b._id, "completed", { cost: 200 });
    expect(await vstatus(w)).toBe("available");
  });

  it("lists service reminders from the last completed service and isolates tenants", async () => {
    const w = await setup("m4@x.com");
    const rec = (
      await mnt(w, { type: "preventive", nextServiceOdometer: 1100 })
    ).body.data;
    await mmove(w, rec._id, "in_progress");
    await mmove(w, rec._id, "completed", { cost: 300, odometer: 1050 });
    const due = (await w.get("/api/v1/maintenance/due")).body.data;
    expect(due.services).toHaveLength(1); // within 500 km of next service odometer
    const other = await setup("m4b@x.com");
    expect((await other.get(`/api/v1/maintenance/${rec._id}`)).status).toBe(
      404,
    );
    expect(
      (
        await request(app).post("/api/v1/maintenance").set(auth(other.t)).send({
          vehicle: w.vehicle._id,
          type: "repair",
          issue: "Steal vehicle",
        })
      ).status,
    ).toBe(404);
  });
});

describe("fuel", () => {
  const fuel = (w, b, tok = w.t) =>
    request(app)
      .post("/api/v1/fuel")
      .set(auth(tok))
      .send({
        vehicle: w.vehicle._id,
        quantity: 40,
        pricePerUnit: 90,
        filledAt: hoursAgo(10),
        odometer: 1100,
        ...b,
      });
  it("computes and validates totals on the server", async () => {
    const w = await setup("f1@x.com");
    const ok = await fuel(w, {});
    expect(ok.status).toBe(201);
    expect(ok.body.data.totalAmount).toBe(3600);
    expect(ok.body.data.fuelType).toBe("diesel");
    expect(
      (
        await fuel(w, {
          filledAt: hoursAgo(5),
          odometer: 1200,
          totalAmount: 4000,
        })
      ).status,
    ).toBe(400); // mismatch
    expect(
      (await fuel(w, { filledAt: hoursAgo(5), odometer: 1200, quantity: -4 }))
        .status,
    ).toBe(400);
    expect(
      (await w.get(`/api/v1/vehicles/${w.vehicle._id}`)).body.data.odometer,
    ).toBe(1100);
  });
  it("blocks duplicates, replays by clientRef and enforces odometer order", async () => {
    const w = await setup("f2@x.com");
    expect((await fuel(w, {})).status).toBe(201);
    expect((await fuel(w, {})).status).toBe(409); // same vehicle/time/qty
    const a = await fuel(w, {
      filledAt: hoursAgo(5),
      odometer: 1300,
      clientRef: "client-ref-0001",
    });
    const b = await fuel(w, {
      filledAt: hoursAgo(5),
      odometer: 1300,
      clientRef: "client-ref-0001",
    });
    expect(a.status).toBe(201);
    expect(b.body.duplicate).toBe(true);
    expect(
      (await fuel(w, { filledAt: hoursAgo(2), odometer: 1250, quantity: 41 }))
        .status,
    ).toBe(400); // lower than earlier fill
    expect(
      (await fuel(w, { filledAt: hoursAgo(7), odometer: 1400, quantity: 42 }))
        .status,
    ).toBe(400); // higher than a later fill
    expect(
      (
        await fuel(w, {
          filledAt: new Date(Date.now() + 86400000).toISOString(),
          odometer: 9000,
        })
      ).status,
    ).toBe(400);
  });
  it("reports only measured efficiency from consecutive full-tank fills", async () => {
    const w = await setup("f3@x.com");
    await fuel(w, {
      filledAt: hoursAgo(30),
      odometer: 1000,
      quantity: 50,
      fullTank: true,
    });
    await fuel(w, {
      filledAt: hoursAgo(20),
      odometer: 1200,
      quantity: 10,
      fullTank: false,
    });
    await fuel(w, {
      filledAt: hoursAgo(10),
      odometer: 1500,
      quantity: 40,
      fullTank: true,
    });
    const eff = (
      await w.get(`/api/v1/fuel/efficiency?vehicle=${w.vehicle._id}`)
    ).body.data;
    expect(eff.intervals).toHaveLength(1);
    expect(eff.intervals[0]).toMatchObject({
      km: 500,
      litres: 50,
      kmPerUnit: 10,
    }); // partial fill litres included
    const none = await setup("f3b@x.com");
    await fuel(none, {
      filledAt: hoursAgo(10),
      odometer: 1100,
      fullTank: false,
    });
    expect(
      (await none.get(`/api/v1/fuel/efficiency?vehicle=${none.vehicle._id}`))
        .body.data.averageKmPerUnit,
    ).toBeNull();
  });
  it("respects the module switch and tenant isolation", async () => {
    const w = await setup("f4@x.com");
    const other = await setup("f4b@x.com");
    await fuel(w, {});
    expect((await other.get("/api/v1/fuel")).body.data).toHaveLength(0);
    expect((await fuel(other, { vehicle: w.vehicle._id })).status).toBe(404);
    await Organization.updateOne(
      { _id: w.reg.user.organization },
      { "modules.fuelExpenses": false },
    );
    expect((await w.get("/api/v1/fuel")).status).toBe(403);
    expect((await w.get("/api/v1/expenses")).status).toBe(403);
    expect((await w.get("/api/v1/dashboard")).body.data.costs).toBeNull();
    expect((await w.get("/api/v1/vehicles")).status).toBe(200); // rest of the system unaffected
  });
});

describe("expenses", () => {
  const exp = (w, b = {}, tok = w.t) =>
    request(app)
      .post("/api/v1/expenses")
      .set(auth(tok))
      .send({
        category: "toll",
        amount: 250,
        date: hoursAgo(3),
        vehicle: w.vehicle._id,
        ...b,
      });
  it("requires approval by someone other than the submitter", async () => {
    const w = await setup("x1@x.com");
    const acct = await w.as("accountant", "acct1@x.com");
    const e = (await exp(w)).body.data;
    expect(e.status).toBe("pending");
    expect(
      (
        await request(app)
          .post(`/api/v1/expenses/${e._id}/review`)
          .set(auth(w.t))
          .send({ decision: "approved" })
      ).status,
    ).toBe(403); // own expense
    expect(
      (
        await request(app)
          .post(`/api/v1/expenses/${e._id}/review`)
          .set(auth(acct))
          .send({ decision: "rejected" })
      ).status,
    ).toBe(400); // reason needed
    expect(
      (
        await request(app)
          .post(`/api/v1/expenses/${e._id}/review`)
          .set(auth(acct))
          .send({ decision: "approved" })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/v1/expenses/${e._id}/review`)
          .set(auth(acct))
          .send({ decision: "rejected", note: "x" })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .put(`/api/v1/expenses/${e._id}`)
          .set(auth(w.t))
          .send({ category: "toll", amount: 1, date: hoursAgo(1) })
      ).status,
    ).toBe(409); // approved is locked
    const viewer = await w.as("viewer", "view1@x.com");
    expect((await exp(w, {}, viewer)).status).toBe(403);
  });
  it("blocks double submits and bad data", async () => {
    const w = await setup("x2@x.com");
    expect((await exp(w, { amount: 100 })).status).toBe(201);
    expect((await exp(w, { amount: 100 })).status).toBe(409);
    expect((await exp(w, { amount: 0 })).status).toBe(400);
    expect((await exp(w, { category: "bribe" })).status).toBe(400);
    const a = await exp(w, { amount: 55, clientRef: "client-ref-exp1" });
    const b = await exp(w, { amount: 55, clientRef: "client-ref-exp1" });
    expect(a.status).toBe(201);
    expect(b.body.duplicate).toBe(true);
  });
  it("counts only approved expenses and completed maintenance in cost summaries", async () => {
    const w = await setup("x3@x.com");
    const acct = await w.as("accountant", "acct3@x.com");
    const e1 = (await exp(w, { amount: 300 })).body.data;
    await exp(w, { amount: 700, vendor: "Other toll" });
    await request(app)
      .post(`/api/v1/expenses/${e1._id}/review`)
      .set(auth(acct))
      .send({ decision: "approved" });
    await request(app)
      .post("/api/v1/fuel")
      .set(auth(w.t))
      .send({
        vehicle: w.vehicle._id,
        quantity: 10,
        pricePerUnit: 100,
        filledAt: hoursAgo(2),
        odometer: 1100,
      });
    const m = (await mnt(w)).body.data;
    await mmove(w, m._id, "in_progress");
    await mmove(w, m._id, "completed", { cost: 500 });
    const q = `from=${encodeURIComponent(hoursAgo(48))}&to=${encodeURIComponent(new Date(Date.now() + 3600_000).toISOString())}`;
    const s = (await w.get(`/api/v1/expenses/costs/summary?${q}`)).body.data;
    expect(s.totals).toEqual({ fuel: 1000, maintenance: 500, expenses: 300 });
    expect(s.rows[0].total).toBe(1800);
    const dash = (await w.get("/api/v1/dashboard")).body.data;
    expect(dash.costs).toMatchObject({
      fuel: 1000,
      maintenance: 500,
      expenses: 300,
      pendingExpenses: 1,
    });
    expect(dash.maintenance.open).toBe(0);
    const disp = await w.as("dispatcher", "disp3@x.com");
    expect((await w.get("/api/v1/dashboard", disp)).body.data.costs).toBeNull(); // dispatcher can't see costs
  });
});
