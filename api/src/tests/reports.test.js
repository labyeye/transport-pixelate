import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Trip } from "../models/Trip.js";
import { Vehicle } from "../models/Vehicle.js";
import { Organization } from "../models/Organization.js";
import { AuditLog } from "../models/AuditLog.js";
import { cell, toCsv } from "../modules/reports/csv.js";

let mongod;
const app = createApp(["http://localhost"]);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
let n = 0;
const Q = "from=2030-03-01&to=2030-03-31";

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
  const as = async (role, em) => {
    await User.create({
      organization: org,
      name: role + " u",
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
  const route = await post("/api/v1/routes", {
    name: "Route One",
    code: "R1",
    stops: [
      { name: "A", lat: 1, lng: 1 },
      { name: "B", lat: 2, lng: 2 },
    ],
  });
  const vehicle = await post("/api/v1/vehicles", {
    registrationNumber: `MH12AB${8000 + ++n}`,
    capacity: 30,
    odometer: 100,
  });
  const driver = await post("/api/v1/drivers", {
    name: "Dev Driver " + ++n,
    phone: "9876543210",
    licence: { number: "LP" + n, expiryDate: "2035-01-01" },
  });
  let slot = 0;
  // Create a trip through the API (so numbering/snapshots are real), then set its outcome directly.
  const trip = async ({
    date = "2030-03-04",
    status = "completed",
    late = 0,
    km = 20,
    minutes = 60,
    vehicleId = vehicle._id,
    driverId = driver._id,
    route: rid = route._id,
    extra = {},
  } = {}) => {
    const h = String(5 + (slot++ % 15)).padStart(2, "0");
    const t0 = await post("/api/v1/trips", {
      route: rid,
      scheduledDate: date,
      departureTime: `${h}:00`,
      durationMin: 30,
      vehicle: vehicleId,
      driver: driverId,
    });
    const doc = await Trip.findById(t0._id);
    const set = { status, ...extra };
    if (["completed", "in_progress", "delayed"].includes(status)) {
      set.actualStart = new Date(+doc.scheduledDeparture + late * 60000);
      if (status === "completed") {
        set.actualEnd = new Date(+set.actualStart + minutes * 60000);
        if (km != null) set.actualDistanceKm = km;
      }
    }
    await Trip.updateOne({ _id: t0._id }, set);
    return t0;
  };
  const get = (u, tok = t) => request(app).get(u).set(auth(tok));
  return {
    reg,
    org,
    t,
    post,
    as,
    route,
    vehicle,
    driver,
    trip,
    get,
    rep: (key, qs = Q, tok = t) => get(`/api/v1/reports/${key}?${qs}`, tok),
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

describe("csv", () => {
  it("quotes properly and neutralises spreadsheet formulas", () => {
    expect(cell('He said "hi", ok')).toBe('"He said ""hi"", ok"');
    expect(cell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(cell("+91 98765")).toBe("'+91 98765");
    expect(cell("@cmd")).toBe("'@cmd");
    expect(cell("-5 apples")).toBe("'-5 apples");
    expect(cell(-12.5, "number")).toBe("-12.5"); // real negative numbers stay numeric
    expect(cell(null)).toBe("");
    expect(cell(new Date("2030-01-01T00:00:00Z"), "date")).toBe(
      "2030-01-01T00:00:00.000Z",
    );
    const csv = toCsv(
      [
        { key: "a", label: "A" },
        { key: "b", label: "B", type: "number" },
      ],
      [{ a: "x,y", b: 3 }],
      { notes: ["n1"] },
    );
    expect(csv.startsWith("﻿A,B\r\n")).toBe(true);
    expect(csv).toContain('"x,y",3');
    expect(csv).toContain("Note: n1");
  });
});

describe("trip reports", () => {
  it("counts by day and month with totals and an honest distance note", async () => {
    const w = await world("rp1@x.com");
    await w.trip({ date: "2030-03-04", km: 20 });
    await w.trip({ date: "2030-03-04", km: null }); // completed without distance
    await w.trip({
      date: "2030-03-05",
      status: "cancelled",
      extra: { cancellationReason: "Strike" },
    });
    await w.trip({ date: "2030-03-05", status: "scheduled" });
    await w.trip({ date: "2030-04-02" });
    const daily = (await w.rep("trips_daily")).body.data;
    const d4 = daily.rows.find((r) => r.group === "2030-03-04");
    expect(d4).toMatchObject({ total: 2, completed: 2, km: 20 });
    expect(daily.rows.find((r) => r.group === "2030-03-05")).toMatchObject({
      total: 2,
      cancelled: 1,
      upcoming: 1,
    });
    expect(daily.rows.find((r) => r.group === "2030-04-02")).toBeUndefined(); // outside range
    expect(daily.totals).toMatchObject({
      total: 4,
      completed: 2,
      cancelled: 1,
      upcoming: 1,
    });
    expect(daily.notes.join(" ")).toMatch(/covers 1 of 2 completed trips/);
    const monthly = (
      await w.rep("trips_monthly", "from=2030-03-01&to=2030-04-30")
    ).body.data;
    expect(monthly.rows.map((r) => [r.group, r.total])).toEqual([
      ["2030-03", 4],
      ["2030-04", 1],
    ]);
    const byRoute = (await w.rep("trips_by_route")).body.data;
    expect(byRoute.rows[0]).toMatchObject({ group: "R1", total: 4 });
    expect((await w.rep("trips_by_vehicle")).body.data.rows[0].group).toBe(
      w.vehicle.registrationNumber,
    );
    expect((await w.rep("trips_by_driver")).body.data.rows[0].group).toBe(
      w.driver.name,
    );
  });

  it("shows on-time % only with enough data, counting delays and late starts", async () => {
    const w = await world("rp2@x.com");
    for (let i = 0; i < 4; i++)
      await w.trip({ date: `2030-03-0${i + 1}`, late: 0 });
    expect((await w.rep("route_performance")).body.data.rows[0]).toMatchObject({
      completed: 4,
      onTimePct: null,
      avgLateStartMin: null,
    }); // below the sample minimum
    await w.trip({ date: "2030-03-05", late: 0 });
    await w.trip({ date: "2030-03-06", late: 25 }); // late start
    const delayed = await w.trip({ date: "2030-03-07", late: 0 });
    await Trip.updateOne(
      { _id: delayed._id },
      {
        $push: {
          history: { action: "status", from: "in_progress", to: "delayed" },
        },
      },
    ); // was delayed en route
    const row = (await w.rep("route_performance")).body.data.rows[0];
    expect(row).toMatchObject({
      trips: 7,
      completed: 7,
      delayed: 1,
      tripsWithStartTime: 7,
    });
    expect(row.onTimePct).toBeCloseTo(71.4, 1); // 5 of 7
    expect(row.avgLateStartMin).toBeCloseTo(3.6, 1); // 25 / 7
  });

  it("lists delayed and cancelled trips with reasons", async () => {
    const w = await world("rp3@x.com");
    await w.trip({
      date: "2030-03-04",
      status: "delayed",
      late: 15,
      extra: { delayReason: "Flat tyre" },
    });
    await w.trip({
      date: "2030-03-05",
      status: "aborted",
      extra: { cancellationReason: "Engine failure" },
    });
    await w.trip({
      date: "2030-03-06",
      status: "cancelled",
      extra: { cancellationReason: "Holiday" },
    });
    const d = (await w.rep("delayed_trips")).body.data;
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({
      reason: "Flat tyre",
      lateStartMin: 15,
      route: "R1",
    });
    const c = (await w.rep("cancelled_trips")).body.data;
    expect(c.rows.map((r) => r.reason).sort()).toEqual([
      "Engine failure",
      "Holiday",
    ]);
  });
});

describe("fleet reports", () => {
  it("computes utilization from recorded times and refuses unfair percentages", async () => {
    const w = await world("rp4@x.com");
    const idle = await w.post("/api/v1/vehicles", {
      registrationNumber: `MH12AB${8000 + ++n}`,
      capacity: 20,
    });
    await w.trip({ date: "2030-03-04", minutes: 90, km: 30 });
    await w.trip({ date: "2030-03-04", minutes: 30, km: 10 });
    await w.trip({ date: "2030-03-06", minutes: 60, km: 20 });
    const rows = (await w.rep("vehicle_utilization")).body.data.rows;
    const used = rows.find((r) => r.vehicle === w.vehicle.registrationNumber);
    expect(used).toMatchObject({
      completedTrips: 3,
      hours: 3,
      km: 60,
      daysUsed: 2,
      daysInPeriod: 31,
    });
    expect(used.daysUsedPct).toBeCloseTo(6.5, 1);
    expect(
      rows.find((r) => r.vehicle === idle.registrationNumber),
    ).toMatchObject({ completedTrips: 0, hours: 0, daysUsed: 0 }); // idle vehicles are listed too
    // A period before the vehicle existed gives no percentage.
    await Vehicle.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(w.vehicle._id) },
      { $set: { createdAt: new Date("2031-01-01") } },
    ); // createdAt is immutable through Mongoose
    const late = (await w.rep("vehicle_utilization")).body.data.rows.find(
      (r) => r.vehicle === w.vehicle.registrationNumber,
    );
    expect(late.daysUsedPct).toBeNull();
    expect(late.daysInPeriod).toBeNull();
  });

  it("reports driver duty and notes missing data", async () => {
    const w = await world("rp5@x.com");
    await w.trip({ date: "2030-03-04", minutes: 120, km: 40 });
    await w.trip({ date: "2030-03-05", minutes: 60, km: null });
    await w.trip({ date: "2030-03-06", status: "cancelled" });
    const row = (await w.rep("driver_duty")).body.data.rows[0];
    expect(row).toMatchObject({
      assigned: 3,
      completed: 2,
      cancelled: 1,
      daysWorked: 2,
      hours: 3,
      km: 40,
    });
  });

  it("lists expired and expiring documents as of today", async () => {
    const w = await world("rp6@x.com");
    const day = (d) => new Date(Date.now() + d * 86400000);
    await Vehicle.updateOne(
      { _id: w.vehicle._id },
      {
        "documents.insurance": { number: "POL1", expiryDate: day(-3) },
        "documents.fitness": { expiryDate: day(10) },
        "documents.permit": { expiryDate: day(400) },
      },
    );
    const rows = (await w.get("/api/v1/reports/document_expiry")).body.data
      .rows;
    expect(rows.map((r) => [r.document, r.status])).toEqual([
      ["insurance", "expired"],
      ["fitness", "expiring_soon"],
    ]);
    expect(rows[0].daysLeft).toBeLessThan(0);
  });
});

describe("cost reports", () => {
  it("measures fuel efficiency only from full-tank fills in range", async () => {
    const w = await world("rp7@x.com");
    const Q = "from=2020-03-01&to=2020-03-31";
    const fill = (b) =>
      w.post("/api/v1/fuel", {
        vehicle: w.vehicle._id,
        pricePerUnit: 100,
        ...b,
      });
    await fill({
      quantity: 50,
      filledAt: "2020-03-02T08:00:00Z",
      odometer: 1000,
      fullTank: true,
    });
    await fill({
      quantity: 10,
      filledAt: "2020-03-05T08:00:00Z",
      odometer: 1200,
    });
    await fill({
      quantity: 40,
      filledAt: "2020-03-10T08:00:00Z",
      odometer: 1500,
      fullTank: true,
    });
    const f = (await w.rep("fuel", Q)).body.data;
    expect(f.rows[0]).toMatchObject({
      fills: 3,
      quantity: 100,
      amount: 10000,
      measuredKm: 500,
      kmPerUnit: 10,
    });
    expect(f.totals).toMatchObject({ fills: 3, amount: 10000 });
    const none = (await w.rep("fuel", "from=2020-03-04&to=2020-03-06")).body
      .data;
    expect(none.rows[0]).toMatchObject({ fills: 1, kmPerUnit: null }); // one partial fill: nothing to measure
  });

  it("totals fuel, completed maintenance and approved expenses; cost/km only when distance is complete", async () => {
    const w = await world("rp8@x.com");
    const Q = "from=2020-03-01&to=2020-03-31";
    const acct = await w.as("accountant", "rp8-acct@x.com");
    await w.post("/api/v1/fuel", {
      vehicle: w.vehicle._id,
      pricePerUnit: 100,
      quantity: 10,
      filledAt: "2020-03-03T08:00:00Z",
      odometer: 500,
    });
    const m = await w.post("/api/v1/maintenance", {
      vehicle: w.vehicle._id,
      type: "repair",
      issue: "Brake pads",
    });
    await request(app)
      .post(`/api/v1/maintenance/${m._id}/transition`)
      .set(auth(w.t))
      .send({ to: "in_progress" });
    await request(app)
      .post(`/api/v1/maintenance/${m._id}/transition`)
      .set(auth(w.t))
      .send({ to: "completed", cost: 500, serviceDate: "2020-03-04" });
    const e1 = await w.post("/api/v1/expenses", {
      category: "toll",
      amount: 300,
      date: "2020-03-04T10:00:00Z",
      vehicle: w.vehicle._id,
    });
    await w.post("/api/v1/expenses", {
      category: "toll",
      amount: 700,
      date: "2020-03-05T10:00:00Z",
      vehicle: w.vehicle._id,
    }); // pending: excluded
    await request(app)
      .post(`/api/v1/expenses/${e1._id}/review`)
      .set(auth(acct))
      .send({ decision: "approved" });
    await w.trip({ date: "2020-03-04", km: 50 });
    await w.trip({ date: "2020-03-05", km: 50 });
    let row = (await w.rep("vehicle_expenses", Q)).body.data.rows[0];
    expect(row).toMatchObject({
      fuel: 1000,
      maintenance: 500,
      expenses: 300,
      total: 1800,
      completedTrips: 2,
      costPerTrip: 900,
      costPerKm: 18,
    });
    await w.trip({ date: "2020-03-06", km: null }); // a trip with no distance makes cost/km unreliable
    row = (await w.rep("vehicle_expenses", Q)).body.data.rows[0];
    expect(row.costPerKm).toBeNull();
    expect(row.costPerTrip).toBe(600);
    const mnt = (await w.rep("maintenance", Q)).body.data;
    expect(mnt.rows).toHaveLength(1);
    expect(mnt.totals.cost).toBe(500);
  });
});

describe("access control & validation", () => {
  it("shows each role only the reports it may read, and honours the fuel module switch", async () => {
    const w = await world("ac1@x.com");
    const keys = async (tok) =>
      (await w.get("/api/v1/reports", tok)).body.data.map((r) => r.key);
    const owner = await keys(w.t);
    expect(owner).toEqual(
      expect.arrayContaining([
        "trips_daily",
        "fuel",
        "vehicle_expenses",
        "maintenance",
        "document_expiry",
      ]),
    );
    const disp = await w.as("dispatcher", "ac1-disp@x.com");
    const dk = await keys(disp);
    expect(dk).toContain("trips_daily");
    expect(dk).toContain("maintenance");
    expect(dk).not.toContain("fuel");
    expect((await w.rep("fuel", Q, disp)).status).toBe(403);
    const acct = await w.as("accountant", "ac1-acct@x.com");
    const ak = await keys(acct);
    expect(ak).toContain("fuel");
    expect(ak).not.toContain("trips_daily"); // accountants have no trip access
    expect((await w.rep("trips_daily", Q, acct)).status).toBe(403);
    const drv = await w.as("driver", "ac1-drv@x.com");
    expect(await keys(drv)).toEqual([]);
    expect((await w.rep("trips_daily", Q, drv)).status).toBe(403);
    expect((await w.get("/api/v1/reports")).status).toBe(200);
    expect((await request(app).get("/api/v1/reports")).status).toBe(401);
    await Organization.updateOne(
      { _id: w.org },
      { "modules.fuelExpenses": false },
    );
    expect(await keys(w.t)).not.toContain("fuel");
    expect((await w.rep("vehicle_expenses")).status).toBe(403);
    expect((await w.rep("trips_daily")).status).toBe(200);
    expect((await w.rep("nope")).status).toBe(404);
  });

  it("validates ranges and isolates tenants", async () => {
    const a = await world("ac2@x.com");
    const b = await world("ac2b@x.com");
    await a.trip({ date: "2030-03-04" });
    expect((await b.rep("trips_daily")).body.data.rows).toHaveLength(0);
    expect((await b.rep("trips_by_route")).body.data.rows).toHaveLength(0);
    expect(
      (await a.rep("trips_daily", "from=2030-03-10&to=2030-03-01")).status,
    ).toBe(400);
    expect(
      (await a.rep("trips_daily", "from=2029-01-01&to=2030-12-31")).status,
    ).toBe(400); // > 366 days
    expect(
      (await a.rep("trips_daily", "from=03/01/2030&to=2030-03-31")).status,
    ).toBe(400);
    expect(
      (await a.rep("trips_daily", "from=2030-02-30&to=2030-03-31")).status,
    ).toBe(400);
    const def = await a.get("/api/v1/reports/trips_daily"); // default last 30 days
    expect(def.status).toBe(200);
    expect(def.body.data.range.timezone).toBe("Asia/Kolkata");
  });

  it("paginates large reports", async () => {
    const w = await world("ac3@x.com");
    for (let i = 1; i <= 6; i++) await w.trip({ date: `2030-03-0${i}` });
    const p1 = await w.rep("trips_daily", `${Q}&limit=4&page=1`);
    const p2 = await w.rep("trips_daily", `${Q}&limit=4&page=2`);
    expect(p1.body.data.rows).toHaveLength(4);
    expect(p2.body.data.rows).toHaveLength(2);
    expect(p1.body.meta).toMatchObject({ total: 6, pages: 2 });
    expect(p1.body.data.totals.total).toBe(6); // totals cover everything, not just the page
  });
});

describe("csv export", () => {
  it("downloads a safe, complete file and audits the export", async () => {
    const w = await world("ex1@x.com");
    await w.post("/api/v1/drivers", {
      name: '=HYPERLINK("http://evil")',
      phone: "9876543211",
      licence: { number: "LX1", expiryDate: "2035-01-01" },
    });
    const evil = (await w.get("/api/v1/drivers")).body.data.find((d) =>
      d.name.startsWith("="),
    );
    await w.trip({ date: "2030-03-04", driverId: evil._id });
    await w.trip({ date: "2030-03-05" });
    const res = await w.get(`/api/v1/reports/driver_duty/export.csv?${Q}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain(
      "driver_duty_2030-03-01_2030-03-31.csv",
    );
    expect(res.headers["cache-control"]).toContain("no-store");
    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("Driver,Trips assigned");
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`); // formula neutralised
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(text).toContain("Note:");
    const trips = await w.get(`/api/v1/reports/trips_daily/export.csv?${Q}`);
    expect(trips.text).toContain("Total,2,2"); // totals row included
    expect(
      await AuditLog.countDocuments({
        organization: w.org,
        action: "report.export",
      }),
    ).toBe(2);
    const drv = await w.as("driver", "ex1-drv@x.com");
    expect(
      (await w.get(`/api/v1/reports/driver_duty/export.csv?${Q}`, drv)).status,
    ).toBe(403);
    expect(
      (await request(app).get("/api/v1/reports/driver_duty/export.csv")).status,
    ).toBe(401);
  });
});
