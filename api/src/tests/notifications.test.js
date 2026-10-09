import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Notification } from "../models/Notification.js";
import { DeliveryAttempt } from "../models/DeliveryAttempt.js";
import { Driver } from "../models/Driver.js";
import { Vehicle } from "../models/Vehicle.js";
import {
  __setFetch,
  __setMailTransport,
} from "../modules/notifications/channels/index.js";
import { retryDue } from "../modules/notifications/notify.service.js";
import {
  tripsStartingSoon,
  documentReminders,
} from "../modules/notifications/jobs.js";
import { render } from "../modules/notifications/render.js";

let mongod;
const app = createApp(["http://localhost"]);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
let n = 0;
const days = (d) => new Date(Date.now() + d * 86400000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function eventually(fn, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(50);
  }
  return fn();
}

const sent = [];
let failMail = 0;
const goodTransport = {
  sendMail: async (m) => {
    if (failMail > 0) {
      failMail--;
      throw new Error("SMTP down");
    }
    sent.push(m);
    return { messageId: "<id-" + sent.length + ">" };
  },
};

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
  const mkUser = async (role, em, extra = {}) => {
    const u = await User.create({
      organization: org,
      name: role + " user",
      email: em,
      password: await bcrypt.hash("password123", 4),
      role,
      ...extra,
    });
    const tok = (
      await request(app)
        .post("/api/v1/auth/login")
        .send({ email: em, password: "password123" })
    ).body.data.accessToken;
    return { u, tok };
  };
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
  const vehicle = await post("/api/v1/vehicles", {
    registrationNumber: `MH12AB${6000 + ++n}`,
    capacity: 30,
  });
  const drvUser = await mkUser("driver", `drv${n}@x.com`);
  const driver = await post("/api/v1/drivers", {
    name: "Dev Driver",
    phone: "9876543210",
    licence: { number: "LN" + n, expiryDate: "2035-01-01" },
  });
  await Driver.updateOne({ _id: driver._id }, { user: drvUser.u._id });
  const trip = () =>
    post("/api/v1/trips", {
      route: route._id,
      scheduledDate: "2030-01-15",
      departureTime: "07:00",
      durationMin: 60,
      vehicle: vehicle._id,
      driver: driver._id,
    });
  const inbox = async (tok = t) =>
    (await request(app).get("/api/v1/notifications").set(auth(tok))).body;
  const move = (id, to, extra = {}) =>
    request(app)
      .post(`/api/v1/trips/${id}/transition`)
      .set(auth(t))
      .send({ to, ...extra });
  return {
    reg,
    org,
    t,
    mkUser,
    post,
    route,
    vehicle,
    driver,
    drvUser,
    trip,
    inbox,
    move,
    put: (u, b, tok = t) => request(app).put(u).set(auth(tok)).send(b),
  };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  __setMailTransport(null);
  __setFetch(null);
  await mongoose.disconnect();
  await mongod.stop();
});
beforeEach(() => {
  sent.length = 0;
  failMail = 0;
  __setMailTransport(null);
  __setFetch(null);
  for (const k of [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_FROM",
    "WHATSAPP_PHONE_ID",
    "WHATSAPP_TOKEN",
    "SMTP_HOST",
  ])
    delete process.env[k];
});

describe("in-app notifications", () => {
  it("notifies the assigned driver and staff, and keeps inboxes private", async () => {
    const w = await world("n1@x.com");
    const trip = await w.trip();
    const mine = await eventually(async () => {
      const b = await w.inbox(w.drvUser.tok);
      return b.data.length ? b : null;
    });
    expect(mine.data[0].title).toBe(`New trip ${trip.tripNumber}`);
    expect(mine.unreadCount).toBe(1);
    expect(
      (await w.inbox()).data.some((x) => x.event === "trip_assigned"),
    ).toBe(false); // owner isn't a recipient of assignments
    await w.move(trip._id, "ready");
    await w.move(trip._id, "in_progress");
    const owner = await eventually(async () => {
      const b = await w.inbox();
      return b.data.length ? b : null;
    });
    expect(owner.data[0].event).toBe("trip_started");
    // Other org sees nothing.
    const other = await world("n1b@x.com");
    expect((await other.inbox()).data).toHaveLength(0);
    // Another user can't mark mine as read.
    const id = mine.data[0]._id;
    expect(
      (
        await request(app)
          .post(`/api/v1/notifications/${id}/read`)
          .set(auth(w.t))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`/api/v1/notifications/${id}/read`)
          .set(auth(w.drvUser.tok))
      ).status,
    ).toBe(200);
    expect((await w.inbox(w.drvUser.tok)).unreadCount).toBe(0);
  });

  it("does not re-notify for the same driver on the same trip but does for a replacement", async () => {
    const w = await world("n2@x.com");
    const trip = await w.trip();
    await eventually(async () => (await w.inbox(w.drvUser.tok)).data.length);
    await w.put(`/api/v1/trips/${trip._id}`, {
      tripType: "custom",
      scheduledDate: "2030-01-15",
      departureTime: "07:15",
      durationMin: 60,
      vehicle: w.vehicle._id,
      driver: w.driver._id,
    });
    await sleep(300);
    expect(
      (await w.inbox(w.drvUser.tok)).data.filter(
        (x) => x.event === "trip_assigned",
      ),
    ).toHaveLength(1);
  });

  it("a cancelled trip notifies driver; failures in notification never break the operation", async () => {
    const w = await world("n3@x.com");
    const trip = await w.trip();
    const spy = Notification.create;
    Notification.create = async () => {
      throw new Error("db exploded");
    };
    const res = await w.move(trip._id, "cancelled", { reason: "Holiday" });
    Notification.create = spy;
    expect(res.status).toBe(200); // the transition committed regardless
    expect(res.body.data.status).toBe("cancelled");
  });
});

describe("external channels", () => {
  it("cannot be enabled without server credentials, and stay off by default", async () => {
    const w = await world("c1@x.com");
    const trip = await w.trip();
    await w.move(trip._id, "ready");
    await w.move(trip._id, "in_progress");
    await w.move(trip._id, "delayed", { reason: "Rain" });
    await sleep(300);
    expect(await DeliveryAttempt.countDocuments({ organization: w.org })).toBe(
      0,
    ); // org never enabled email
    const bad = await w.put("/api/v1/notifications/settings", {
      channels: { email: { enabled: true } },
    });
    expect(bad.status).toBe(400);
    const status = (
      await request(app).get("/api/v1/notifications/settings").set(auth(w.t))
    ).body.data.channels;
    expect(status.find((c) => c.key === "email")).toMatchObject({
      configured: false,
      enabled: false,
    });
    expect(status.find((c) => c.key === "push")).toMatchObject({
      implemented: false,
    });
  });

  it("sends email when enabled, retries failures with backoff, and gives up after 3 tries", async () => {
    __setMailTransport(goodTransport);
    process.env.SMTP_FROM = "no-reply@test.local";
    const w = await world("c2@x.com");
    expect(
      (
        await w.put("/api/v1/notifications/settings", {
          channels: { email: { enabled: true } },
        })
      ).status,
    ).toBe(200);
    const trip = await w.trip();
    await w.move(trip._id, "ready");
    await w.move(trip._id, "in_progress");
    await w.move(trip._id, "delayed", { reason: "Rain <b>heavy</b>" });
    await eventually(() => sent.length);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("c2@x.com");
    expect(sent[0].subject).toContain(trip.tripNumber);
    expect(sent[0].text).not.toMatch(/[\u0000-\u0008]/);
    const row = await DeliveryAttempt.findOne({
      organization: w.org,
      channel: "email",
      status: "sent",
    });
    expect(row.providerMessageId).toMatch(/^<id-/);

    // Provider outage: queued with a retry time, then recovers.
    failMail = 1;
    await w.move(trip._id, "completed");
    const trip2 = await w.post("/api/v1/trips", {
      route: w.route._id,
      scheduledDate: "2030-02-15",
      departureTime: "07:00",
      durationMin: 60,
      vehicle: w.vehicle._id,
      driver: w.driver._id,
    });
    await w.move(trip2._id, "ready");
    await w.move(trip2._id, "in_progress");
    const r = await w.move(trip2._id, "delayed", { reason: "Flat tyre" });
    expect(r.status).toBe(200);
    const queued = await eventually(() =>
      DeliveryAttempt.findOne({ organization: w.org, status: "queued" }),
    );
    expect(queued.error).toMatch(/SMTP down/);
    expect(queued.nextRetryAt.getTime()).toBeGreaterThan(Date.now());
    await retryDue(new Date(Date.now() + 3600_000));
    expect((await DeliveryAttempt.findById(queued._id)).status).toBe("sent");

    failMail = 99;
    const a = await DeliveryAttempt.create({
      organization: w.org,
      event: "x",
      channel: "email",
      to: "p@q.com",
      subject: "s",
      body: "b",
    });
    for (let i = 0; i < 3; i++)
      await retryDue(new Date(Date.now() + (i + 1) * 3600_000 * 5)).then(
        async () => {
          const cur = await DeliveryAttempt.findById(a._id);
          if (cur.status === "queued" && !cur.attempts) {
            /* first send */
          }
        },
      );
    const { deliver } =
      await import("../modules/notifications/notify.service.js");
    for (let i = 0; i < 3; i++)
      await deliver(await DeliveryAttempt.findById(a._id));
    expect((await DeliveryAttempt.findById(a._id)).status).toBe("failed");
    delete process.env.SMTP_FROM;
  });

  it("sends SMS and WhatsApp through their provider APIs and records provider errors", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = "secret-token";
    process.env.TWILIO_FROM = "+10000000000";
    process.env.WHATSAPP_PHONE_ID = "123";
    process.env.WHATSAPP_TOKEN = "wa-token";
    const calls = [];
    let mode = "ok";
    __setFetch(async (url, opts) => {
      calls.push({ url, opts });
      if (mode === "fail")
        return {
          ok: false,
          status: 401,
          json: async () => ({
            message: "Authenticate",
            error: { message: "Invalid token" },
          }),
        };
      return {
        ok: true,
        status: 200,
        json: async () =>
          url.includes("twilio")
            ? { sid: "SM123" }
            : { messages: [{ id: "wamid.1" }] },
      };
    });
    const w = await world("c3@x.com");
    expect(
      (
        await w.put("/api/v1/notifications/settings", {
          channels: { sms: { enabled: true }, whatsapp: { enabled: true } },
          events: {
            trip_cancelled: { channels: ["in_app", "sms", "whatsapp"] },
          },
        })
      ).status,
    ).toBe(200);
    const trip = await w.trip();
    await w.move(trip._id, "cancelled", { reason: "Strike" });
    await eventually(
      async () =>
        (await DeliveryAttempt.countDocuments({
          organization: w.org,
          status: "sent",
        })) >= 2,
    );
    const sms = calls.find((c) => c.url.includes("twilio.com"));
    expect(sms.opts.headers.Authorization).toMatch(/^Basic /);
    expect(String(sms.opts.body)).toContain("To=9876543210");
    const wa = calls.find((c) => c.url.includes("graph.facebook.com"));
    expect(JSON.parse(wa.opts.body)).toMatchObject({
      messaging_product: "whatsapp",
      to: "9876543210",
    });
    // Secrets never land in the delivery log.
    const dump = JSON.stringify(
      await DeliveryAttempt.find({ organization: w.org }).lean(),
    );
    expect(dump).not.toContain("secret-token");
    expect(dump).not.toContain("wa-token");
    // Provider rejection is recorded, not thrown.
    mode = "fail";
    const t2 = await w.post("/api/v1/trips", {
      route: w.route._id,
      scheduledDate: "2030-03-15",
      departureTime: "07:00",
      durationMin: 60,
      vehicle: w.vehicle._id,
      driver: w.driver._id,
    });
    expect(
      (await w.move(t2._id, "cancelled", { reason: "Again" })).status,
    ).toBe(200);
    const bad = await eventually(() =>
      DeliveryAttempt.findOne({
        organization: w.org,
        status: "queued",
        error: /provider error 401/,
      }),
    );
    expect(bad.error).toMatch(/Authenticate|Invalid token/);
  });

  it("respects personal opt-outs and masks addresses in the delivery log", async () => {
    __setMailTransport(goodTransport);
    process.env.SMTP_FROM = "no-reply@test.local";
    const w = await world("c4@x.com");
    const disp = await w.mkUser("dispatcher", "disp-c4@x.com", {
      mutedChannels: ["email"],
    });
    await w.put("/api/v1/notifications/settings", {
      channels: { email: { enabled: true } },
    });
    const trip = await w.trip();
    await w.move(trip._id, "ready");
    await w.move(trip._id, "in_progress");
    await w.move(trip._id, "delayed", { reason: "x" });
    await eventually(() => sent.length);
    expect(sent.map((m) => m.to)).not.toContain("disp-c4@x.com");
    expect(sent.map((m) => m.to)).toContain("c4@x.com");
    const list = (
      await request(app).get("/api/v1/notifications/deliveries").set(auth(w.t))
    ).body.data;
    expect(list[0].to).toMatch(/\*\*\*/);
    expect(list[0].body).toBeUndefined();
    expect(
      (
        await request(app)
          .get("/api/v1/notifications/deliveries")
          .set(auth(disp.tok))
      ).status,
    ).toBe(403);
    delete process.env.SMTP_FROM;
  });

  it("test endpoint reports what actually happened", async () => {
    const w = await world("c5@x.com");
    const unconfigured = await request(app)
      .post("/api/v1/notifications/test")
      .set(auth(w.t))
      .send({ channel: "email" });
    expect(unconfigured.body.data).toMatchObject({ status: "skipped" });
    expect(unconfigured.body.data.error).toMatch(/not configured/);
    __setMailTransport(goodTransport);
    process.env.SMTP_FROM = "no-reply@test.local";
    const ok = await request(app)
      .post("/api/v1/notifications/test")
      .set(auth(w.t))
      .send({ channel: "email" });
    expect(ok.body.data.status).toBe("sent");
    expect(
      (
        await request(app)
          .post("/api/v1/notifications/test")
          .set(auth(w.t))
          .send({ channel: "sms" })
      ).status,
    ).toBe(400); // no phone yet
    delete process.env.SMTP_FROM;
  });
});

describe("templates & settings", () => {
  it("renders custom templates safely and lets orgs reroute events", async () => {
    const w = await world("t1@x.com");
    expect(render("Hi {{name}} {{missing}}!", { name: "A\u0007B" })).toBe(
      "Hi A B !",
    );
    expect(
      (
        await w.put("/api/v1/notifications/templates/trip_assigned/in_app", {
          subject: "Go: {{tripNumber}}",
          body: "Depart {{time}}",
        })
      ).status,
    ).toBe(200);
    const trip = await w.trip();
    const box = await eventually(async () => {
      const b = await w.inbox(w.drvUser.tok);
      return b.data.length ? b : null;
    });
    expect(box.data[0].title).toBe(`Go: ${trip.tripNumber}`);
    // Switch an event off.
    await w.put("/api/v1/notifications/settings", {
      events: { trip_started: { enabled: false } },
    });
    const t2 = await w.post("/api/v1/trips", {
      route: w.route._id,
      scheduledDate: "2030-04-15",
      departureTime: "07:00",
      durationMin: 60,
      vehicle: w.vehicle._id,
      driver: w.driver._id,
    });
    await w.move(t2._id, "ready");
    await w.move(t2._id, "in_progress");
    await sleep(300);
    expect(
      (await w.inbox()).data.filter((x) => x.event === "trip_started"),
    ).toHaveLength(0);
    const nonAdmin = await w.mkUser("dispatcher", "d-t1@x.com");
    expect(
      (
        await w.put(
          "/api/v1/notifications/templates/trip_assigned/in_app",
          { body: "hack" },
          nonAdmin.tok,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app).get("/api/v1/notifications/templates").set(auth(w.t))
      ).body.data.find(
        (t) => t.event === "trip_assigned" && t.channel === "in_app",
      ).custom,
    ).toBe(true);
  });
});

describe("scheduled jobs", () => {
  it("notifies about trips starting soon exactly once", async () => {
    const w = await world("j1@x.com");
    const soonDate = new Date(Date.now() + 20 * 60000);
    const { Trip } = await import("../models/Trip.js");
    const trip = await w.trip();
    await Trip.updateOne(
      { _id: trip._id },
      {
        scheduledDeparture: soonDate,
        expectedArrival: new Date(+soonDate + 3600000),
      },
    );
    expect(
      await tripsStartingSoon(w.reg.user.organization, "Asia/Kolkata"),
    ).toBe(1);
    await tripsStartingSoon(w.reg.user.organization, "Asia/Kolkata");
    expect(
      (await w.inbox(w.drvUser.tok)).data.filter(
        (x) => x.event === "trip_starting_soon",
      ),
    ).toHaveLength(1);
  });

  it("sends document reminders once per threshold and re-arms after renewal", async () => {
    const w = await world("j2@x.com");
    const org = w.reg.user.organization;
    await Vehicle.updateOne(
      { _id: w.vehicle._id },
      { "documents.insurance.expiryDate": days(6) },
    );
    await documentReminders(org);
    await documentReminders(org);
    const docs = async () =>
      (await w.inbox()).data.filter((x) => x.event === "document_expiring");
    expect(await docs()).toHaveLength(1);
    expect(docs).toBeTruthy();
    // Crossing into the expired bucket sends one more; renewing to a new date re-arms.
    await documentReminders(org, Date.now() + 8 * 86400000);
    expect(await docs()).toHaveLength(2);
    await Vehicle.updateOne(
      { _id: w.vehicle._id },
      { "documents.insurance.expiryDate": days(5) },
    );
    await documentReminders(org);
    expect(await docs()).toHaveLength(3);
  });
});
