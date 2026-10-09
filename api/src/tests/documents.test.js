import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import fs from "fs";
import os from "os";
import path from "path";
import { MongoMemoryServer } from "mongodb-memory-server";

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "nt-uploads-"));
process.env.UPLOAD_DIR = uploadDir;
const { createApp } = await import("../app.js");
const { User } = await import("../models/User.js");
const { Document } = await import("../models/Document.js");
const { findReminderDue, expiryStatus } =
  await import("../modules/documents/documents.service.js");

let mongod;
const app = createApp(["http://localhost"]);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
let n = 0;
const PDF = Buffer.concat([
  Buffer.from("%PDF-1.4\n"),
  Buffer.from("x".repeat(200)),
]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("y".repeat(100)),
]);
const days = (d) =>
  new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

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
    registrationNumber: `MH12AB${5000 + ++n}`,
    capacity: 30,
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
  const up = (fields, buf = PDF, name = "rc.pdf", tok = t) => {
    let rq = request(app).post("/api/v1/documents").set(auth(tok));
    for (const [k, v] of Object.entries(fields)) rq = rq.field(k, v);
    return buf ? rq.attach("file", buf, name) : rq;
  };
  return {
    reg,
    t,
    post,
    vehicle,
    as,
    up,
    get: (u, tok = t) => request(app).get(u).set(auth(tok)),
  };
}
const vdoc = (w, extra = {}) => ({
  ownerType: "vehicle",
  owner: w.vehicle._id,
  type: "insurance",
  number: "POL123",
  expiryDate: days(100),
  ...extra,
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

describe("upload validation", () => {
  it("accepts a real PDF, hides storage details, and stores under a random name", async () => {
    const w = await setup("d1@x.com");
    const res = await w.up(vdoc(w), PDF, "../../etc/passwd.pdf");
    expect(res.status).toBe(201);
    expect(res.body.data.file.storageKey).toBeUndefined();
    expect(res.body.data.file.mimeType).toBe("application/pdf");
    expect(res.body.data.file.originalName).not.toContain("/");
    const stored = await Document.findById(res.body.data._id).select(
      "+file.storageKey",
    );
    expect(stored.file.storageKey).toMatch(/^[a-f\d]{24}\/[a-f\d]{32}$/);
    expect(fs.existsSync(path.join(uploadDir, stored.file.storageKey))).toBe(
      true,
    );
  });
  it("rejects files whose content is not an allowed type, whatever their name says", async () => {
    const w = await setup("d2@x.com");
    expect(
      (
        await w.up(
          vdoc(w),
          Buffer.from("MZ\x90\x00 fake exe ................"),
          "invoice.pdf",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await w.up(
          vdoc(w),
          Buffer.from("<script>alert(1)</script> html file contents"),
          "x.png",
        )
      ).status,
    ).toBe(400);
    expect((await w.up(vdoc(w), null)).status).toBe(400); // no file
    expect(await Document.countDocuments({ owner: w.vehicle._id })).toBe(0);
  });
  it("enforces size limit and field validation", async () => {
    const w = await setup("d3@x.com");
    const big = Buffer.concat([
      Buffer.from("%PDF-1.4\n"),
      Buffer.alloc(11 * 1024 * 1024),
    ]);
    expect((await w.up(vdoc(w), big)).status).toBe(413);
    expect((await w.up(vdoc(w, { type: "bogus" }))).status).toBe(400);
    expect(
      (await w.up(vdoc(w, { issueDate: days(10), expiryDate: days(5) })))
        .status,
    ).toBe(400);
    expect(
      (await w.up(vdoc(w, { owner: "0123456789abcdef01234567" }))).status,
    ).toBe(404);
  });
});

describe("secure access", () => {
  it("requires auth, streams with safe headers, and is tenant-isolated", async () => {
    const a = await setup("s1@x.com");
    const b = await setup("s2@x.com");
    const doc = (await a.up(vdoc(a), PNG, "photo.png")).body.data;
    expect(
      (await request(app).get(`/api/v1/documents/${doc._id}/file`)).status,
    ).toBe(401);
    const ok = await a.get(`/api/v1/documents/${doc._id}/file`);
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toContain("image/png");
    expect(ok.headers["x-content-type-options"]).toBe("nosniff");
    expect(ok.headers["cache-control"]).toContain("no-store");
    expect(Buffer.compare(ok.body, PNG)).toBe(0);
    expect((await b.get(`/api/v1/documents/${doc._id}/file`)).status).toBe(404);
    expect((await b.get(`/api/v1/documents/${doc._id}`)).status).toBe(404);
    expect((await b.get("/api/v1/documents")).body.data).toHaveLength(0);
    // Upload into another org's vehicle is refused.
    expect((await b.up(vdoc(a))).status).toBe(404);
    // No static route exposes the upload directory.
    expect((await request(app).get("/uploads/anything")).status).toBe(404);
  });
  it("applies per-owner-type permissions", async () => {
    const w = await setup("s3@x.com");
    const viewer = await w.as("viewer", "view-d@x.com");
    const driverTok = await w.as("driver", "drv-d@x.com");
    const doc = (await w.up(vdoc(w))).body.data;
    expect((await w.up(vdoc(w), PDF, "a.pdf", viewer)).status).toBe(403); // read-only role
    expect(
      (await w.get(`/api/v1/documents/${doc._id}/file`, viewer)).status,
    ).toBe(200);
    expect(
      (await w.get(`/api/v1/documents/${doc._id}/file`, driverTok)).status,
    ).toBe(403); // drivers can't read vehicle documents
    expect(
      (await w.get("/api/v1/documents?ownerType=vehicle", driverTok)).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .delete(`/api/v1/documents/${doc._id}`)
          .set(auth(viewer))
      ).status,
    ).toBe(403);
  });
});

describe("expiry & verification", () => {
  it("classifies expiry and filters by status", async () => {
    const w = await setup("e1@x.com");
    await w.up(vdoc(w, { type: "insurance", expiryDate: days(-3) }));
    await w.up(vdoc(w, { type: "fitness", expiryDate: days(10) }));
    await w.up(vdoc(w, { type: "permit", expiryDate: days(200) }));
    await w.up(vdoc(w, { type: "registration", expiryDate: "" })); // no expiry
    const by = async (s) =>
      (await w.get(`/api/v1/documents?status=${s}`)).body.data.map(
        (d) => d.type,
      );
    expect(await by("expired")).toEqual(["insurance"]);
    expect(await by("expiring_soon")).toEqual(["fitness"]);
    expect((await by("valid")).sort()).toEqual(["permit", "registration"]);
    const sum = (await w.get("/api/v1/documents/summary")).body.data;
    expect(sum).toMatchObject({
      expired: 1,
      expiringSoon: 1,
      valid: 2,
      awaitingVerification: 4,
    });
    const all = (await w.get("/api/v1/documents")).body.data;
    expect(all.find((d) => d.type === "insurance").expiryStatus).toBe(
      "expired",
    );
    expect(all[0].ownerName).toBe(w.vehicle.registrationNumber);
    expect(expiryStatus(null, 30)).toBe("no_expiry");
  });
  it("verifies, and requires re-verification after the document changes", async () => {
    const w = await setup("e2@x.com");
    const doc = (await w.up(vdoc(w))).body.data;
    expect(doc.verification).toBe("pending");
    const v = (id, b, tok = w.t) =>
      request(app)
        .post(`/api/v1/documents/${id}/verify`)
        .set(auth(tok))
        .send(b);
    expect((await v(doc._id, { decision: "rejected" })).status).toBe(400);
    expect(
      (await v(doc._id, { decision: "verified" })).body.data.verification,
    ).toBe("verified");
    const disp = await w.as("dispatcher", "disp-d@x.com");
    expect((await v(doc._id, { decision: "verified" }, disp)).status).toBe(403);
    const upd = await request(app)
      .put(`/api/v1/documents/${doc._id}`)
      .set(auth(w.t))
      .field("expiryDate", days(400));
    expect(upd.body.data.verification).toBe("pending");
    await v(doc._id, { decision: "verified" });
    const notes = await request(app)
      .put(`/api/v1/documents/${doc._id}`)
      .set(auth(w.t))
      .field("notes", "just a note");
    expect(notes.body.data.verification).toBe("verified"); // cosmetic change keeps verification
  });
  it("replacing the file deletes the old one and keeps data consistent", async () => {
    const w = await setup("e3@x.com");
    const doc = (await w.up(vdoc(w))).body.data;
    const before = (await Document.findById(doc._id).select("+file.storageKey"))
      .file.storageKey;
    const rep = await request(app)
      .put(`/api/v1/documents/${doc._id}`)
      .set(auth(w.t))
      .attach("file", PNG, "new.png");
    expect(rep.status).toBe(200);
    expect(rep.body.data.file.mimeType).toBe("image/png");
    expect(fs.existsSync(path.join(uploadDir, before))).toBe(false);
    const bad = await request(app)
      .put(`/api/v1/documents/${doc._id}`)
      .set(auth(w.t))
      .attach("file", Buffer.from("not an allowed file at all"), "x.pdf");
    expect(bad.status).toBe(400);
    expect(
      (await w.get(`/api/v1/documents/${doc._id}/file`)).headers[
        "content-type"
      ],
    ).toContain("image/png");
  });
  it("archives instead of deleting", async () => {
    const w = await setup("e4@x.com");
    const doc = (await w.up(vdoc(w))).body.data;
    expect(
      (await request(app).delete(`/api/v1/documents/${doc._id}`).set(auth(w.t)))
        .status,
    ).toBe(200);
    expect((await w.get(`/api/v1/documents/${doc._id}`)).status).toBe(404);
    const row = await Document.findById(doc._id).select("+file.storageKey");
    expect(fs.existsSync(path.join(uploadDir, row.file.storageKey))).toBe(true);
  });
});

describe("integration with vehicles, drivers and expenses", () => {
  it("syncs vehicle/driver expiry fields so dashboard alerts reflect uploaded documents", async () => {
    const w = await setup("i1@x.com");
    const driver = await w.post("/api/v1/drivers", {
      name: "Dev Driver",
      phone: "9876543210",
      licence: { number: "LI1", expiryDate: days(-10) },
    });
    await w.up(
      vdoc(w, { type: "insurance", expiryDate: days(5), number: "POLICY-9" }),
    );
    await w.up({
      ownerType: "driver",
      owner: driver._id,
      type: "licence",
      expiryDate: days(-2),
      number: "LI1",
    });
    const v = (await w.get(`/api/v1/vehicles/${w.vehicle._id}`)).body.data;
    expect(v.documents.insurance.number).toBe("POLICY-9");
    const dash = (await w.get("/api/v1/dashboard")).body.data;
    expect(dash.expiries.map((e) => e.document).sort()).toEqual([
      "insurance",
      "licence",
    ]);
    // An older document does not overwrite a newer expiry.
    await w.up(
      vdoc(w, { type: "insurance", expiryDate: days(1), number: "OLD" }),
    );
    expect(
      (await w.get(`/api/v1/vehicles/${w.vehicle._id}`)).body.data.documents
        .insurance.number,
    ).toBe("POLICY-9");
  });
  it("attaches receipts to expenses, gated by expense permissions", async () => {
    const w = await setup("i2@x.com");
    const exp = await w.post("/api/v1/expenses", {
      category: "toll",
      amount: 120,
      date: days(-1),
    });
    const r1 = await w.up(
      { ownerType: "expense", owner: exp._id, type: "receipt" },
      PNG,
      "r.png",
    );
    expect(r1.status).toBe(201);
    const disp = await w.as("dispatcher", "disp-i@x.com"); // no expenses permissions
    expect(
      (
        await w.up(
          { ownerType: "expense", owner: exp._id, type: "receipt" },
          PNG,
          "r.png",
          disp,
        )
      ).status,
    ).toBe(403);
    expect(
      (await w.get(`/api/v1/documents?ownerType=expense&owner=${exp._id}`)).body
        .data,
    ).toHaveLength(1);
    expect(
      (await w.get("/api/v1/documents", disp)).body.data.every(
        (d) => d.ownerType !== "expense",
      ),
    ).toBe(true);
  });
});

describe("reminders", () => {
  it("finds documents at configurable thresholds once per bucket", async () => {
    const w = await setup("r1@x.com");
    const mk = (type, d) => w.up(vdoc(w, { type, expiryDate: days(d) }));
    await mk("insurance", 20);
    await mk("fitness", 6);
    await mk("permit", -1);
    await mk("pollution", 90);
    const due = await findReminderDue(
      new mongoose.Types.ObjectId(w.reg.user.organization),
    );
    const by = Object.fromEntries(
      due.map((d) => [d.document.type, d.threshold]),
    );
    expect(by).toEqual({ insurance: 30, fitness: 7, permit: 0 }); // pollution (90 d) not yet due
    const set = await request(app)
      .put("/api/v1/documents/settings/reminders")
      .set(auth(w.t))
      .send({ days: [100, 10] });
    expect(set.body.data.days).toEqual([100, 10]);
    const due2 = await findReminderDue(
      new mongoose.Types.ObjectId(w.reg.user.organization),
    );
    expect(due2.find((d) => d.document.type === "pollution").threshold).toBe(
      100,
    );
    const disp = await w.as("dispatcher", "disp-r@x.com");
    expect(
      (
        await request(app)
          .put("/api/v1/documents/settings/reminders")
          .set(auth(disp))
          .send({ days: [5] })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .put("/api/v1/documents/settings/reminders")
          .set(auth(w.t))
          .send({ days: [] })
      ).status,
    ).toBe(400);
  });
});
