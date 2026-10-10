import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Driver } from "../models/Driver.js";
import { Trip } from "../models/Trip.js";
import { Route } from "../models/Route.js";
import { PassengerAssignment } from "../models/PassengerAssignment.js";

let mongod;
const app = createApp(["http://localhost"]);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
let n = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PDF = Buffer.concat([
  Buffer.from("%PDF-1.4\n"),
  Buffer.from("x".repeat(100)),
]);
const dayStr = (d) =>
  new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

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
  const mkUser = async (role, em) => {
    await User.create({
      organization: org,
      name: `${role} ${++n}`,
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
  const post = async (url, body, tok = t) =>
    (await request(app).post(url).set(auth(tok)).send(body)).body.data;
  const route = await post("/api/v1/routes", {
    name: "Route One",
    code: "R1",
    stops: [
      { name: "A", lat: 1, lng: 1 },
      { name: "B", lat: 2, lng: 2 },
      { name: "C", lat: 3, lng: 3 },
    ],
  });
  const mkVehicle = () =>
    post("/api/v1/vehicles", {
      registrationNumber: `MH12AB${7000 + ++n}`,
      capacity: 30,
    });
  const mkDriver = () =>
    post("/api/v1/drivers", {
      name: "Dev Driver " + ++n,
      phone: "9876543210",
      licence: { number: "LR" + n, expiryDate: "2035-01-01" },
    });
  const mkTrip = (body = {}) =>
    post("/api/v1/trips", {
      route: route._id,
      scheduledDate: dayStr(10),
      departureTime: "07:00",
      durationMin: 60,
      ...body,
    });
  const file = (tok, type, payload, extra = {}) =>
    request(app)
      .post("/api/v1/requests")
      .set(auth(tok))
      .send({
        type,
        description: "Please action this request",
        payload,
        ...extra,
      });
  const rq = (method, url, tok, body) =>
    request(app)[method](`/api/v1/requests${url}`).set(auth(tok)).send(body);
  const approve = async (id, tok = t, note) => {
    await rq("post", `/${id}/start-review`, tok);
    return rq("post", `/${id}/review`, tok, { decision: "approved", note });
  };
  return {
    reg,
    org,
    t,
    mkUser,
    post,
    route,
    mkVehicle,
    mkDriver,
    mkTrip,
    file,
    rq,
    approve,
    get: (u, tok = t) => request(app).get(u).set(auth(tok)),
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

describe("filing & visibility", () => {
  it("validates payloads, rejects dangling references, numbers requests and alerts reviewers", async () => {
    const w = await world("rq1@x.com");
    const drv = await w.mkUser("driver", "rq1-drv@x.com");
    expect(
      (
        await w.file(drv, "trip_cancellation", {
          trip: "0123456789abcdef01234567",
          reason: "Holiday closure",
        })
      ).status,
    ).toBe(400); // trip doesn't exist
    expect(
      (await w.file(drv, "trip_cancellation", { reason: "x" })).status,
    ).toBe(400); // bad payload
    expect((await w.file(drv, "bogus_type", {})).status).toBe(400);
    const trip = await w.mkTrip();
    const ok = await w.file(drv, "trip_cancellation", {
      trip: trip._id,
      reason: "Holiday closure",
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.number).toBe("REQ-00001");
    expect(ok.body.data.status).toBe("submitted");
    for (let i = 0; i < 40; i++) {
      const box = (await w.get("/api/v1/notifications")).body.data;
      if (box.some((x) => x.event === "request_submitted")) break;
      await sleep(50);
    }
    expect(
      (await w.get("/api/v1/notifications")).body.data.some(
        (x) => x.event === "request_submitted",
      ),
    ).toBe(true);
  });

  it("lets requesters see only their own requests; reviewers see all; tenants are isolated", async () => {
    const w = await world("rq2@x.com");
    const d1 = await w.mkUser("driver", "rq2-d1@x.com");
    const d2 = await w.mkUser("driver", "rq2-d2@x.com");
    const trip = await w.mkTrip();
    const r1 = (
      await w.file(d1, "trip_cancellation", {
        trip: trip._id,
        reason: "Reason one",
      })
    ).body.data;
    await w.file(d2, "trip_cancellation", {
      trip: trip._id,
      reason: "Reason two",
    });
    expect((await w.get("/api/v1/requests", d1)).body.data).toHaveLength(1);
    expect((await w.get("/api/v1/requests", w.t)).body.data).toHaveLength(2);
    expect((await w.get(`/api/v1/requests/${r1._id}`, d2)).status).toBe(404);
    expect((await w.get(`/api/v1/requests/${r1._id}/preview`, d1)).status).toBe(
      403,
    ); // requesters can't preview/review
    const other = await world("rq2b@x.com");
    expect((await other.get(`/api/v1/requests/${r1._id}`)).status).toBe(404);
    expect((await other.get("/api/v1/requests")).body.data).toHaveLength(0);
  });
});

describe("review workflow", () => {
  it("enforces order, separation of duties and rejection reasons", async () => {
    const w = await world("rw1@x.com");
    const disp = await w.mkUser("dispatcher", "rw1-disp@x.com");
    const trip = await w.mkTrip();
    const r = (
      await w.file(disp, "trip_cancellation", {
        trip: trip._id,
        reason: "Holiday closure",
      })
    ).body.data;
    expect(
      (await w.rq("post", `/${r._id}/review`, w.t, { decision: "approved" }))
        .status,
    ).toBe(409); // must start review first
    expect((await w.rq("post", `/${r._id}/start-review`, disp)).status).toBe(
      403,
    ); // own request
    expect((await w.rq("post", `/${r._id}/start-review`, w.t)).status).toBe(
      200,
    );
    expect(
      (await w.rq("post", `/${r._id}/review`, disp, { decision: "approved" }))
        .status,
    ).toBe(403); // own request
    expect(
      (await w.rq("post", `/${r._id}/review`, w.t, { decision: "rejected" }))
        .status,
    ).toBe(400); // reason required
    const rej = await w.rq("post", `/${r._id}/review`, w.t, {
      decision: "rejected",
      note: "Needed that day",
    });
    expect(rej.body.data.status).toBe("rejected");
    expect(
      (await w.rq("post", `/${r._id}/review`, w.t, { decision: "approved" }))
        .status,
    ).toBe(409); // terminal
    expect(
      (await w.get(`/api/v1/trips/${trip._id}`)).body.data.status,
    ).not.toBe("cancelled"); // rejection changed nothing
    for (let i = 0; i < 40; i++) {
      const box = (await w.get("/api/v1/notifications", disp)).body.data;
      if (box.some((x) => x.event === "request_rejected")) break;
      await sleep(50);
    }
    expect(
      (await w.get("/api/v1/notifications", disp)).body.data.some(
        (x) => x.event === "request_rejected",
      ),
    ).toBe(true);
  });

  it("lets only the requester or a reviewer cancel, and only while open", async () => {
    const w = await world("rw2@x.com");
    const d1 = await w.mkUser("driver", "rw2-d1@x.com");
    const d2 = await w.mkUser("driver", "rw2-d2@x.com");
    const trip = await w.mkTrip();
    const r = (
      await w.file(d1, "trip_cancellation", {
        trip: trip._id,
        reason: "Reason one",
      })
    ).body.data;
    expect((await w.rq("post", `/${r._id}/cancel`, d2)).status).toBe(404); // can't even see it
    expect((await w.rq("post", `/${r._id}/cancel`, d1)).body.data.status).toBe(
      "cancelled",
    );
    expect((await w.rq("post", `/${r._id}/cancel`, d1)).status).toBe(409);
  });
});

describe("approval applies validated changes", () => {
  it("cancels a trip, resolves the request, and records what changed", async () => {
    const w = await world("ap1@x.com");
    const d = await w.mkUser("driver", "ap1-d@x.com");
    const trip = await w.mkTrip();
    const r = (
      await w.file(d, "trip_cancellation", {
        trip: trip._id,
        reason: "School closed",
      })
    ).body.data;
    const pre = (await w.rq("get", `/${r._id}/preview`, w.t)).body.data;
    expect(pre.canApply).toBe(true);
    const res = await w.approve(r._id, w.t, "OK");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("resolved");
    expect(res.body.data.appliedChange).toContain(trip.tripNumber);
    const t2 = (await w.get(`/api/v1/trips/${trip._id}`)).body.data;
    expect(t2.status).toBe("cancelled");
    expect(t2.cancellationReason).toBe("School closed");
    expect(res.body.data.history.map((h) => h.to)).toEqual([
      "submitted",
      "under_review",
      "approved",
      "resolved",
    ]);
  });

  it("refuses to apply when the trip has since started; nothing changes and the reason is recorded", async () => {
    const w = await world("ap2@x.com");
    const v = await w.mkVehicle(),
      dr = await w.mkDriver();
    const d = await w.mkUser("driver", "ap2-d@x.com");
    const trip = await w.mkTrip({ vehicle: v._id, driver: dr._id });
    const r = (
      await w.file(d, "trip_cancellation", {
        trip: trip._id,
        reason: "School closed",
      })
    ).body.data;
    await Trip.updateOne({ _id: trip._id }, { status: "in_progress" }); // dispatcher started it meanwhile
    await w.rq("post", `/${r._id}/start-review`, w.t);
    const res = await w.rq("post", `/${r._id}/review`, w.t, {
      decision: "approved",
    });
    expect(res.status).toBe(409);
    expect(res.body.errors[0]).toMatch(/in progress/);
    expect((await Trip.findById(trip._id)).status).toBe("in_progress");
    const after = (await w.rq("get", `/${r._id}`, w.t)).body.data;
    expect(after.status).toBe("under_review"); // still reviewable
    expect(after.applyError).toMatch(/in progress/);
  });

  it("re-validates at approval time: a replacement that became conflicting is blocked", async () => {
    const w = await world("ap3@x.com");
    const v1 = await w.mkVehicle(),
      v2 = await w.mkVehicle(),
      dr = await w.mkDriver(),
      dr2 = await w.mkDriver();
    const d = await w.mkUser("driver", "ap3-d@x.com");
    const trip = await w.mkTrip({ vehicle: v1._id, driver: dr._id });
    const r = (
      await w.file(d, "vehicle_replacement", {
        trip: trip._id,
        vehicle: v2._id,
      })
    ).body.data;
    expect(
      (await w.rq("get", `/${r._id}/preview`, w.t)).body.data.canApply,
    ).toBe(true);
    await w.mkTrip({ vehicle: v2._id, driver: dr2._id }); // someone else takes v2 at the same time
    const pre = (await w.rq("get", `/${r._id}/preview`, w.t)).body.data;
    expect(pre.canApply).toBe(false);
    expect(pre.problems[0].message).toMatch(/conflicts with trip/);
    await w.rq("post", `/${r._id}/start-review`, w.t);
    expect(
      (await w.rq("post", `/${r._id}/review`, w.t, { decision: "approved" }))
        .status,
    ).toBe(409);
    expect(String((await Trip.findById(trip._id)).vehicle)).toBe(v1._id); // unchanged
  });

  it("replaces a driver when valid", async () => {
    const w = await world("ap4@x.com");
    const v = await w.mkVehicle(),
      dr = await w.mkDriver(),
      dr2 = await w.mkDriver();
    const d = await w.mkUser("driver", "ap4-d@x.com");
    const trip = await w.mkTrip({ vehicle: v._id, driver: dr._id });
    const r = (
      await w.file(d, "driver_replacement", { trip: trip._id, driver: dr2._id })
    ).body.data;
    expect((await w.approve(r._id)).body.data.status).toBe("resolved");
    expect(String((await Trip.findById(trip._id)).driver)).toBe(dr2._id);
  });

  it("reschedules only without creating conflicts", async () => {
    const w = await world("ap5@x.com");
    const v = await w.mkVehicle(),
      dr = await w.mkDriver();
    const d = await w.mkUser("driver", "ap5-d@x.com");
    const a = await w.mkTrip({
      vehicle: v._id,
      driver: dr._id,
      departureTime: "07:00",
    });
    await w.mkTrip({ vehicle: v._id, driver: dr._id, departureTime: "09:00" });
    const bad = (
      await w.file(d, "schedule_change", {
        trip: a._id,
        scheduledDate: dayStr(10),
        departureTime: "09:30",
      })
    ).body.data;
    await w.rq("post", `/${bad._id}/start-review`, w.t);
    expect(
      (await w.rq("post", `/${bad._id}/review`, w.t, { decision: "approved" }))
        .status,
    ).toBe(409);
    const good = (
      await w.file(d, "schedule_change", {
        trip: a._id,
        scheduledDate: dayStr(11),
        departureTime: "07:30",
      })
    ).body.data;
    expect((await w.approve(good._id)).status).toBe(200);
    const t = await Trip.findById(a._id);
    expect(t.scheduledDate).toBe(dayStr(11));
    expect(t.history.at(-1).action).toBe("rescheduled");
  });

  it("creates an additional trip, rejecting past dates", async () => {
    const w = await world("ap6@x.com");
    const d = await w.mkUser("driver", "ap6-d@x.com");
    const past = (
      await w.file(d, "additional_trip", {
        route: w.route._id,
        scheduledDate: dayStr(-2),
        departureTime: "07:00",
        durationMin: 60,
      })
    ).body.data;
    await w.rq("post", `/${past._id}/start-review`, w.t);
    expect(
      (await w.rq("post", `/${past._id}/review`, w.t, { decision: "approved" }))
        .status,
    ).toBe(409);
    const r = (
      await w.file(d, "additional_trip", {
        route: w.route._id,
        scheduledDate: dayStr(5),
        departureTime: "15:00",
        durationMin: 60,
      })
    ).body.data;
    const res = await w.approve(r._id);
    expect(res.body.data.appliedChange).toMatch(/Created trip TRP-/);
    expect(
      (await w.get(`/api/v1/trips?date=${dayStr(5)}`)).body.data,
    ).toHaveLength(1);
  });

  it("changes passenger assignments with stop validation", async () => {
    const w = await world("ap7@x.com");
    const d = await w.mkUser("driver", "ap7-d@x.com");
    const kid = await w.post("/api/v1/passengers", { name: "Asha Rao" });
    const bad = (
      await w.file(d, "passenger_assignment", {
        passenger: kid._id,
        route: w.route._id,
        pickupStop: "C",
        dropStop: "A",
      })
    ).body.data;
    await w.rq("post", `/${bad._id}/start-review`, w.t);
    expect(
      (await w.rq("post", `/${bad._id}/review`, w.t, { decision: "approved" }))
        .status,
    ).toBe(409);
    const ok = (
      await w.file(d, "passenger_assignment", {
        passenger: kid._id,
        route: w.route._id,
        pickupStop: "A",
        dropStop: "C",
      })
    ).body.data;
    expect((await w.approve(ok._id)).status).toBe(200);
    expect(
      await PassengerAssignment.countDocuments({
        passenger: kid._id,
        active: true,
      }),
    ).toBe(1);
    const rm = (
      await w.file(d, "passenger_assignment", {
        passenger: kid._id,
        route: w.route._id,
        remove: true,
      })
    ).body.data;
    expect((await w.approve(rm._id)).status).toBe(200);
    expect(
      await PassengerAssignment.countDocuments({
        passenger: kid._id,
        active: true,
      }),
    ).toBe(0);
  });

  it("adds a stop in position and bumps the route version without touching existing trips", async () => {
    const w = await world("ap8@x.com");
    const d = await w.mkUser("driver", "ap8-d@x.com");
    const trip = await w.mkTrip();
    const dupe = (
      await w.file(d, "new_stop", {
        route: w.route._id,
        name: "b",
        lat: 5,
        lng: 5,
      })
    ).body.data;
    await w.rq("post", `/${dupe._id}/start-review`, w.t);
    expect(
      (await w.rq("post", `/${dupe._id}/review`, w.t, { decision: "approved" }))
        .status,
    ).toBe(409); // name clash (case-insensitive)
    const r = (
      await w.file(d, "new_stop", {
        route: w.route._id,
        name: "Library",
        lat: 1.5,
        lng: 1.5,
        afterSequence: 1,
      })
    ).body.data;
    expect((await w.approve(r._id)).status).toBe(200);
    const route = await Route.findById(w.route._id);
    expect(route.stops.map((s) => s.name)).toEqual(["A", "Library", "B", "C"]);
    expect(route.stops.map((s) => s.sequence)).toEqual([1, 2, 3, 4]);
    expect(route.version).toBe(2);
    const snap = (await w.get(`/api/v1/trips/${trip._id}`)).body.data
      .routeSnapshot;
    expect(snap.version).toBe(1);
    expect(snap.stops).toHaveLength(3);
  });

  it("creates a new route inactive and blocks duplicate codes", async () => {
    const w = await world("ap9@x.com");
    const d = await w.mkUser("driver", "ap9-d@x.com");
    const dup = (
      await w.file(d, "new_route", {
        name: "Dup",
        code: "r1",
        stops: [
          { name: "X", lat: 1, lng: 1 },
          { name: "Y", lat: 2, lng: 2 },
        ],
      })
    ).body.data;
    await w.rq("post", `/${dup._id}/start-review`, w.t);
    expect(
      (await w.rq("post", `/${dup._id}/review`, w.t, { decision: "approved" }))
        .status,
    ).toBe(409);
    expect(
      (
        await w.file(d, "new_route", {
          name: "One stop",
          code: "N1",
          stops: [{ name: "X", lat: 1, lng: 1 }],
        })
      ).status,
    ).toBe(400);
    const r = (
      await w.file(d, "new_route", {
        name: "North Loop",
        code: "n1",
        stops: [
          { name: "X", lat: 1, lng: 1 },
          { name: "Y", lat: 2, lng: 2 },
        ],
      })
    ).body.data;
    expect((await w.approve(r._id)).status).toBe(200);
    const created = await Route.findOne({ organization: w.org, code: "N1" });
    expect(created.active).toBe(false);
  });

  it("keeps special requirements open for manual follow-up", async () => {
    const w = await world("ap10@x.com");
    const d = await w.mkUser("driver", "ap10-d@x.com");
    const r = (
      await w.file(
        d,
        "special_requirement",
        {},
        { description: "Child needs a wheelchair ramp" },
      )
    ).body.data;
    const res = await w.approve(r._id);
    expect(res.body.data.status).toBe("approved"); // not auto-resolved
    expect(
      (await w.rq("post", `/${r._id}/progress`, w.t, { to: "resolved" }))
        .status,
    ).toBe(200); // approved -> resolved allowed
    expect(
      (await w.rq("post", `/${r._id}/progress`, w.t, { to: "in_progress" }))
        .status,
    ).toBe(409); // terminal
    const r2 = (
      await w.file(
        d,
        "special_requirement",
        {},
        { description: "Needs escort on Fridays" },
      )
    ).body.data;
    await w.approve(r2._id);
    expect(
      (await w.rq("post", `/${r2._id}/progress`, d, { to: "resolved" })).status,
    ).toBe(403); // requesters can't close
    expect(
      (
        await w.rq("post", `/${r2._id}/progress`, w.t, {
          to: "in_progress",
          note: "Arranging",
        })
      ).body.data.status,
    ).toBe("in_progress");
  });

  it("applies exactly once when two reviewers approve at the same time", async () => {
    const w = await world("ap11@x.com");
    const second = await w.mkUser("dispatcher", "ap11-disp@x.com");
    const d = await w.mkUser("driver", "ap11-d@x.com");
    const r = (
      await w.file(d, "additional_trip", {
        route: w.route._id,
        scheduledDate: dayStr(6),
        departureTime: "10:00",
        durationMin: 60,
      })
    ).body.data;
    await w.rq("post", `/${r._id}/start-review`, w.t);
    const results = await Promise.all([
      w.rq("post", `/${r._id}/review`, w.t, { decision: "approved" }),
      w.rq("post", `/${r._id}/review`, second, { decision: "approved" }),
    ]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(
      (await w.get(`/api/v1/trips?date=${dayStr(6)}`)).body.data,
    ).toHaveLength(1);
  });
});

describe("request attachments", () => {
  it("are visible only to the requester and reviewers", async () => {
    const w = await world("at1@x.com");
    const d1 = await w.mkUser("driver", "at1-d1@x.com");
    const d2 = await w.mkUser("driver", "at1-d2@x.com");
    const trip = await w.mkTrip();
    const r = (
      await w.file(d1, "trip_cancellation", {
        trip: trip._id,
        reason: "Reason one",
      })
    ).body.data;
    const up = (tok) =>
      request(app)
        .post("/api/v1/documents")
        .set(auth(tok))
        .field("ownerType", "request")
        .field("owner", r._id)
        .field("type", "attachment")
        .attach("file", PDF, "note.pdf");
    const mine = await up(d1);
    expect(mine.status).toBe(201);
    expect((await up(d2)).status).toBe(403);
    const list = (tok) =>
      request(app)
        .get(`/api/v1/documents?ownerType=request&owner=${r._id}`)
        .set(auth(tok));
    expect((await list(d1)).body.data).toHaveLength(1);
    expect((await list(w.t)).body.data).toHaveLength(1); // reviewer
    expect((await list(d2)).status).toBe(403);
    expect(
      (await w.get(`/api/v1/documents/${mine.body.data._id}/file`, d2)).status,
    ).toBe(403);
    expect(
      (await w.get(`/api/v1/documents/${mine.body.data._id}/file`, d1)).status,
    ).toBe(200);
    // Never appears in bulk listings.
    expect(
      (await w.get("/api/v1/documents", w.t)).body.data.every(
        (x) => x.ownerType !== "request",
      ),
    ).toBe(true);
    expect(
      (
        await request(app)
          .get("/api/v1/documents?ownerType=request")
          .set(auth(w.t))
      ).status,
    ).toBe(403); // owner required
  });
});
