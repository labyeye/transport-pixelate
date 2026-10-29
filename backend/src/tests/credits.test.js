import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { __setBillingFetch } from "../modules/billing/billing.service.js";
import {
  __setFetch,
  __setMailTransport,
} from "../modules/notifications/channels/index.js";
import { notify } from "../modules/notifications/notify.service.js";
import * as credits from "../modules/credits/credits.service.js";
import { activateFromPending } from "../modules/saas/subscription.service.js";
import { Organization } from "../models/Organization.js";
import { Subscription } from "../models/Subscription.js";
import { NotificationSetting } from "../models/NotificationSetting.js";
import { DeliveryAttempt } from "../models/DeliveryAttempt.js";
import { CreditWallet } from "../models/CreditWallet.js";
import { CreditLedger } from "../models/CreditLedger.js";
import { CreditTopup } from "../models/CreditTopup.js";

process.env.RAZORPAY_KEY_ID = "rzp_test_x";
process.env.RAZORPAY_KEY_SECRET = "secret_x";
process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_x";
process.env.TWILIO_ACCOUNT_SID = "AC1";
process.env.TWILIO_AUTH_TOKEN = "tok";
process.env.TWILIO_FROM = "+1555";
process.env.WHATSAPP_PHONE_ID = "ph";
process.env.WHATSAPP_TOKEN = "wt";

let mongod;
const app = createApp(["http://localhost"]);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const sign = (o, p) =>
  crypto.createHmac("sha256", "secret_x").update(`${o}|${p}`).digest("hex");
const oid = () => new mongoose.Types.ObjectId();
let n = 0;
async function signup() {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      organizationName: `Credits Org ${++n}`,
      name: "Owner",
      email: `c${n}@x.com`,
      password: "password123",
    });
  expect(res.status).toBe(201);
  const org = await Organization.findOne({ name: `Credits Org ${n}` });
  return { token: res.body.data.accessToken, org: org._id };
}

// Razorpay stand-in: orders echo the amount; payments are whatever the test registers.
const payments = {};
const orderPayments = {};
__setBillingFetch(async (url, init) => {
  if (url.endsWith("/orders")) {
    const b = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({ id: `order_${++n}_${Date.now()}`, amount: b.amount }),
    };
  }
  if (url.endsWith("/payments")) {
    const id = decodeURIComponent(url.split("/").slice(-2)[0]);
    return { ok: true, json: async () => ({ items: orderPayments[id] ?? [] }) };
  }
  const id = decodeURIComponent(url.split("/").pop());
  return { ok: true, json: async () => payments[id] };
});

// SMS / WhatsApp provider stand-in
const outbox = [];
let providerOk = true;
__setFetch(async (url, init) => {
  if (!providerOk)
    return { ok: false, status: 500, json: async () => ({ message: "down" }) };
  outbox.push({ url, init });
  return {
    ok: true,
    status: 200,
    json: async () => ({ sid: `SM${outbox.length}`, messages: [{ id: `wamid.${outbox.length}` }] }),
  };
});
const mails = [];
__setMailTransport({
  sendMail: async (m) => {
    mails.push(m);
    return { messageId: "<id>" };
  },
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  __setBillingFetch(null);
  __setFetch(null);
  __setMailTransport(null);
  await mongoose.disconnect();
  await mongod.stop();
});

const wallet = async (org, balance) => {
  await credits.enable(org);
  if (balance != null)
    await CreditWallet.updateOne({ organization: org }, { $set: { balance: credits.toUnits(balance) } });
};
const total = async (org) => (await credits.getBalance(org)).total;

describe("wallet", () => {
  it("is free until a wallet exists", async () => {
    expect(await credits.reserve(oid(), { kind: "sms", phone: "919876543210" })).toEqual({ ok: true, free: true });
  });

  it("20 parallel messages on 1 credit: exactly 5 WhatsApp messages are charged, never negative", async () => {
    const org = oid();
    await wallet(org, 1);
    const holds = await Promise.all(
      Array.from({ length: 20 }, () => credits.reserve(org, { kind: "whatsapp", phone: "919876543210" })),
    );
    const ok = holds.filter((h) => h.ok);
    expect(ok.length).toBe(5);
    expect((await CreditWallet.findOne({ organization: org })).balance).toBe(0);
    expect(await CreditLedger.countDocuments({ organization: org, type: "skipped" })).toBe(15);
    expect(await credits.refund(ok[0])).toBe(true);
    expect(await credits.refund(ok[0])).toBe(false); // exactly once
    expect(await total(org)).toBe(0.2);
  });

  it("SMS costs more than WhatsApp; bonus is spent first, expires, and is granted once", async () => {
    const org = oid();
    await wallet(org, 10);
    const h = await credits.reserve(org, { kind: "sms", phone: "919876543210" });
    expect(await total(org)).toBe(9.6);
    await credits.commit(h, "SM1");
    expect(await credits.refundByProviderId("SM1")).toBe(true);
    expect(await credits.refundByProviderId("SM1")).toBe(false);
    expect(await total(org)).toBe(10);

    expect(await credits.grantBonus(org, { credits: 1, refId: "x:1" })).toBe(true);
    expect(await credits.grantBonus(org, { credits: 1, refId: "x:1" })).toBe(false);
    const r = await credits.reserve(org, { kind: "whatsapp", phone: "919876543210" });
    expect((await CreditLedger.findById(r.ledgerId)).bucket).toBe("bonus");
    await CreditWallet.updateOne({ organization: org }, { $set: { bonusExpiresAt: new Date(Date.now() - 1000) } });
    expect((await credits.getBalance(org)).bonus).toBe(0);
  });

  it("daily cap stops a runaway loop; low-balance email goes out once", async () => {
    const org = oid();
    await wallet(org, 100);
    await CreditWallet.updateOne({ organization: org }, { $set: { dailyCap: 3 } });
    const capped = await Promise.all(
      Array.from({ length: 6 }, () => credits.reserve(org, { kind: "whatsapp", phone: "919876543210" })),
    );
    expect(capped.filter((x) => x.ok).length).toBe(3);
    expect(capped.find((x) => !x.ok).reason).toBe("daily_cap");

    const { org: o2 } = await signup();
    mails.length = 0;
    await wallet(o2, 50.2);
    await credits.reserve(o2, { kind: "whatsapp", phone: "919876543210" }); // exactly 50: not low yet
    await new Promise((r) => setTimeout(r, 150));
    expect(mails.length).toBe(0);
    await credits.reserve(o2, { kind: "whatsapp", phone: "919876543210" });
    await credits.reserve(o2, { kind: "whatsapp", phone: "919876543210" });
    await new Promise((r) => setTimeout(r, 300));
    expect(mails.length).toBe(1);
  });
});

describe("top-up", () => {
  it("credits once whichever of verify / webhook / sync arrives first, and only for the right amount", async () => {
    const { token, org } = await signup();
    await wallet(org);
    const o = await request(app).post("/api/v1/credits/topup").set(auth(token)).send({ packId: "p1000" });
    expect(o.status).toBe(201);
    expect(o.body.data.amount).toBe(1180); // Rs 1000 + 18% GST
    const oidr = o.body.data.orderId;
    payments.pay_a = { order_id: oidr, amount: 118000, status: "captured" };

    const bad = await request(app).post("/api/v1/credits/topup/verify").set(auth(token))
      .send({ razorpay_order_id: oidr, razorpay_payment_id: "pay_a", razorpay_signature: "x".repeat(64) });
    expect(bad.status).toBe(400);
    expect(await total(org)).toBe(0);

    const verify = () => request(app).post("/api/v1/credits/topup/verify").set(auth(token))
      .send({ razorpay_order_id: oidr, razorpay_payment_id: "pay_a", razorpay_signature: sign(oidr, "pay_a") });
    const [a, b] = await Promise.all([verify(), verify()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await total(org)).toBe(1000); // not 2000
    expect((await CreditTopup.findOne({ orderId: oidr })).invoiceNumber).toMatch(/^CR-TRN-\d{4}$/);

    // the same payment arriving by webhook afterwards changes nothing
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_a", order_id: oidr, amount: 118000 } } } });
    const sig = crypto.createHmac("sha256", "whsec_x").update(body).digest("hex");
    const wh = await request(app).post("/api/v1/billing/razorpay/webhook").set("x-razorpay-signature", sig).set("content-type", "application/json").send(body);
    expect(wh.status).toBe(200);
    expect(await total(org)).toBe(1000);
  });

  it("webhook alone credits a top-up whose tab closed; a wrong amount does not", async () => {
    const { token, org } = await signup();
    await wallet(org);
    const mk = async () => (await request(app).post("/api/v1/credits/topup").set(auth(token)).send({ packId: "p500" })).body.data.orderId;
    const hook = (id, pay, amount) => {
      const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: pay, order_id: id, amount } } } });
      return request(app).post("/api/v1/billing/razorpay/webhook")
        .set("x-razorpay-signature", crypto.createHmac("sha256", "whsec_x").update(body).digest("hex"))
        .set("content-type", "application/json").send(body);
    };
    const o1 = await mk();
    await hook(o1, "pay_w1", 100); // Rs 1 for a Rs 590 order
    expect(await total(org)).toBe(0);
    await hook(o1, "pay_w2", 59000);
    expect(await total(org)).toBe(500);
  });

  it("without any webhook, asking Razorpay finds the paid order", async () => {
    const { token, org } = await signup();
    await wallet(org);
    const id = (await request(app).post("/api/v1/credits/topup").set(auth(token)).send({ packId: "p500" })).body.data.orderId;
    expect((await request(app).get("/api/v1/credits/balance").set(auth(token))).body.data.total).toBe(0);
    orderPayments[id] = [{ id: "pay_s", status: "captured", amount: 59000 }];
    expect((await request(app).get("/api/v1/credits/balance").set(auth(token))).body.data.total).toBe(500);
    expect((await request(app).get("/api/v1/credits/balance").set(auth(token))).body.data.total).toBe(500); // once
  });

  it("an organization without credits cannot top up; other roles cannot see the wallet", async () => {
    const { token } = await signup();
    expect((await request(app).post("/api/v1/credits/topup").set(auth(token)).send({ packId: "p500" })).status).toBe(400);
    expect((await request(app).get("/api/v1/credits/balance")).status).toBe(401);
  });
});

describe("plan payment bonus", () => {
  it("a paid plan earns 10% of the amount as bonus credits, once", async () => {
    const { org } = await signup();
    await wallet(org);
    const sub = await Subscription.findOne({ organization: org });
    sub.pending = { orderId: "order_p", tier: "pro", vehicles: 5, billingCycle: "monthly", amount: 1_000_000, subtotal: 847458, gstAmount: 152542, rate: 20000 };
    await sub.save();
    await activateFromPending(sub, "pay_plan");
    await new Promise((r) => setTimeout(r, 200));
    expect((await credits.getBalance(org)).bonus).toBe(1000); // Rs 10,000 paid -> 10% = 1000
  });
});

describe("messages through notify()", () => {
  async function setup(channelEvents) {
    const { org } = await signup();
    await NotificationSetting.create({
      organization: org,
      channels: { email: { enabled: true }, sms: { enabled: true }, whatsapp: { enabled: true } },
      events: { trip_assigned: { enabled: true, channels: channelEvents, roles: [] } },
    });
    return org;
  }
  const raise = (org) =>
    notify("trip_assigned", {
      org,
      vars: { tripNumber: "T1", route: "R", date: "d", time: "t" },
      extra: [{ name: "Dev", phone: "9876543210" }],
    });

  it("charges an SMS to a metered organization and sends it", async () => {
    const org = await setup(["sms"]);
    await wallet(org, 5);
    outbox.length = 0;
    await raise(org);
    expect(outbox.length).toBe(1);
    expect(await total(org)).toBe(4.6);
  });

  it("sends nothing and says why when there are no credits", async () => {
    const org = await setup(["sms"]);
    await wallet(org, 0);
    outbox.length = 0;
    await raise(org);
    expect(outbox.length).toBe(0);
    const a = await DeliveryAttempt.findOne({ organization: org });
    expect(a.status).toBe("skipped");
    expect(a.error).toBe("Not enough credits");
    expect((await CreditLedger.findOne({ organization: org, type: "skipped" })).note).toBe("low_balance");
  });

  it("gives the credit back when the provider fails", async () => {
    const org = await setup(["sms"]);
    await wallet(org, 5);
    providerOk = false;
    await raise(org);
    providerOk = true;
    expect(await total(org)).toBe(5);
    expect((await DeliveryAttempt.findOne({ organization: org })).status).toBe("queued"); // will retry, and be charged then
  });

  it("an unmetered organization is never charged, and email is always free", async () => {
    const org = await setup(["sms"]);
    outbox.length = 0;
    await raise(org);
    expect(outbox.length).toBe(1);
    expect(await CreditLedger.countDocuments({ organization: org })).toBe(0);

    const org2 = await setup(["email"]);
    await wallet(org2, 5);
    mails.length = 0;
    await notify("trip_assigned", { org: org2, vars: {}, extra: [{ name: "Dev", email: "d@x.com" }] });
    expect(mails.length).toBe(1);
    expect(await total(org2)).toBe(5);
  });

  it("a metered organization on the basic plan can use WhatsApp; an unmetered one cannot", async () => {
    const org = await setup(["whatsapp"]);
    await Subscription.updateOne({ organization: org }, { tier: "basic" });
    outbox.length = 0;
    await raise(org);
    expect(outbox.length).toBe(0); // plan has no WhatsApp and no credits
    await wallet(org, 5);
    await raise(org);
    expect(outbox.length).toBe(1);
    expect(await total(org)).toBe(4.8);
  });
});
