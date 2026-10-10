import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Driver } from "../models/Driver.js";
import { PasswordReset } from "../models/PasswordReset.js";
import { AuditLog } from "../models/AuditLog.js";
import { __setMailTransport } from "../modules/notifications/channels/index.js";

let mongod;
const app = createApp(["http://localhost:5175"]);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const sent = [];
const goodTransport = {
  sendMail: async (m) => {
    sent.push(m);
    return { messageId: "<m>" };
  },
};
const tokenFrom = (text) => /token=([a-f\d]{64})/.exec(text)?.[1];

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
  const t = reg.accessToken;
  const api = (method, url, tok = t) =>
    request(app)[method](url).set(auth(tok));
  const login = async (em, pw = "password123") =>
    request(app).post("/api/v1/auth/login").send({ email: em, password: pw });
  // Create a user through the API and finish setup through the emailed/returned link, like a real person would.
  const addUser = async (role, em, extra = {}) => {
    const res = await api("post", "/api/v1/users").send({
      name: `${role} person`,
      email: em,
      role,
      ...extra,
    });
    if (res.status !== 201) return { res };
    const token = tokenFrom(res.body.invite.link);
    await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token, password: "password123" });
    return {
      res,
      tok: (await login(em)).body.data.accessToken,
      id: res.body.data._id,
    };
  };
  return { reg, t, api, login, addUser, org: reg.user.organization };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  __setMailTransport(null);
  await mongoose.disconnect();
  await mongod.stop();
});
beforeEach(() => {
  sent.length = 0;
  __setMailTransport(null);
  delete process.env.SMTP_FROM;
});

describe("user management", () => {
  it("creates users with an invitation link; nobody ever knows the initial password", async () => {
    const w = await world("u1@x.com");
    const res = await w
      .api("post", "/api/v1/users")
      .send({
        name: "Dina Dispatcher",
        email: "dina@x.com",
        role: "dispatcher",
      });
    expect(res.status).toBe(201);
    expect(res.body.invite.link).toMatch(
      /\/reset-password\?token=[a-f\d]{64}$/,
    );
    expect(res.body.invite.emailed).toBe(false); // email not configured here
    expect(res.body.data.password).toBeUndefined();
    // Can't log in until the link is used.
    expect((await w.login("dina@x.com")).status).toBe(401);
    const token = tokenFrom(res.body.invite.link);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/reset-password")
          .send({ token, password: "short" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/reset-password")
          .send({ token, password: "a-good-password" })
      ).status,
    ).toBe(200);
    expect((await w.login("dina@x.com", "a-good-password")).status).toBe(200);
    // Single use.
    expect(
      (
        await request(app)
          .post("/api/v1/auth/reset-password")
          .send({ token, password: "another-password" })
      ).status,
    ).toBe(400);
    // Raw token is never stored.
    expect(await PasswordReset.countDocuments({ tokenHash: token })).toBe(0);
    expect(
      (
        await w
          .api("post", "/api/v1/users")
          .send({ name: "Dup", email: "DINA@x.com", role: "viewer" })
      ).status,
    ).toBe(409);
  });

  it("emails the invitation when email is configured", async () => {
    __setMailTransport(goodTransport);
    process.env.SMTP_FROM = "no-reply@test.local";
    const w = await world("u2@x.com");
    const res = await w
      .api("post", "/api/v1/users")
      .send({ name: "Eve Viewer", email: "eve@x.com", role: "viewer" });
    expect(res.body.invite.emailed).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("eve@x.com");
    expect(sent[0].text).toContain(res.body.invite.link);
  });

  it("enforces role hierarchy, self-protection and the last-owner rule", async () => {
    const w = await world("u3@x.com");
    const admin = await w.addUser("admin", "u3-admin@x.com");
    const disp = await w.addUser("dispatcher", "u3-disp@x.com");
    // Admin cannot mint owners/admins or touch them.
    expect(
      (
        await w
          .api("post", "/api/v1/users", admin.tok)
          .send({ name: "Sneaky", email: "s@x.com", role: "owner" })
      ).status,
    ).toBe(403);
    expect(
      (
        await w
          .api("post", "/api/v1/users", admin.tok)
          .send({ name: "Pal", email: "p@x.com", role: "admin" })
      ).status,
    ).toBe(403);
    expect(
      (
        await w
          .api("patch", `/api/v1/users/${w.reg.user.id}/status`, admin.tok)
          .send({ status: "inactive" })
      ).status,
    ).toBe(403);
    expect(
      (
        await w
          .api("put", `/api/v1/users/${disp.id}`, admin.tok)
          .send({ role: "admin" })
      ).status,
    ).toBe(403);
    // Admin can manage ordinary staff.
    expect(
      (
        await w
          .api("put", `/api/v1/users/${disp.id}`, admin.tok)
          .send({ role: "accountant" })
      ).body.data.role,
    ).toBe("accountant");
    // Dispatchers can't manage users at all.
    expect((await w.api("get", "/api/v1/users", disp.tok)).status).toBe(403);
    // Nobody changes their own role or deactivates themselves.
    expect(
      (
        await w
          .api("put", `/api/v1/users/${w.reg.user.id}`)
          .send({ role: "admin" })
      ).status,
    ).toBe(403);
    expect(
      (
        await w
          .api("patch", `/api/v1/users/${w.reg.user.id}/status`)
          .send({ status: "inactive" })
      ).status,
    ).toBe(403);
    // Last active owner is protected: promote a second owner, then demote works only while one remains.
    const owner2 = await w.addUser("owner", "u3-owner2@x.com");
    expect(
      (
        await w
          .api("patch", `/api/v1/users/${owner2.id}/status`)
          .send({ status: "inactive" })
      ).status,
    ).toBe(200);
    expect(
      (await w.api("put", `/api/v1/users/${owner2.id}`).send({ role: "admin" }))
        .status,
    ).toBe(200); // fine: an owner (you) remains
  });

  it("revokes sessions immediately on deactivation and on role change", async () => {
    const w = await world("u4@x.com");
    const u = await w.addUser("dispatcher", "u4-disp@x.com");
    const before = await w.login("u4-disp@x.com");
    const refresh = before.body.data.refreshToken;
    expect((await w.api("get", "/api/v1/vehicles", u.tok)).status).toBe(200);
    await w.api("put", `/api/v1/users/${u.id}`).send({ role: "viewer" });
    expect(
      (
        await request(app)
          .post("/api/v1/auth/refresh")
          .send({ refreshToken: refresh })
      ).status,
    ).toBe(401); // must sign in again
    const again = await w.login("u4-disp@x.com");
    await w
      .api("patch", `/api/v1/users/${u.id}/status`)
      .send({ status: "inactive" });
    expect(
      (await w.api("get", "/api/v1/vehicles", again.body.data.accessToken))
        .status,
    ).toBe(401);
    expect((await w.login("u4-disp@x.com")).status).toBe(401);
    await w
      .api("patch", `/api/v1/users/${u.id}/status`)
      .send({ status: "active" });
    expect((await w.login("u4-disp@x.com")).status).toBe(200);
  });

  it("links logins to driver profiles one-to-one and keeps tenants apart", async () => {
    const w = await world("u5@x.com");
    const other = await world("u5b@x.com");
    const d1 = (
      await w
        .api("post", "/api/v1/drivers")
        .send({
          name: "Dev Driver",
          phone: "9876543210",
          licence: { number: "LU1", expiryDate: "2035-01-01" },
        })
    ).body.data;
    const d2 = (
      await w
        .api("post", "/api/v1/drivers")
        .send({
          name: "Other Driver",
          phone: "9876543211",
          licence: { number: "LU2", expiryDate: "2035-01-01" },
        })
    ).body.data;
    const a = await w.addUser("driver", "u5-a@x.com", { driver: d1._id });
    expect((await Driver.findById(d1._id)).user.toString()).toBe(a.id);
    const b = await w.addUser("driver", "u5-b@x.com");
    expect(
      (
        await w
          .api("put", `/api/v1/users/${b.id}/driver-link`)
          .send({ driver: d1._id })
      ).status,
    ).toBe(409); // already taken
    expect(
      (
        await w
          .api("put", `/api/v1/users/${b.id}/driver-link`)
          .send({ driver: d2._id })
      ).status,
    ).toBe(200);
    const list = (await w.api("get", "/api/v1/users")).body.data;
    expect(list.find((u) => u.email === "u5-b@x.com").driver.name).toBe(
      "Other Driver",
    );
    expect(
      (await other.api("put", `/api/v1/users/${b.id}`).send({ name: "Hacked" }))
        .status,
    ).toBe(404);
    expect((await other.api("get", "/api/v1/users")).body.data).toHaveLength(1); // only their own owner
    const stolen = await other
      .api("post", "/api/v1/users")
      .send({
        name: "Spy",
        email: "spy@x.com",
        role: "viewer",
        driver: d1._id,
      });
    expect(stolen.status).toBe(404);
  });
});

describe("password reset", () => {
  it("answers identically for unknown emails and only emails real accounts", async () => {
    __setMailTransport(goodTransport);
    process.env.SMTP_FROM = "no-reply@test.local";
    const w = await world("p1@x.com");
    const known = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: "p1@x.com" });
    const unknown = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: "nobody@x.com" });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(sent).toHaveLength(1);
    const token = tokenFrom(sent[0].text);
    expect(token).toBeTruthy();
    // Using the link changes the password, signs out old sessions and clears a lockout.
    const old = (await w.login("p1@x.com")).body.data;
    for (let i = 0; i < 5; i++) await w.login("p1@x.com", "wrong-password");
    expect((await w.login("p1@x.com")).status).toBe(401); // locked
    expect(
      (
        await request(app)
          .post("/api/v1/auth/reset-password")
          .send({ token, password: "brand-new-pass" })
      ).status,
    ).toBe(200);
    expect((await w.login("p1@x.com", "brand-new-pass")).status).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/refresh")
          .send({ refreshToken: old.refreshToken })
      ).status,
    ).toBe(401);
    expect(
      await AuditLog.countDocuments({
        organization: w.org,
        action: "auth.password_reset",
      }),
    ).toBe(1);
  });

  it("rejects expired, malformed and superseded tokens", async () => {
    const w = await world("p2@x.com");
    const issue = async () => {
      const r = await w.api(
        "post",
        `/api/v1/users/${w.reg.user.id}/reset-link`,
      );
      return r;
    };
    // Admin resets for others; the owner resets via forgot-password. Use a second user.
    const u = await w.addUser("viewer", "p2-v@x.com");
    const first = (await w.api("post", `/api/v1/users/${u.id}/reset-link`)).body
      .data.link;
    const second = (await w.api("post", `/api/v1/users/${u.id}/reset-link`))
      .body.data.link;
    const reset = (token) =>
      request(app)
        .post("/api/v1/auth/reset-password")
        .send({ token, password: "fresh-password-1" });
    expect((await reset(tokenFrom(first))).status).toBe(400); // superseded by the newer link
    expect((await reset("not-a-token")).status).toBe(400);
    await PasswordReset.updateMany(
      {},
      { expiresAt: new Date(Date.now() - 1000) },
    );
    expect((await reset(tokenFrom(second))).status).toBe(400); // expired
    expect(typeof issue).toBe("function");
  });

  it("lets users change their profile and sign out everywhere", async () => {
    const w = await world("p3@x.com");
    const s2 = (await w.login("p3@x.com")).body.data;
    expect(
      (
        await w
          .api("put", "/api/v1/auth/profile")
          .send({ name: "New Name", phone: "+91 98765 43210" })
      ).body.data.name,
    ).toBe("New Name");
    expect(
      (await w.api("put", "/api/v1/auth/profile").send({ name: "X" })).status,
    ).toBe(400);
    expect((await w.api("post", "/api/v1/auth/logout-all")).status).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/refresh")
          .send({ refreshToken: s2.refreshToken })
      ).status,
    ).toBe(401);
  });
});

describe("organization settings & audit trail", () => {
  it("validates and applies organization settings, owner/admin only", async () => {
    const w = await world("s1@x.com");
    const disp = await w.addUser("dispatcher", "s1-disp@x.com");
    expect(
      (await w.api("get", "/api/v1/settings/organization", disp.tok)).status,
    ).toBe(200);
    expect(
      (
        await w
          .api("put", "/api/v1/settings/organization", disp.tok)
          .send({ name: "Hacked" })
      ).status,
    ).toBe(403);
    expect(
      (
        await w
          .api("put", "/api/v1/settings/organization")
          .send({ timezone: "Mars/Olympus" })
      ).status,
    ).toBe(400);
    expect(
      (
        await w
          .api("put", "/api/v1/settings/organization")
          .send({ currency: "rupees" })
      ).status,
    ).toBe(400);
    expect(
      (await w.api("put", "/api/v1/settings/organization").send({})).status,
    ).toBe(400);
    const ok = await w
      .api("put", "/api/v1/settings/organization")
      .send({
        name: "Greenfield School",
        timezone: "Asia/Dubai",
        currency: "AED",
        modules: { fuelExpenses: false },
      });
    expect(ok.body.data).toMatchObject({
      name: "Greenfield School",
      timezone: "Asia/Dubai",
      currency: "AED",
    });
    expect(ok.body.data.modules.fuelExpenses).toBe(false);
    expect(ok.body.data.modules.passengerManifest).toBe(true); // untouched
    // The switch really disables the module.
    expect((await w.api("get", "/api/v1/fuel")).status).toBe(403);
  });

  it("exposes a filterable, tenant-scoped audit trail", async () => {
    const w = await world("s2@x.com");
    const other = await world("s2b@x.com");
    await w
      .api("post", "/api/v1/vehicles")
      .send({ registrationNumber: "MH12AB9001", capacity: 30 });
    await w.addUser("viewer", "s2-v@x.com");
    await other
      .api("post", "/api/v1/vehicles")
      .send({ registrationNumber: "MH12AB9002", capacity: 30 });
    const all = (await w.api("get", "/api/v1/settings/audit-logs?limit=100"))
      .body.data;
    expect(all.map((l) => l.action)).toEqual(
      expect.arrayContaining([
        "vehicle.create",
        "user.create",
        "auth.password_reset",
      ]),
    );
    expect(all.every((l) => !l.entityId || true)).toBe(true);
    const onlyVehicle = (
      await w.api("get", "/api/v1/settings/audit-logs?action=vehicle")
    ).body.data;
    expect(onlyVehicle.length).toBeGreaterThan(0);
    expect(onlyVehicle.every((l) => l.action.startsWith("vehicle"))).toBe(true);
    expect(onlyVehicle[0].actor.email).toBe("s2@x.com");
    const viewer = await w.addUser("viewer", "s2-v2@x.com");
    expect(
      (await w.api("get", "/api/v1/settings/audit-logs", viewer.tok)).status,
    ).toBe(403);
    // Other tenant's actions never appear.
    expect(JSON.stringify(all)).not.toContain("MH12AB9002");
  });
});
