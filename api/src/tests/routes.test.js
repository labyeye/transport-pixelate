import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";

let mongod;
const app = createApp(["http://localhost"]);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
async function signup(email) {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      organizationName: "Org " + email,
      name: "Owner",
      email,
      password: "password123",
    });
  return res.body.data.accessToken;
}
const stop = (name, lat, lng, extra = {}) => ({ name, lat, lng, ...extra });
const route = (code, stops) => ({ name: "Morning " + code, code, stops });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("routes & stops", () => {
  it("creates a route, sequences stops from order, validates coordinates and times", async () => {
    const t = await signup("r1@x.com");
    const ok = await request(app)
      .post("/api/v1/routes")
      .set(auth(t))
      .send(route("r-1", [stop("A", 19.07, 72.87), stop("B", 19.1, 72.9)]));
    expect(ok.status).toBe(201);
    expect(ok.body.data.code).toBe("R-1");
    expect(ok.body.data.stops.map((s) => s.sequence)).toEqual([1, 2]);
    expect(ok.body.data.active).toBe(false);
    expect(
      (
        await request(app)
          .post("/api/v1/routes")
          .set(auth(t))
          .send(route("R-2", [stop("Bad", 123, 72)]))
      ).status,
    ).toBe(400);
    const badTime = await request(app)
      .post("/api/v1/routes")
      .set(auth(t))
      .send(
        route("R-3", [
          stop("A", 1, 1, { plannedArrival: "08:00" }),
          stop("B", 2, 2, { plannedArrival: "07:00" }),
        ]),
      );
    expect(badTime.status).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/v1/routes")
          .set(auth(t))
          .send(route("R-1", []))
      ).status,
    ).toBe(409);
  });

  it("requires 2 active stops to activate, bumps version on edit, supports reorder", async () => {
    const t = await signup("r2@x.com");
    const created = (
      await request(app)
        .post("/api/v1/routes")
        .set(auth(t))
        .send(route("X1", [stop("A", 1, 1)]))
    ).body.data;
    expect(
      (
        await request(app)
          .patch(`/api/v1/routes/${created._id}/active`)
          .set(auth(t))
          .send({ active: true })
      ).status,
    ).toBe(409);
    const upd = await request(app)
      .put(`/api/v1/routes/${created._id}`)
      .set(auth(t))
      .send(route("X1", [stop("B", 2, 2), stop("A", 1, 1)]));
    expect(upd.body.data.version).toBe(2);
    expect(upd.body.data.stops.map((s) => s.name)).toEqual(["B", "A"]);
    expect(
      (
        await request(app)
          .patch(`/api/v1/routes/${created._id}/active`)
          .set(auth(t))
          .send({ active: true })
      ).status,
    ).toBe(200);
    expect(
      (await request(app).delete(`/api/v1/routes/${created._id}`).set(auth(t)))
        .status,
    ).toBe(409); // must deactivate first
  });

  it("duplicates a route inactive and unassigned", async () => {
    const t = await signup("r3@x.com");
    const c = (
      await request(app)
        .post("/api/v1/routes")
        .set(auth(t))
        .send(route("D1", [stop("A", 1, 1), stop("B", 2, 2)]))
    ).body.data;
    const dup = await request(app)
      .post(`/api/v1/routes/${c._id}/duplicate`)
      .set(auth(t))
      .send({ code: "D2" });
    expect(dup.status).toBe(201);
    expect(dup.body.data.stops).toHaveLength(2);
    expect(dup.body.data.active).toBe(false);
    expect(
      (
        await request(app)
          .post(`/api/v1/routes/${c._id}/duplicate`)
          .set(auth(t))
          .send({ code: "D2" })
      ).status,
    ).toBe(409);
  });

  it("isolates tenants, including vehicle/driver references", async () => {
    const a = await signup("ra@x.com");
    const b = await signup("rb@x.com");
    const rt = (
      await request(app)
        .post("/api/v1/routes")
        .set(auth(a))
        .send(route("T1", [stop("A", 1, 1), stop("B", 2, 2)]))
    ).body.data;
    expect(
      (await request(app).get(`/api/v1/routes/${rt._id}`).set(auth(b))).status,
    ).toBe(404);
    expect(
      (await request(app).get("/api/v1/routes").set(auth(b))).body.data,
    ).toHaveLength(0);
    const va = (
      await request(app)
        .post("/api/v1/vehicles")
        .set(auth(a))
        .send({ registrationNumber: "MH12AB9999", capacity: 30 })
    ).body.data;
    const cross = await request(app)
      .post("/api/v1/routes")
      .set(auth(b))
      .send({ ...route("T2", []), assignedVehicle: va._id });
    expect(cross.status).toBe(404);
  });

  it("blocks assigning an unavailable vehicle", async () => {
    const t = await signup("r4@x.com");
    const v = (
      await request(app)
        .post("/api/v1/vehicles")
        .set(auth(t))
        .send({ registrationNumber: "MH12AB7777", capacity: 30 })
    ).body.data;
    await request(app)
      .patch(`/api/v1/vehicles/${v._id}/status`)
      .set(auth(t))
      .send({ status: "maintenance" });
    expect(
      (
        await request(app)
          .post("/api/v1/routes")
          .set(auth(t))
          .send({ ...route("V1", []), assignedVehicle: v._id })
      ).status,
    ).toBe(409);
  });
});
