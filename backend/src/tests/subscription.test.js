import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { calculatePricing } from "../modules/saas/pricing.js";
import { __setBillingFetch } from "../modules/billing/billing.service.js";
import { Subscription } from "../models/Subscription.js";
import { OfferCode } from "../models/OfferCode.js";
import { Organization } from "../models/Organization.js";
import { Vehicle } from "../models/Vehicle.js";

process.env.RAZORPAY_KEY_ID = "rzp_test_x";
process.env.RAZORPAY_KEY_SECRET = "secret_x";
process.env.PRICE_BASIC_PAISE = "10000";
process.env.PRICE_PRO_PAISE = "20000";
process.env.TRIAL_VEHICLES = "2";

let mongod;
const app = createApp(["http://localhost"]);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
let n = 0;
async function signup(extra = {}) {
  const email = `o${++n}@x.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      organizationName: `Org ${n}`,
      name: "Owner",
      email,
      password: "password123",
      ...extra,
    });
  expect(res.status).toBe(201);
  const me = await Organization.findOne({ name: `Org ${n}` });
  return { token: res.body.data.accessToken, org: me._id };
}
const vehicle = (reg) => ({ registrationNumber: reg, capacity: 40 });
const sign = (o, p) =>
  crypto.createHmac("sha256", "secret_x").update(`${o}|${p}`).digest("hex");

// Razorpay stub: orders echo the amount; payments are looked up from what the test registers.
const payments = {};
__setBillingFetch(async (url, init) => {
  if (url.endsWith("/orders")) {
    const b = JSON.parse(init.body);
    return { ok: true, json: async () => ({ id: `order_${Date.now()}_${Math.random()}`, amount: b.amount }) };
  }
  const id = decodeURIComponent(url.split("/").pop());
  return { ok: true, json: async () => payments[id] };
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

describe("pricing", () => {
  it("is per vehicle, GST on top, yearly = 12x", () => {
    const m = calculatePricing(10, "basic", "monthly");
    expect([m.rate, m.subtotal, m.gstAmount, m.total]).toEqual([10000, 100000, 18000, 118000]);
    expect(calculatePricing(10, "basic", "yearly").subtotal).toBe(1200000);
  });
  it("applies flat_rate, percent_off and bonus_months offers", () => {
    expect(calculatePricing(10, "pro", "monthly", { discountType: "flat_rate", flatRate: 5000 }).subtotal).toBe(50000);
    expect(calculatePricing(10, "pro", "monthly", { discountType: "percent_off", percentOff: 50 }).subtotal).toBe(100000);
    expect(calculatePricing(10, "pro", "monthly", { discountType: "bonus_months", bonusMonths: 2 }).bonusMonths).toBe(2);
  });
});

describe("trial, gate and quota", () => {
  it("register starts a trial with company details", async () => {
    const { token, org } = await signup({ phone: "9876543210", gstNumber: "27ABCDE1234F1Z5" });
    const r = await request(app).get("/api/v1/subscription").set(auth(token));
    expect(r.body.data.subscription).toMatchObject({ isTrial: true, ok: true, vehicleLimit: 2 });
    expect((await Organization.findById(org)).gstNumber).toBe("27ABCDE1234F1Z5");
  });
  it("rejects a malformed GSTIN", async () => {
    const r = await request(app).post("/api/v1/auth/register").send({
      organizationName: "Bad", name: "O", email: "bad@x.com", password: "password123", gstNumber: "nope",
    });
    expect(r.status).toBe(400);
  });
  it("enforces the vehicle limit", async () => {
    const { token } = await signup();
    for (const reg of ["MH12AB1001", "MH12AB1002"])
      expect((await request(app).post("/api/v1/vehicles").set(auth(token)).send(vehicle(reg))).status).toBe(201);
    const r = await request(app).post("/api/v1/vehicles").set(auth(token)).send(vehicle("MH12AB1003"));
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/limit/i);
  });
  it("locks the product after the trial but keeps subscription/auth reachable", async () => {
    const { token, org } = await signup();
    await Subscription.updateOne({ organization: org }, { trialEndDate: new Date(Date.now() - 1000) });
    const v = await request(app).get("/api/v1/vehicles").set(auth(token));
    expect(v.status).toBe(403);
    expect(v.body.message).toMatch(/trial/i);
    expect(v.body.errors.code).toBe("SUBSCRIPTION_REQUIRED");
    expect((await request(app).get("/api/v1/subscription").set(auth(token))).body.data.subscription.ok).toBe(false);
    expect((await request(app).get("/api/v1/auth/me").set(auth(token))).status).toBe(200);
  });
  it("starts a trial for organizations that predate subscriptions", async () => {
    const { token, org } = await signup();
    await Subscription.deleteOne({ organization: org });
    expect((await request(app).get("/api/v1/vehicles").set(auth(token))).status).toBe(200);
    expect(await Subscription.countDocuments({ organization: org })).toBe(1);
  });
  it("keeps tenants separate", async () => {
    const a = await signup();
    const b = await signup();
    await Subscription.updateOne({ organization: a.org }, { trialEndDate: new Date(Date.now() - 1000) });
    expect((await request(app).get("/api/v1/vehicles").set(auth(a.token))).status).toBe(403);
    expect((await request(app).get("/api/v1/vehicles").set(auth(b.token))).status).toBe(200);
  });
  it("basic tier closes fee billing, pro opens it", async () => {
    const { token, org } = await signup();
    await Organization.updateOne({ _id: org }, { "modules.billing": true });
    await Subscription.updateOne({ organization: org }, { tier: "basic" });
    expect((await request(app).get("/api/v1/billing/config").set(auth(token))).status).toBe(403);
    await Subscription.updateOne({ organization: org }, { tier: "pro" });
    expect((await request(app).get("/api/v1/billing/config").set(auth(token))).status).toBe(200);
  });
});

describe("paying", () => {
  async function order(token, body) {
    return request(app).post("/api/v1/subscription/order").set(auth(token)).send(body);
  }
  it("activates only after a valid signature and a matching captured payment", async () => {
    const { token, org } = await signup();
    await OfferCode.create({ code: "BONUS2", discountType: "bonus_months", bonusMonths: 2 });
    const o = await order(token, { vehicles: 5, tier: "basic", billingCycle: "monthly", offerCode: "bonus2" });
    expect(o.status).toBe(201);
    expect(o.body.data.total).toBe(59000);
    const oid = o.body.data.orderId;
    payments.pay_1 = { order_id: oid, amount: 59000, status: "captured" };

    const bad = await request(app).post("/api/v1/subscription/verify").set(auth(token))
      .send({ razorpay_order_id: oid, razorpay_payment_id: "pay_1", razorpay_signature: "x".repeat(64) });
    expect(bad.status).toBe(400);
    expect((await Subscription.findOne({ organization: org })).isTrial).toBe(true);

    const ok = await request(app).post("/api/v1/subscription/verify").set(auth(token))
      .send({ razorpay_order_id: oid, razorpay_payment_id: "pay_1", razorpay_signature: sign(oid, "pay_1") });
    expect(ok.status).toBe(200);
    expect(ok.body.data.subscription).toMatchObject({ isTrial: false, tier: "basic", vehicleLimit: 5, ok: true });
    expect((await OfferCode.findOne({ code: "BONUS2" })).usedCount).toBe(1);
    // Replaying the same payment changes nothing.
    const again = await request(app).post("/api/v1/subscription/verify").set(auth(token))
      .send({ razorpay_order_id: oid, razorpay_payment_id: "pay_1", razorpay_signature: sign(oid, "pay_1") });
    expect(again.status).toBe(200);
    expect((await OfferCode.findOne({ code: "BONUS2" })).usedCount).toBe(1);
  });
  it("rejects a payment whose amount differs from the order", async () => {
    const { token } = await signup();
    const o = await order(token, { vehicles: 3, tier: "pro", billingCycle: "monthly" });
    const oid = o.body.data.orderId;
    payments.pay_2 = { order_id: oid, amount: 100, status: "captured" };
    const r = await request(app).post("/api/v1/subscription/verify").set(auth(token))
      .send({ razorpay_order_id: oid, razorpay_payment_id: "pay_2", razorpay_signature: sign(oid, "pay_2") });
    expect(r.status).toBe(400);
  });
  it("will not sell fewer vehicles than are already active", async () => {
    const { token, org } = await signup();
    await Vehicle.create([{ organization: org, registrationNumber: "MH12AB2001" }, { organization: org, registrationNumber: "MH12AB2002" }]);
    const r = await order(token, { vehicles: 1, tier: "basic" });
    expect(r.status).toBe(400);
  });
  it("only owners/admins can change the plan", async () => {
    const { token } = await signup();
    const r = await request(app).post("/api/v1/subscription/quote").send({ vehicles: 1, tier: "basic" });
    expect(r.status).toBe(401);
    expect((await request(app).post("/api/v1/subscription/quote").set(auth(token)).send({ vehicles: 4, tier: "pro" })).body.data.total).toBe(94400);
  });
});

describe("reminders", () => {
  it("tells the owner once per stage as the trial runs out", async () => {
    const { org } = await signup();
    const { subscriptionReminders } = await import("../modules/notifications/jobs.js");
    const { Notification } = await import("../models/Notification.js");
    const sub = await Subscription.findOne({ organization: org });
    const day = 86_400_000;
    const at = (d) => sub.trialEndDate.getTime() - d * day;
    expect(await subscriptionReminders(org, at(20))).toBe(0); // too early
    await subscriptionReminders(org, at(6));
    await subscriptionReminders(org, at(6)); // same stage again: deduped
    await subscriptionReminders(org, at(2));
    expect(await Notification.countDocuments({ organization: org })).toBe(2);
    await subscriptionReminders(org, at(-1));
    expect(await Notification.countDocuments({ organization: org })).toBe(3);
  });
});
