// Scheduled checks that raise notifications. Safe to run repeatedly: every notification carries a
// dedupe key, so re-running (or running on several servers) never double-notifies.
import { Organization } from "../../models/Organization.js";
import { Trip } from "../../models/Trip.js";
import { Vehicle } from "../../models/Vehicle.js";
import { Driver } from "../../models/Driver.js";
import { Maintenance } from "../../models/Maintenance.js";
import { notify, retryDue } from "./notify.service.js";
import { DAY, daysLeft, soonWindow } from "../documents/documents.service.js";
import { ensureSubscription } from "../saas/subscription.service.js";

const fmtTime = (d, tz) =>
  d.toLocaleTimeString("en-IN", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const bucket = (left, days) =>
  left <= 0 ? 0 : [...days].sort((a, b) => a - b).find((x) => left <= x);
const when = (left) =>
  left < 0
    ? `expired ${-left} day(s) ago`
    : left === 0
      ? "expires today"
      : `expires in ${left} day(s)`;
const VEHICLE_DOCS = [
  "insurance",
  "registration",
  "fitness",
  "permit",
  "pollution",
];

export async function tripsStartingSoon(org, tz, now = Date.now()) {
  const trips = await Trip.find({
    organization: org,
    status: { $in: ["assigned", "ready"] },
    scheduledDeparture: {
      $gt: new Date(now),
      $lte: new Date(now + 30 * 60000),
    },
  })
    .populate("driver", "name phone user")
    .lean();
  for (const t of trips) {
    const d = t.driver;
    await notify("trip_starting_soon", {
      org,
      dedupeKey: `soon:${t._id}`,
      link: "/trips",
      vars: {
        tripNumber: t.tripNumber,
        route: t.routeSnapshot.code,
        time: fmtTime(t.scheduledDeparture, tz),
      },
      extra: d ? [{ userId: d.user, name: d.name, phone: d.phone }] : [],
    });
  }
  return trips.length;
}

export async function documentReminders(org, now = Date.now()) {
  const { days, soonDays } = await soonWindow(org);
  const horizon = new Date(now + soonDays * DAY);
  let sent = 0;
  const raise = async (subject, document, expiry, entityKey) => {
    const left = daysLeft(expiry, now);
    const b = bucket(left, days);
    if (b === undefined) return;
    // Key includes the expiry date: renewing a document re-arms its reminders.
    await notify("document_expiring", {
      org,
      dedupeKey: `doc:${entityKey}:${new Date(expiry).toISOString().slice(0, 10)}:${b}`,
      link: "/documents",
      vars: {
        subject,
        document,
        when: when(left),
        expiry: new Date(expiry).toLocaleDateString("en-IN"),
      },
    });
    sent++;
  };
  const vehicles = await Vehicle.find({ organization: org, archivedAt: null })
    .select("registrationNumber documents")
    .lean();
  for (const v of vehicles)
    for (const k of VEHICLE_DOCS) {
      const exp = v.documents?.[k]?.expiryDate;
      if (exp && exp <= horizon)
        await raise(v.registrationNumber, k, exp, `v:${v._id}:${k}`);
    }
  const drivers = await Driver.find({
    organization: org,
    archivedAt: null,
    "licence.expiryDate": { $lte: horizon },
  })
    .select("name licence")
    .lean();
  for (const d of drivers)
    await raise(d.name, "licence", d.licence.expiryDate, `d:${d._id}:licence`);
  return sent;
}

export async function maintenanceDue(org, tz, now = Date.now()) {
  const list = await Maintenance.find({
    organization: org,
    status: { $in: ["reported", "scheduled"] },
    scheduledDate: { $lte: new Date(now + 3 * DAY) },
  })
    .populate("vehicle", "registrationNumber")
    .lean();
  for (const m of list) {
    await notify("maintenance_due", {
      org,
      dedupeKey: `maint:${m._id}:${new Date(m.scheduledDate).toISOString().slice(0, 10)}`,
      link: "/maintenance",
      vars: {
        vehicle: m.vehicle?.registrationNumber,
        issue: m.issue,
        date: new Date(m.scheduledDate).toLocaleDateString("en-IN", {
          timeZone: tz,
        }),
      },
    });
  }
  return list.length;
}

const SUB_STAGES = [7, 3, 1, 0]; // days left at which the owner is told; 0 = ended

export async function subscriptionReminders(org, now = Date.now()) {
  const sub = await ensureSubscription(org);
  const end = sub.isTrial ? sub.trialEndDate : sub.renewalDate;
  if (!end) return 0;
  const left = Math.ceil((end - now) / DAY);
  // Smallest stage already reached, so each stage fires once per period (the key carries the end date).
  const stage = [...SUB_STAGES].sort((a, b) => a - b).find((s) => left <= s);
  if (stage === undefined || left < -7) return 0; // far from the end, or long expired
  const plan = sub.isTrial ? "free trial" : "subscription";
  await notify("subscription_ending", {
    org,
    dedupeKey: `sub:${new Date(end).toISOString().slice(0, 10)}:${stage}`,
    link: "/subscription",
    vars: {
      plan,
      when:
        left <= 0
          ? "has ended"
          : left === 1
            ? "ends tomorrow"
            : `ends in ${left} days`,
      date: new Date(end).toLocaleDateString("en-IN"),
    },
  });
  return 1;
}

export async function runScheduled(now = Date.now()) {
  const orgs = await Organization.find({ status: "active" })
    .select("timezone")
    .lean();
  const out = { trips: 0, documents: 0, maintenance: 0, subscriptions: 0 };
  for (const o of orgs) {
    out.subscriptions += await subscriptionReminders(o._id, now);
    out.trips += await tripsStartingSoon(o._id, o.timezone, now);
    out.documents += await documentReminders(o._id, now);
    out.maintenance += await maintenanceDue(o._id, o.timezone, now);
  }
  return out;
}

export function startNotificationJobs() {
  const guard = (name, fn) => () =>
    fn().catch((e) => console.error(`[job:${name}]`, e.message));
  setInterval(guard("scheduled", runScheduled), 5 * 60_000).unref();
  setInterval(guard("retry", retryDue), 60_000).unref();
}
