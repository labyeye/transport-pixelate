import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Organization } from "../models/Organization.js";
import { Payment } from "../models/Payment.js";
import { Invoice } from "../models/Invoice.js";
import { AuditLog } from "../models/AuditLog.js";
import { __setBillingFetch } from "../modules/billing/billing.service.js";

let mongod;
const app = createApp(["http://localhost"]);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
let n = 0;
const KEY_SECRET = "rzp_test_secret_value";
const WH_SECRET = "whsec_test_value";
const hmac = (secret, data) =>
  crypto.createHmac("sha256", secret).update(data).digest("hex");
const future = (d) => new Date(Date.now() + d * 86400000).toISOString();

async function world(email, { billing = true } = {}) {
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
  if (billing)
    await Organization.updateOne({ _id: org }, { "modules.billing": true });
  const api = (method, url, tok = t) =>
    request(app)[method](url).set(auth(tok));
  const post = async (url, body) =>
    (await api("post", url).send(body)).body.data;
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
      { name: "C", lat: 3, lng: 3 },
    ],
  });
  const route2 = await post("/api/v1/routes", {
    name: "Route Two",
    code: "R2",
    stops: [
      { name: "X", lat: 1, lng: 1 },
      { name: "Y", lat: 2, lng: 2 },
    ],
  });
  const kid = async (name, r = route, pick = "A", drop = "C") => {
    const p = await post("/api/v1/passengers", {
      name: `${name} ${++n}`,
      guardian: { name: "Parent " + name, phone: "9876543210" },
    });
    if (r)
      await post(`/api/v1/passengers/${p._id}/assignments`, {
        route: r._id,
        pickupStop: pick,
        dropStop: drop,
      });
    return p;
  };
  const plan = (b) =>
    api("post", "/api/v1/billing/fee-plans").send({
      frequency: "monthly",
      ...b,
    });
  const gen = (b = {}) =>
    api("post", "/api/v1/billing/invoices/generate").send({
      period: "2030-04",
      dueDate: future(10),
      ...b,
    });
  const invoice = async (passenger, amount = 100000, extra = {}) =>
    (
      await api("post", "/api/v1/billing/invoices").send({
        passenger: passenger._id,
        period: "2030-05",
        dueDate: future(10),
        lines: [{ description: "Transport fee", kind: "fee", amount }],
        ...extra,
      })
    ).body.data;
  const pay = (inv, b, tok = t) =>
    api(
      "post",
      `/api/v1/billing/invoices/${inv._id ?? inv}/payments`,
      tok,
    ).send({ method: "cash", ...b });
  const get = (u, tok = t) => api("get", u, tok);
  return {
    reg,
    org,
    t,
    api,
    post,
    as,
    route,
    route2,
    kid,
    plan,
    gen,
    invoice,
    pay,
    get,
  };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  __setBillingFetch(null);
  await mongoose.disconnect();
  await mongod.stop();
});
beforeEach(() => {
  __setBillingFetch(null);
  process.env.RAZORPAY_KEY_ID = "rzp_test_key";
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WH_SECRET;
});

describe("module gate & permissions", () => {
  it("is off by default and respects roles", async () => {
    const off = await world("b0@x.com", { billing: false });
    expect((await off.get("/api/v1/billing/fee-plans")).status).toBe(403);
    const w = await world("b0b@x.com");
    const disp = await w.as("dispatcher", "b0-disp@x.com");
    const viewer = await w.as("viewer", "b0-view@x.com");
    const acct = await w.as("accountant", "b0-acct@x.com");
    expect((await w.get("/api/v1/billing/fee-plans", disp)).status).toBe(403);
    expect((await w.get("/api/v1/billing/fee-plans", viewer)).status).toBe(200);
    expect(
      (
        await w
          .api("post", "/api/v1/billing/fee-plans", viewer)
          .send({ name: "Plan", kind: "flat", amount: 1000 })
      ).status,
    ).toBe(403);
    expect(
      (
        await w
          .api("post", "/api/v1/billing/fee-plans", acct)
          .send({ name: "Plan", kind: "flat", amount: 1000 })
      ).status,
    ).toBe(201);
    expect((await request(app).get("/api/v1/billing/fee-plans")).status).toBe(
      401,
    );
  });
});

describe("fee plans & invoice generation", () => {
  it("validates plans and blocks duplicate active plans", async () => {
    const w = await world("b1@x.com");
    expect(
      (await w.plan({ name: "No route", kind: "route", amount: 5000 })).status,
    ).toBe(400);
    expect(
      (
        await w.plan({
          name: "Bad stop",
          kind: "stop",
          route: w.route._id,
          stopName: "Nowhere",
          amount: 5000,
        })
      ).status,
    ).toBe(409);
    expect(
      (await w.plan({ name: "Float", kind: "flat", amount: 50.5 })).status,
    ).toBe(400); // minor units are integers
    expect(
      (await w.plan({ name: "Negative", kind: "flat", amount: -1 })).status,
    ).toBe(400);
    expect(
      (
        await w.plan({
          name: "R1 monthly",
          kind: "route",
          route: w.route._id,
          amount: 120000,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await w.plan({
          name: "R1 again",
          kind: "route",
          route: w.route._id,
          amount: 130000,
        })
      ).status,
    ).toBe(409);
  });

  it("applies the most specific plan, flat plans once, passenger charges, and never goes negative", async () => {
    const w = await world("b2@x.com");
    await w.plan({
      name: "Route fee",
      kind: "route",
      route: w.route._id,
      amount: 100000,
    });
    await w.plan({
      name: "Far stop fee",
      kind: "stop",
      route: w.route._id,
      stopName: "B",
      amount: 150000,
    });
    await w.plan({ name: "Admin fee", kind: "flat", amount: 10000 });
    const onA = await w.kid("OnA", w.route, "A", "C"); // route fee
    const onB = await w.kid("OnB", w.route, "B", "C"); // stop plan overrides route plan
    const free = await w.kid("Free", w.route, "A", "C");
    await w.api("post", "/api/v1/billing/charges").send({
      passenger: onA._id,
      label: "Sibling discount",
      type: "discount",
      mode: "percent",
      value: 10,
    });
    await w.api("post", "/api/v1/billing/charges").send({
      passenger: onB._id,
      label: "Special service",
      type: "surcharge",
      mode: "fixed",
      value: 5000,
    });
    await w.api("post", "/api/v1/billing/charges").send({
      passenger: free._id,
      label: "Scholarship",
      type: "discount",
      mode: "fixed",
      value: 99999999,
      toPeriod: "2030-04",
    });
    const out = (await w.gen()).body.data;
    expect(out.created).toHaveLength(3);
    const list = (await w.get("/api/v1/billing/invoices?limit=50")).body.data;
    const totalFor = (p) => list.find((i) => i.passenger._id === p._id).total;
    expect(totalFor(onA)).toBe(100000 + 10000 - 11000); // fees 110000, 10% = 11000 off
    expect(totalFor(onB)).toBe(150000 + 10000 + 5000);
    expect(totalFor(free)).toBe(0); // discount larger than fees clamps at zero
    const detail = (
      await w.get(
        `/api/v1/billing/invoices/${list.find((i) => i.passenger._id === onA._id)._id}`,
      )
    ).body.data;
    expect(detail.lines.map((l) => [l.kind, l.amount])).toEqual([
      ["fee", 100000],
      ["fee", 10000],
      ["discount", -11000],
    ]);
    expect(detail.status).toBe("issued");
    expect(list.find((i) => i.passenger._id === free._id).status).toBe("paid"); // nothing to pay
  });

  it("previews without writing, is idempotent, and explains every skip", async () => {
    const w = await world("b3@x.com");
    await w.plan({
      name: "R1 fee",
      kind: "route",
      route: w.route._id,
      amount: 100000,
    });
    await w.kid("Rider");
    await w.kid("OtherRoute", w.route2, "X", "Y"); // no plan for route two
    await w.kid("Nobody", null); // unassigned
    const prev = (await w.gen({ preview: true })).body.data;
    expect(prev.created).toHaveLength(1);
    expect((await w.get("/api/v1/billing/invoices")).body.data).toHaveLength(0);
    const first = (await w.gen()).body.data;
    expect(first.created).toHaveLength(1);
    expect(first.skipped.map((s) => s.reason).sort()).toEqual([
      "No fee plan applies to their route or stop",
      "Not assigned to a route",
    ]);
    const second = (await w.gen()).body.data;
    expect(second.created).toHaveLength(0);
    expect(
      second.skipped.some((s) => /Already invoiced for 2030-04/.test(s.reason)),
    ).toBe(true);
    expect((await w.get("/api/v1/billing/invoices")).body.data).toHaveLength(1);
    expect((await w.gen({ period: "2030-05" })).body.data.created).toHaveLength(
      1,
    ); // a new period is fine
    expect((await w.gen({ period: "bad/period!" })).status).toBe(400);
  });

  it("a plan change affects only later invoices; voiding allows regeneration", async () => {
    const w = await world("b4@x.com");
    const p = (
      await w.plan({
        name: "R1 fee",
        kind: "route",
        route: w.route._id,
        amount: 100000,
      })
    ).body.data;
    await w.kid("Rider");
    await w.gen();
    await w.api("put", `/api/v1/billing/fee-plans/${p._id}`).send({
      name: "R1 fee",
      kind: "route",
      route: w.route._id,
      amount: 200000,
      frequency: "monthly",
      active: true,
    });
    const inv = (await w.get("/api/v1/billing/invoices")).body.data[0];
    expect(inv.total).toBe(100000);
    expect(
      (
        await w
          .api("post", `/api/v1/billing/invoices/${inv._id}/void`)
          .send({ reason: "Wrong plan" })
      ).status,
    ).toBe(200);
    const again = (await w.gen()).body.data;
    expect(again.created).toHaveLength(1);
    expect(again.created[0].total).toBe(200000);
  });
});

describe("payments, refunds and adjustments", () => {
  it("tracks partial and full payment and refuses overpayment, missing references and duplicates", async () => {
    const w = await world("b5@x.com");
    const inv = await w.invoice(await w.kid("Pay"));
    expect(inv.total).toBe(100000);
    const p1 = await w.pay(inv, { amount: 40000 });
    expect(p1.status).toBe(201);
    expect(p1.body.invoice).toMatchObject({
      paid: 40000,
      balance: 60000,
      status: "partially_paid",
    });
    expect((await w.pay(inv, { amount: 60001 })).status).toBe(409);
    expect((await w.pay(inv, { amount: 100, method: "upi" })).status).toBe(400); // reference required
    expect((await w.pay(inv, { amount: 10.5 })).status).toBe(400);
    expect(
      (await w.pay(inv, { amount: 100, receivedAt: future(5) })).status,
    ).toBe(400);
    const a = await w.pay(inv, {
      amount: 60000,
      method: "upi",
      reference: "UPI123",
      clientRef: "client-ref-pay-1",
    });
    const b = await w.pay(inv, {
      amount: 60000,
      method: "upi",
      reference: "UPI123",
      clientRef: "client-ref-pay-1",
    });
    expect(a.body.invoice.status).toBe("paid");
    expect(b.body.duplicate).toBe(true);
    expect(await Payment.countDocuments({ invoice: inv._id })).toBe(2);
    expect((await w.pay(inv, { amount: 1 })).status).toBe(409); // nothing left
    expect(p1.body.data.number).toBe("RCT-00001");
  });

  it("never over-collects when two payments race", async () => {
    const w = await world("b6@x.com");
    const inv = await w.invoice(await w.kid("Race"));
    const res = await Promise.all([
      w.pay(inv, { amount: 100000 }),
      w.pay(inv, { amount: 100000 }),
      w.pay(inv, { amount: 100000 }),
    ]);
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    const after = await Invoice.findById(inv._id);
    expect(after.balance).toBe(0);
    expect(after.paid).toBe(100000);
    expect(await Payment.countDocuments({ invoice: inv._id })).toBe(1);
  });

  it("refunds append records, restore the balance, and are capped by the payment", async () => {
    const w = await world("b7@x.com");
    const acct = await w.as("accountant", "b7-acct@x.com");
    const inv = await w.invoice(await w.kid("Refund"));
    const pay = (await w.pay(inv, { amount: 100000 })).body.data;
    expect(
      (
        await w
          .api("post", `/api/v1/billing/payments/${pay._id}/refund`)
          .send({ amount: 30000 })
      ).status,
    ).toBe(400); // reason needed
    expect(
      (
        await w
          .api("post", `/api/v1/billing/payments/${pay._id}/refund`)
          .send({ amount: 120000, reason: "Too much" })
      ).status,
    ).toBe(409);
    const ref = await w
      .api("post", `/api/v1/billing/payments/${pay._id}/refund`)
      .send({ amount: 30000, reason: "Overcharged" });
    expect(ref.status).toBe(201);
    expect(ref.body.invoice).toMatchObject({
      paid: 70000,
      balance: 30000,
      status: "partially_paid",
    });
    // Simultaneous refunds can't exceed what's left (70000).
    const race = await Promise.all(
      [1, 2, 3].map(() =>
        w
          .api("post", `/api/v1/billing/payments/${pay._id}/refund`, acct)
          .send({ amount: 40000, reason: "Duplicate" }),
      ),
    );
    expect(race.filter((r) => r.status === 201)).toHaveLength(1);
    const p = await Payment.findById(pay._id);
    expect(p.refundedAmount).toBe(70000);
    const detail = (await w.get(`/api/v1/billing/invoices/${inv._id}`)).body
      .data;
    expect(detail.refunds).toHaveLength(2);
    expect(detail.payments[0].amount).toBe(100000); // original payment untouched
    // Voiding is refused while money is held; once everything is refunded it is allowed.
    const voidIt = () =>
      w
        .api("post", `/api/v1/billing/invoices/${inv._id}/void`)
        .send({ reason: "Test void" });
    expect((await voidIt()).status).toBe(409);
    await w
      .api("post", `/api/v1/billing/payments/${pay._id}/refund`)
      .send({ amount: 30000, reason: "Close out" });
    expect((await voidIt()).status).toBe(200);
  });

  it("keeps adjustments attributed and prevents dropping below the amount paid", async () => {
    const w = await world("b8@x.com");
    const inv = await w.invoice(await w.kid("Adjust"));
    await w.pay(inv, { amount: 60000 });
    const adj = (b) =>
      w.api("post", `/api/v1/billing/invoices/${inv._id}/adjust`).send(b);
    expect(
      (await adj({ description: "Goodwill", kind: "discount", amount: -10000 }))
        .status,
    ).toBe(400); // reason needed
    expect(
      (
        await adj({
          description: "Goodwill",
          kind: "discount",
          amount: 10000,
          reason: "Wrong sign",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await adj({
          description: "Too generous",
          kind: "discount",
          amount: -50000,
          reason: "Waiver",
        })
      ).status,
    ).toBe(409); // 50000 total < 60000 paid
    const ok = await adj({
      description: "Goodwill",
      kind: "discount",
      amount: -30000,
      reason: "Service disruption",
    });
    expect(ok.body.data).toMatchObject({
      total: 70000,
      balance: 10000,
      status: "partially_paid",
    });
    const detail = (await w.get(`/api/v1/billing/invoices/${inv._id}`)).body
      .data;
    expect(detail.lines.at(-1)).toMatchObject({
      kind: "discount",
      reason: "Service disruption",
      amount: -30000,
    });
    expect(detail.lines.at(-1).addedBy.name).toBe("Owner");
    expect(
      await AuditLog.countDocuments({
        organization: w.org,
        action: "billing.invoice.adjust",
      }),
    ).toBe(1);
    // Voiding a part-paid invoice is refused.
    expect(
      (
        await w
          .api("post", `/api/v1/billing/invoices/${inv._id}/void`)
          .send({ reason: "Oops" })
      ).status,
    ).toBe(409);
  });

  it("reconciles payments once, ages outstanding balances, and issues receipts", async () => {
    const w = await world("b9@x.com");
    const k1 = await w.kid("Late"),
      k2 = await w.kid("Current");
    const late = await w.invoice(k1, 50000, {
      period: "2030-01",
      dueDate: new Date(Date.now() - 45 * 86400000).toISOString(),
    });
    const cur = await w.invoice(k2, 70000);
    const pay = (await w.pay(cur, { amount: 20000, method: "cash" })).body.data;
    expect(
      (
        await w
          .api("post", `/api/v1/billing/payments/${pay._id}/reconcile`)
          .send({ reference: "DEP-9" })
      ).status,
    ).toBe(200);
    expect(
      (
        await w
          .api("post", `/api/v1/billing/payments/${pay._id}/reconcile`)
          .send({})
      ).status,
    ).toBe(409);
    expect(
      (await w.get("/api/v1/billing/payments?reconciled=false")).body.data,
    ).toHaveLength(0);
    expect(
      (await w.get("/api/v1/billing/payments?reconciled=true")).body.data,
    ).toHaveLength(1);
    const out = (await w.get("/api/v1/billing/outstanding")).body.data;
    expect(out.totals).toMatchObject({
      balance: 100000,
      current: 50000,
      d31_60: 50000,
    });
    expect(out.rows[0].passenger.name).toMatch(/Late|Current/);
    expect(late.status).toBe("issued");
    const rc = (await w.get(`/api/v1/billing/payments/${pay._id}/receipt`)).body
      .data;
    expect(rc).toMatchObject({
      receiptNumber: "RCT-00001",
      currency: "INR",
      invoice: { balance: 50000 },
    });
    expect(
      (await w.get("/api/v1/billing/invoices?status=overdue")).body.data,
    ).toHaveLength(1);
  });

  it("isolates tenants", async () => {
    const a = await world("b10@x.com"),
      b = await world("b10b@x.com");
    const inv = await a.invoice(await a.kid("Private"));
    expect((await b.get(`/api/v1/billing/invoices/${inv._id}`)).status).toBe(
      404,
    );
    expect((await b.pay(inv, { amount: 100 })).status).toBe(404);
    expect((await b.get("/api/v1/billing/invoices")).body.data).toHaveLength(0);
    expect(
      (
        await b.api("post", "/api/v1/billing/invoices").send({
          passenger: inv.passenger,
          period: "2030-06",
          dueDate: future(5),
          lines: [{ description: "Fee", kind: "fee", amount: 100 }],
        })
      ).status,
    ).toBe(404);
  });
});

describe("razorpay online payments", () => {
  const mockRazorpay = ({
    status = "captured",
    amountDelta = 0,
    failLookup = false,
    orderMismatch = false,
  } = {}) => {
    const calls = [];
    __setBillingFetch(async (url, opts) => {
      calls.push({ url, opts });
      if (url.endsWith("/orders")) {
        const b = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "order_" + crypto.randomBytes(5).toString("hex"),
            amount: b.amount,
            currency: b.currency,
          }),
        };
      }
      if (failLookup)
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: { description: "down" } }),
        };
      const paymentId = decodeURIComponent(url.split("/payments/")[1]);
      const intent = calls.__intent;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: paymentId,
          status,
          amount: intent.amount + amountDelta,
          order_id: orderMismatch ? "order_other" : intent.orderId,
        }),
      };
    });
    return calls;
  };
  const begin = async (w, amount = 100000) => {
    const inv = await w.invoice(await w.kid("Online"), amount);
    const calls = mockRazorpay();
    const o = (
      await w.api("post", `/api/v1/billing/invoices/${inv._id}/razorpay-order`)
    ).body.data;
    return { inv, o, calls };
  };
  const verify = (w, o, paymentId = "pay_ABCDEF123456", sig) =>
    w.api("post", "/api/v1/billing/razorpay/verify").send({
      orderId: o.orderId,
      paymentId,
      signature: sig ?? hmac(KEY_SECRET, `${o.orderId}|${paymentId}`),
    });
  const webhook = (body, secret = WH_SECRET, sigOverride) => {
    const raw = JSON.stringify(body);
    return request(app)
      .post("/api/v1/billing/razorpay/webhook")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", sigOverride ?? hmac(secret, raw))
      .send(raw);
  };
  const captured = (o, paymentId = "pay_WEBHOOK00001", amount = o.amount) => ({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: o.orderId,
          amount,
          currency: "INR",
          status: "captured",
        },
      },
    },
  });

  it("creates an order for exactly the balance and exposes only the public key", async () => {
    const w = await world("r1@x.com");
    const inv = await w.invoice(await w.kid("Order"));
    await w.pay(inv, { amount: 25000 });
    const calls = mockRazorpay();
    const res = await w.api(
      "post",
      `/api/v1/billing/invoices/${inv._id}/razorpay-order`,
    );
    expect(res.body.data).toMatchObject({
      amount: 75000,
      currency: "INR",
      keyId: "rzp_test_key",
    });
    expect(JSON.stringify(res.body)).not.toContain(KEY_SECRET);
    expect(JSON.parse(calls[0].opts.body)).toMatchObject({
      amount: 75000,
      receipt: inv.number,
    });
    expect(calls[0].opts.headers.Authorization).toMatch(/^Basic /);
    const cfg = (await w.get("/api/v1/billing/config")).body.data;
    expect(cfg.razorpay).toMatchObject({
      enabled: true,
      keyId: "rzp_test_key",
    });
    expect(JSON.stringify(cfg)).not.toContain(KEY_SECRET);
    delete process.env.RAZORPAY_KEY_SECRET;
    expect(
      (
        await w.api(
          "post",
          `/api/v1/billing/invoices/${inv._id}/razorpay-order`,
        )
      ).status,
    ).toBe(409);
  });

  it("records a verified payment once and refuses forged or mismatched ones", async () => {
    const w = await world("r2@x.com");
    const { inv, o, calls } = await begin(w);
    calls.__intent = { amount: o.amount, orderId: o.orderId };
    // Forged signature: nothing recorded.
    expect(
      (await verify(w, o, "pay_ABCDEF123456", "0".repeat(64))).status,
    ).toBe(400);
    expect(await Payment.countDocuments({ invoice: inv._id })).toBe(0);
    // Valid signature but Razorpay says the amount differs: refused.
    mockRazorpay({ amountDelta: -100 }).__intent = {
      amount: o.amount,
      orderId: o.orderId,
    };
    const calls2 = mockRazorpay({ amountDelta: -100 });
    calls2.__intent = { amount: o.amount, orderId: o.orderId };
    expect((await verify(w, o)).status).toBe(400);
    const calls3 = mockRazorpay({ orderMismatch: true });
    calls3.__intent = { amount: o.amount, orderId: o.orderId };
    expect((await verify(w, o)).status).toBe(400);
    expect(await Payment.countDocuments({ invoice: inv._id })).toBe(0);
    // Not captured yet: pending, nothing recorded.
    const calls4 = mockRazorpay({ status: "authorized" });
    calls4.__intent = { amount: o.amount, orderId: o.orderId };
    const pend = await verify(w, o);
    expect(pend.status).toBe(202);
    expect(await Payment.countDocuments({ invoice: inv._id })).toBe(0);
    // Razorpay unreachable: pending, nothing recorded.
    const calls5 = mockRazorpay({ failLookup: true });
    calls5.__intent = { amount: o.amount, orderId: o.orderId };
    expect((await verify(w, o)).status).toBe(202);
    expect(await Payment.countDocuments({ invoice: inv._id })).toBe(0);
    // Genuine: recorded; replays don't double count.
    const calls6 = mockRazorpay();
    calls6.__intent = { amount: o.amount, orderId: o.orderId };
    const ok = await verify(w, o);
    expect(ok.status).toBe(200);
    expect(ok.body.invoice).toMatchObject({ status: "paid", balance: 0 });
    const replay = await verify(w, o);
    expect(replay.body.duplicate).toBe(true);
    expect(await Payment.countDocuments({ invoice: inv._id })).toBe(1);
    expect(
      (await Payment.findOne({ invoice: inv._id })).razorpayPaymentId,
    ).toBe("pay_ABCDEF123456");
  });

  it("ignores unknown orders and other organizations' orders on verify", async () => {
    const a = await world("r3@x.com"),
      b = await world("r3b@x.com");
    const { o } = await begin(a);
    const res = await b.api("post", "/api/v1/billing/razorpay/verify").send({
      orderId: o.orderId,
      paymentId: "pay_STEAL000001",
      signature: hmac(KEY_SECRET, `${o.orderId}|pay_STEAL000001`),
    });
    expect(res.status).toBe(404);
    expect(
      (
        await a.api("post", "/api/v1/billing/razorpay/verify").send({
          orderId: "order_unknown1",
          paymentId: "pay_X0000000001",
          signature: "a".repeat(64),
        })
      ).status,
    ).toBe(404);
  });

  it("webhook: authenticates the raw body, records once, and survives replays and mismatches", async () => {
    const w = await world("r4@x.com");
    const { inv, o } = await begin(w);
    const evt = captured(o);
    expect((await webhook(evt, "wrong-secret")).status).toBe(400);
    expect((await webhook(evt, WH_SECRET, "f".repeat(64))).status).toBe(400);
    expect(await Payment.countDocuments({ invoice: inv._id })).toBe(0);
    const ok = await webhook(evt);
    expect(ok.status).toBe(200);
    expect((await Invoice.findById(inv._id)).status).toBe("paid");
    const replay = await webhook(evt);
    expect(replay.status).toBe(200);
    expect(await Payment.countDocuments({ invoice: inv._id })).toBe(1); // retries are harmless
    // A different payment id for the same order after it's settled is still recorded as received money, shown as credit.
    expect(
      (await webhook({ event: "payment.failed", payload: {} })).body.ignored,
    ).toBe(true);
    expect(
      (
        await webhook({
          event: "payment.captured",
          payload: {
            payment: {
              entity: {
                id: "pay_UNKNOWNORD01",
                order_id: "order_not_ours",
                amount: 5,
                currency: "INR",
              },
            },
          },
        })
      ).body.ignored,
    ).toBe(true);
    // Amount tampering is ignored and audited.
    const w2 = await world("r4b@x.com");
    const b2 = await begin(w2);
    const t = await webhook(
      captured(b2.o, "pay_TAMPER000001", b2.o.amount - 1),
    );
    expect(t.body.ignored).toBe(true);
    expect(await Payment.countDocuments({ invoice: b2.inv._id })).toBe(0);
    expect(
      await AuditLog.countDocuments({
        organization: w2.org,
        action: "billing.webhook_mismatch",
      }),
    ).toBe(1);
  });

  it("webhook and browser verify racing for one payment record it once", async () => {
    const w = await world("r5@x.com");
    const { inv, o, calls } = await begin(w);
    calls.__intent = { amount: o.amount, orderId: o.orderId };
    const c = mockRazorpay();
    c.__intent = { amount: o.amount, orderId: o.orderId };
    const id = "pay_RACE0000001";
    await Promise.all([
      verify(w, o, id),
      webhook(captured(o, id)),
      verify(w, o, id),
      webhook(captured(o, id)),
    ]);
    expect(await Payment.countDocuments({ invoice: inv._id })).toBe(1);
    expect((await Invoice.findById(inv._id)).balance).toBe(0);
  });

  it("webhook is unusable when no secret is configured", async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const w = await world("r6@x.com");
    const { o } = await begin(w);
    const raw = JSON.stringify(captured(o));
    const res = await request(app)
      .post("/api/v1/billing/razorpay/webhook")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", hmac("", raw))
      .send(raw);
    expect(res.status).toBe(400);
  });
});

describe("fee reports", () => {
  it("appear only with billing enabled and show collections and dues in currency units", async () => {
    const w = await world("fr1@x.com");
    const k = await w.kid("Report");
    const inv = await w.invoice(k, 100000);
    await w.pay(inv, { amount: 40000 });
    const keys = (await w.get("/api/v1/reports")).body.data.map((r) => r.key);
    expect(keys).toEqual(
      expect.arrayContaining(["fee_collection", "fee_outstanding"]),
    );
    const day = new Date().toLocaleDateString("en-CA");
    const col = (
      await w.get(`/api/v1/reports/fee_collection?from=${day}&to=${day}`)
    ).body.data;
    expect(col.rows[0]).toMatchObject({
      amount: 400,
      net: 400,
      method: "cash",
      reconciled: "No",
    });
    expect(col.totals.net).toBe(400);
    const out = (await w.get("/api/v1/reports/fee_outstanding")).body.data;
    expect(out.rows[0]).toMatchObject({ total: 1000, paid: 400, balance: 600 });
    await Organization.updateOne({ _id: w.org }, { "modules.billing": false });
    expect(
      (await w.get("/api/v1/reports")).body.data.map((r) => r.key),
    ).not.toContain("fee_collection");
    expect(
      (await w.get(`/api/v1/reports/fee_collection?from=${day}&to=${day}`))
        .status,
    ).toBe(403);
  });
});
