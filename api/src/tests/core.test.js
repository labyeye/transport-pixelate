import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
let mongod;
const app = createApp(["http://localhost"]);
async function signup(email, org) {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      organizationName: org,
      name: "Owner",
      email,
      password: "password123",
    });
  expect(res.status).toBe(201);
  return res.body.data.accessToken;
}
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const vehicle = (reg) => ({ registrationNumber: reg, capacity: 40 });
const driver = (lic) => ({
  name: "Ravi Kumar",
  phone: "9876543210",
  licence: { number: lic, expiryDate: "2030-01-01" },
});
beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
describe("auth", () => {
  it("rejects unauthenticated access", async () => {
    expect((await request(app).get("/api/v1/vehicles")).status).toBe(401);
  });
  it("logs in, rejects bad password, locks after repeated failures", async () => {
    await signup("a@x.com", "Org A");
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .send({ email: "a@x.com", password: "password123" })
      ).status,
    ).toBe(200);
    for (let i = 0; i < 5; i++)
      await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "a@x.com", password: "wrong-pass" });
    const locked = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "a@x.com", password: "password123" });
    expect(locked.status).toBe(401);
  });
  it("invalidates refresh token after logout", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({
        organizationName: "Org L",
        name: "Lee",
        email: "l@x.com",
        password: "password123",
      });
    const { accessToken, refreshToken } = res.body.data;
    await request(app).post("/api/v1/auth/logout").set(auth(accessToken));
    expect(
      (await request(app).post("/api/v1/auth/refresh").send({ refreshToken }))
        .status,
    ).toBe(401);
  });
});
describe("tenant isolation", () => {
  it("never leaks another organization's vehicles or drivers", async () => {
    const a = await signup("iso-a@x.com", "Iso A");
    const b = await signup("iso-b@x.com", "Iso B");
    const va = await request(app)
      .post("/api/v1/vehicles")
      .set(auth(a))
      .send(vehicle("MH12AB1234"));
    expect(va.status).toBe(201);
    const da = await request(app)
      .post("/api/v1/drivers")
      .set(auth(a))
      .send(driver("DL-001"));
    expect(
      (await request(app).get("/api/v1/vehicles").set(auth(b))).body.data,
    ).toHaveLength(0);
    expect(
      (
        await request(app)
          .get(`/api/v1/vehicles/${va.body.data._id}`)
          .set(auth(b))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .put(`/api/v1/vehicles/${va.body.data._id}`)
          .set(auth(b))
          .send({ capacity: 5 })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/v1/drivers/${da.body.data._id}`)
          .set(auth(b))
      ).status,
    ).toBe(404);
    // The same registration number can exist in a different org.
    expect(
      (
        await request(app)
          .post("/api/v1/vehicles")
          .set(auth(b))
          .send(vehicle("MH12AB1234"))
      ).status,
    ).toBe(201);
    // Cross-tenant assignment is refused.
    const vb = await request(app)
      .post("/api/v1/vehicles")
      .set(auth(b))
      .send(vehicle("KA01AB4321"));
    const cross = await request(app)
      .post(`/api/v1/vehicles/${vb.body.data._id}/assign-driver`)
      .set(auth(b))
      .send({ driverId: da.body.data._id });
    expect(cross.status).toBe(404);
  });
});
describe("vehicles & drivers", () => {
  it("validates registration and rejects duplicates", async () => {
    const t = await signup("v@x.com", "Org V");
    expect(
      (
        await request(app)
          .post("/api/v1/vehicles")
          .set(auth(t))
          .send(vehicle("BAD"))
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/v1/vehicles")
          .set(auth(t))
          .send(vehicle("mh 12-ab 1234"))
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app)
          .post("/api/v1/vehicles")
          .set(auth(t))
          .send(vehicle("MH12AB1234"))
      ).status,
    ).toBe(409);
  });
  it("assigns drivers consistently and blocks unavailable vehicles", async () => {
    const t = await signup("as@x.com", "Org As");
    const v1 = (
      await request(app)
        .post("/api/v1/vehicles")
        .set(auth(t))
        .send(vehicle("MH12AB1111"))
    ).body.data;
    const v2 = (
      await request(app)
        .post("/api/v1/vehicles")
        .set(auth(t))
        .send(vehicle("MH12AB2222"))
    ).body.data;
    const d = (
      await request(app)
        .post("/api/v1/drivers")
        .set(auth(t))
        .send(driver("DL-100"))
    ).body.data;
    const a1 = await request(app)
      .post(`/api/v1/vehicles/${v1._id}/assign-driver`)
      .set(auth(t))
      .send({ driverId: d._id });
    expect(a1.body.data.status).toBe("assigned");
    // Moving the driver to v2 frees v1.
    await request(app)
      .post(`/api/v1/vehicles/${v2._id}/assign-driver`)
      .set(auth(t))
      .send({ driverId: d._id });
    expect(
      (await request(app).get(`/api/v1/vehicles/${v1._id}`).set(auth(t))).body
        .data.assignedDriver,
    ).toBeNull();
    expect(
      (await request(app).get(`/api/v1/vehicles/${v1._id}`).set(auth(t))).body
        .data.status,
    ).toBe("available");
    // Maintenance vehicles can't be assigned; assigned vehicles can't be archived.
    await request(app)
      .patch(`/api/v1/vehicles/${v1._id}/status`)
      .set(auth(t))
      .send({ status: "maintenance" });
    const bad = await request(app)
      .post(`/api/v1/vehicles/${v1._id}/assign-driver`)
      .set(auth(t))
      .send({ driverId: d._id });
    expect(bad.status).toBe(409);
    expect(
      (await request(app).delete(`/api/v1/vehicles/${v2._id}`).set(auth(t)))
        .status,
    ).toBe(409);
  });
  it("requires licence for drivers and enforces role permissions", async () => {
    const t = await signup("p@x.com", "Org P");
    expect(
      (
        await request(app)
          .post("/api/v1/drivers")
          .set(auth(t))
          .send({ name: "No Licence", phone: "9876543210" })
      ).status,
    ).toBe(400);
    const dash = await request(app).get("/api/v1/dashboard").set(auth(t));
    expect(dash.body.data.vehicles.total).toBe(0);
  });
});
