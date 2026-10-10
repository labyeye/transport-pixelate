// Report runners. Each returns { columns, rows, totals?, notes[] }. Rules:
//  - every query is scoped to the caller's organization;
//  - a percentage is only reported when the data behind it is sufficient, otherwise null + a note.
import { Trip } from "../../models/Trip.js";
import { Vehicle } from "../../models/Vehicle.js";
import { Driver } from "../../models/Driver.js";
import { Route } from "../../models/Route.js";
import { Maintenance } from "../../models/Maintenance.js";
import { FuelLog } from "../../models/FuelLog.js";
import { Expense } from "../../models/Expense.js";
import { zonedToUtc } from "../../utils/time.js";
import { computeEfficiency } from "../finance/efficiency.js";
import { DAY, daysLeft, soonWindow } from "../documents/documents.service.js";

export const MIN_SAMPLE = 5; // minimum trips before an on-time percentage is shown
const GRACE_MIN = 10; // a trip starting within this many minutes of schedule counts as on time
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const pct = (num, den) => (den > 0 ? round1((num / den) * 100) : null);
const addDays = (ymd, n) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (from, to) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
const ids = (list) => [...new Set(list.filter(Boolean).map(String))];

const STATUS_COLS = [
  { key: "total", label: "Total trips", type: "number" },
  { key: "completed", label: "Completed", type: "number" },
  { key: "inProgress", label: "In progress", type: "number" },
  { key: "upcoming", label: "Upcoming", type: "number" },
  { key: "delayed", label: "Delayed", type: "number" },
  { key: "cancelled", label: "Cancelled", type: "number" },
  { key: "aborted", label: "Aborted", type: "number" },
];
const count = (status) => ({
  $sum: { $cond: [{ $in: ["$status", [].concat(status)] }, 1, 0] },
});

export function bounds(ctx) {
  return {
    start: zonedToUtc(ctx.from, "00:00", ctx.tz),
    endExclusive: zonedToUtc(addDays(ctx.to, 1), "00:00", ctx.tz),
  };
}
const tripMatch = (ctx, extra = {}) => ({
  organization: ctx.org,
  scheduledDate: { $gte: ctx.from, $lte: ctx.to },
  ...extra,
});

async function names(Model, org, idList, field) {
  const rows = await Model.find({ organization: org, _id: { $in: idList } })
    .select(field)
    .lean();
  return new Map(rows.map((r) => [String(r._id), r]));
}

// ---------- trips -------------------------------------------------------------------------
async function tripsGrouped(ctx, keyExpr, label, keyType = "text") {
  const rows = await Trip.aggregate([
    { $match: tripMatch(ctx) },
    {
      $group: {
        _id: keyExpr,
        total: { $sum: 1 },
        completed: count("completed"),
        inProgress: count("in_progress"),
        upcoming: count(["scheduled", "assigned", "ready", "draft"]),
        delayed: count("delayed"),
        cancelled: count("cancelled"),
        aborted: count("aborted"),
        km: {
          $sum: {
            $cond: [
              { $eq: ["$status", "completed"] },
              { $ifNull: ["$actualDistanceKm", 0] },
              0,
            ],
          },
        },
        kmTrips: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", "completed"] },
                  { $gt: ["$actualDistanceKm", 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  return { rows, label, keyType };
}

function tripReport(keyExpr, label, keyType) {
  return async (ctx) => {
    const { rows } = await tripsGrouped(ctx, keyExpr, label, keyType);
    const out = rows.map((r) => ({ group: r._id, ...r, km: round1(r.km) }));
    const sum = (k) => out.reduce((a, r) => a + r[k], 0);
    const completed = sum("completed");
    const withKm = sum("kmTrips");
    return {
      columns: [
        { key: "group", label, type: keyType },
        ...STATUS_COLS,
        { key: "km", label: "Distance (km)", type: "number" },
      ],
      rows: out,
      totals: {
        group: "Total",
        total: sum("total"),
        completed,
        inProgress: sum("inProgress"),
        upcoming: sum("upcoming"),
        delayed: sum("delayed"),
        cancelled: sum("cancelled"),
        aborted: sum("aborted"),
        km: round1(sum("km")),
      },
      notes:
        completed && withKm < completed
          ? [
              `Distance is the sum of drivers' recorded distance and covers ${withKm} of ${completed} completed trips.`,
            ]
          : [],
    };
  };
}

async function tripsByEntity(ctx, field, Model, nameField, label) {
  const { rows } = await tripsGrouped(ctx, `$${field}`, label);
  const nm = await names(
    Model,
    ctx.org,
    ids(rows.map((r) => r._id)),
    nameField,
  );
  const out = rows.map((r) => ({
    group: r._id
      ? (nm.get(String(r._id))?.[nameField] ?? "(removed)")
      : "Unassigned",
    ...r,
    km: round1(r.km),
  }));
  return out;
}

// ---------- utilization -------------------------------------------------------------------
async function vehicleUtilization(ctx) {
  const days = daysBetween(ctx.from, ctx.to);
  const [done, planned, vehicles] = await Promise.all([
    Trip.aggregate([
      {
        $match: tripMatch(ctx, { status: "completed", vehicle: { $ne: null } }),
      },
      {
        $group: {
          _id: "$vehicle",
          trips: { $sum: 1 },
          dates: { $addToSet: "$scheduledDate" },
          minutes: {
            $sum: {
              $cond: [
                { $and: ["$actualStart", "$actualEnd"] },
                {
                  $dateDiff: {
                    startDate: "$actualStart",
                    endDate: "$actualEnd",
                    unit: "minute",
                  },
                },
                0,
              ],
            },
          },
          timed: {
            $sum: { $cond: [{ $and: ["$actualStart", "$actualEnd"] }, 1, 0] },
          },
          km: { $sum: { $ifNull: ["$actualDistanceKm", 0] } },
        },
      },
    ]),
    Trip.aggregate([
      {
        $match: tripMatch(ctx, {
          status: { $nin: ["cancelled", "draft"] },
          vehicle: { $ne: null },
        }),
      },
      { $group: { _id: "$vehicle", trips: { $sum: 1 } } },
    ]),
    Vehicle.find({ organization: ctx.org, archivedAt: null })
      .select("registrationNumber createdAt category")
      .lean(),
  ]);
  const d = new Map(done.map((x) => [String(x._id), x]));
  const p = new Map(planned.map((x) => [String(x._id), x.trips]));
  const startUtc = bounds(ctx).start;
  const rows = vehicles
    .map((v) => {
      const x = d.get(String(v._id));
      const wholePeriod = v.createdAt <= startUtc; // only then is "days in range" a fair denominator
      const daysUsed = x?.dates.length ?? 0;
      return {
        vehicle: v.registrationNumber,
        category: v.category,
        plannedTrips: p.get(String(v._id)) ?? 0,
        completedTrips: x?.trips ?? 0,
        hours: x ? round1(x.minutes / 60) : 0,
        tripsWithTimes: x?.timed ?? 0,
        km: round1(x?.km ?? 0),
        daysUsed,
        daysInPeriod: wholePeriod ? days : null,
        daysUsedPct: wholePeriod ? pct(daysUsed, days) : null,
      };
    })
    .sort(
      (a, b) =>
        b.completedTrips - a.completedTrips ||
        a.vehicle.localeCompare(b.vehicle),
    );
  const missing = rows.reduce(
    (a, r) => a + (r.completedTrips - r.tripsWithTimes),
    0,
  );
  const notes = [
    "“Days used %” is the share of calendar days in the period on which the vehicle completed at least one trip; it is not shown for vehicles added during the period.",
  ];
  if (missing)
    notes.push(
      `${missing} completed trip(s) have no recorded start/end time and are excluded from hours.`,
    );
  return {
    columns: [
      { key: "vehicle", label: "Vehicle" },
      { key: "category", label: "Category" },
      { key: "plannedTrips", label: "Planned trips", type: "number" },
      { key: "completedTrips", label: "Completed trips", type: "number" },
      { key: "hours", label: "Hours in service", type: "number" },
      { key: "km", label: "Distance (km)", type: "number" },
      { key: "daysUsed", label: "Days used", type: "number" },
      { key: "daysInPeriod", label: "Days in period", type: "number" },
      { key: "daysUsedPct", label: "Days used %", type: "number" },
    ],
    rows,
    notes,
  };
}

// ---------- driver duty -------------------------------------------------------------------
async function driverDuty(ctx) {
  const rows = await Trip.aggregate([
    { $match: tripMatch(ctx, { driver: { $ne: null } }) },
    {
      $group: {
        _id: "$driver",
        assigned: { $sum: 1 },
        completed: count("completed"),
        cancelled: count(["cancelled", "aborted"]),
        delayed: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$status", "delayed"] },
                  { $in: ["delayed", "$history.to"] },
                ],
              },
              1,
              0,
            ],
          },
        },
        days: {
          $addToSet: {
            $cond: [
              { $eq: ["$status", "completed"] },
              "$scheduledDate",
              "$$REMOVE",
            ],
          },
        },
        minutes: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", "completed"] },
                  "$actualStart",
                  "$actualEnd",
                ],
              },
              {
                $dateDiff: {
                  startDate: "$actualStart",
                  endDate: "$actualEnd",
                  unit: "minute",
                },
              },
              0,
            ],
          },
        },
        km: {
          $sum: {
            $cond: [
              { $eq: ["$status", "completed"] },
              { $ifNull: ["$actualDistanceKm", 0] },
              0,
            ],
          },
        },
      },
    },
  ]);
  const nm = await names(Driver, ctx.org, ids(rows.map((r) => r._id)), "name");
  const out = rows
    .map((r) => ({
      driver: nm.get(String(r._id))?.name ?? "(removed)",
      assigned: r.assigned,
      completed: r.completed,
      cancelled: r.cancelled,
      delayed: r.delayed,
      daysWorked: r.days.length,
      hours: round1(r.minutes / 60),
      km: round1(r.km),
    }))
    .sort(
      (a, b) => b.completed - a.completed || a.driver.localeCompare(b.driver),
    );
  return {
    columns: [
      { key: "driver", label: "Driver" },
      { key: "assigned", label: "Trips assigned", type: "number" },
      { key: "completed", label: "Completed", type: "number" },
      { key: "cancelled", label: "Cancelled / aborted", type: "number" },
      { key: "delayed", label: "Delayed", type: "number" },
      { key: "daysWorked", label: "Days worked", type: "number" },
      { key: "hours", label: "Hours driven", type: "number" },
      { key: "km", label: "Distance (km)", type: "number" },
    ],
    rows: out,
    notes: [
      "Hours and distance include only completed trips that have recorded times / distance.",
    ],
  };
}

// ---------- route performance -------------------------------------------------------------
async function routePerformance(ctx) {
  const trips = await Trip.find(tripMatch(ctx))
    .select(
      "routeSnapshot.code routeSnapshot.name status scheduledDeparture actualStart history.to",
    )
    .lean();
  const by = new Map();
  for (const t of trips) {
    const k = t.routeSnapshot.code;
    const r = by.get(k) ?? {
      route: k,
      name: t.routeSnapshot.name,
      trips: 0,
      completed: 0,
      cancelled: 0,
      delayed: 0,
      timed: 0,
      onTime: 0,
      lateMin: 0,
    };
    r.trips++;
    if (t.status === "completed") r.completed++;
    if (["cancelled", "aborted"].includes(t.status)) r.cancelled++;
    const wasDelayed =
      t.status === "delayed" || t.history?.some((h) => h.to === "delayed");
    if (wasDelayed) r.delayed++;
    if (t.status === "completed" && t.actualStart) {
      r.timed++;
      const late = (t.actualStart - t.scheduledDeparture) / 60000;
      r.lateMin += Math.max(0, late);
      if (!wasDelayed && late <= GRACE_MIN) r.onTime++;
    }
    by.set(k, r);
  }
  const rows = [...by.values()]
    .map((r) => ({
      route: r.route,
      name: r.name,
      trips: r.trips,
      completed: r.completed,
      cancelled: r.cancelled,
      delayed: r.delayed,
      tripsWithStartTime: r.timed,
      onTimePct: r.timed >= MIN_SAMPLE ? pct(r.onTime, r.timed) : null, // null = not enough data
      avgLateStartMin:
        r.timed >= MIN_SAMPLE ? round1(r.lateMin / r.timed) : null,
    }))
    .sort((a, b) => a.route.localeCompare(b.route));
  return {
    columns: [
      { key: "route", label: "Route" },
      { key: "name", label: "Name" },
      { key: "trips", label: "Trips", type: "number" },
      { key: "completed", label: "Completed", type: "number" },
      { key: "cancelled", label: "Cancelled / aborted", type: "number" },
      { key: "delayed", label: "Delayed", type: "number" },
      {
        key: "tripsWithStartTime",
        label: "Completed with start time",
        type: "number",
      },
      { key: "onTimePct", label: "On-time %", type: "number" },
      { key: "avgLateStartMin", label: "Avg late start (min)", type: "number" },
    ],
    rows,
    notes: [
      `On-time % = completed trips that started within ${GRACE_MIN} minutes of schedule and were never marked delayed, out of completed trips with a recorded start time. It is left blank (not enough data) below ${MIN_SAMPLE} such trips.`,
    ],
  };
}

// ---------- trip lists --------------------------------------------------------------------
async function tripList(ctx, match, extraCols) {
  const trips = await Trip.find(match)
    .sort({ scheduledDeparture: -1 })
    .limit(ctx.cap + 1)
    .populate("vehicle", "registrationNumber")
    .populate("driver", "name")
    .lean();
  return trips;
}
const tripBase = (t) => ({
  tripNumber: t.tripNumber,
  date: t.scheduledDate,
  route: t.routeSnapshot.code,
  vehicle: t.vehicle?.registrationNumber ?? "",
  driver: t.driver?.name ?? "",
  status: t.status,
});
const BASE_COLS = [
  { key: "tripNumber", label: "Trip" },
  { key: "date", label: "Date", type: "date" },
  { key: "route", label: "Route" },
  { key: "vehicle", label: "Vehicle" },
  { key: "driver", label: "Driver" },
  { key: "status", label: "Status" },
];

async function delayedTrips(ctx) {
  const trips = await tripList(
    ctx,
    tripMatch(ctx, {
      $or: [
        { status: "delayed" },
        { "history.to": "delayed" },
        { delayReason: { $exists: true, $nin: [null, ""] } },
      ],
    }),
  );
  const rows = trips.slice(0, ctx.cap).map((t) => ({
    ...tripBase(t),
    reason: t.delayReason ?? "",
    lateStartMin: t.actualStart
      ? Math.max(0, Math.round((t.actualStart - t.scheduledDeparture) / 60000))
      : null,
  }));
  return {
    columns: [
      ...BASE_COLS,
      { key: "reason", label: "Delay reason" },
      { key: "lateStartMin", label: "Late start (min)", type: "number" },
    ],
    rows,
    notes: [],
    truncated: trips.length > ctx.cap,
  };
}
async function cancelledTrips(ctx) {
  const trips = await tripList(
    ctx,
    tripMatch(ctx, { status: { $in: ["cancelled", "aborted"] } }),
  );
  const rows = trips
    .slice(0, ctx.cap)
    .map((t) => ({ ...tripBase(t), reason: t.cancellationReason ?? "" }));
  return {
    columns: [...BASE_COLS, { key: "reason", label: "Reason" }],
    rows,
    notes: [],
    truncated: trips.length > ctx.cap,
  };
}

// ---------- maintenance -------------------------------------------------------------------
async function maintenanceReport(ctx) {
  const { start, endExclusive } = bounds(ctx);
  const recs = await Maintenance.find({
    organization: ctx.org,
    $or: [
      { serviceDate: { $gte: start, $lt: endExclusive } },
      { serviceDate: null, reportedAt: { $gte: start, $lt: endExclusive } },
    ],
  })
    .populate("vehicle", "registrationNumber")
    .sort({ reportedAt: -1 })
    .limit(ctx.cap + 1)
    .lean();
  const rows = recs.slice(0, ctx.cap).map((m) => ({
    number: m.number,
    vehicle: m.vehicle?.registrationNumber ?? "",
    type: m.type,
    issue: m.issue,
    priority: m.priority,
    status: m.status,
    reportedAt: m.reportedAt,
    serviceDate: m.serviceDate ?? null,
    workshop: m.workshop ?? "",
    cost: m.cost ?? null,
  }));
  const done = rows.filter((r) => r.status === "completed");
  return {
    columns: [
      { key: "number", label: "Record" },
      { key: "vehicle", label: "Vehicle" },
      { key: "type", label: "Type" },
      { key: "issue", label: "Issue" },
      { key: "priority", label: "Priority" },
      { key: "status", label: "Status" },
      { key: "reportedAt", label: "Reported", type: "date" },
      { key: "serviceDate", label: "Serviced", type: "date" },
      { key: "workshop", label: "Workshop" },
      { key: "cost", label: "Cost (₹)", type: "money" },
    ],
    rows,
    totals: {
      number: "Completed cost",
      cost: round2(done.reduce((a, r) => a + (r.cost ?? 0), 0)),
    },
    notes: [
      "Records are included by service date (or report date if not yet serviced). The cost total counts completed records only.",
    ],
    truncated: recs.length > ctx.cap,
  };
}

// ---------- fuel & costs ------------------------------------------------------------------
async function fuelConsumption(ctx) {
  const { start, endExclusive } = bounds(ctx);
  const logs = await FuelLog.find({
    organization: ctx.org,
    filledAt: { $gte: start, $lt: endExclusive },
  })
    .sort({ filledAt: 1 })
    .lean();
  const byV = new Map();
  for (const l of logs)
    byV.set(String(l.vehicle), [...(byV.get(String(l.vehicle)) ?? []), l]);
  const nm = await names(
    Vehicle,
    ctx.org,
    [...byV.keys()],
    "registrationNumber",
  );
  const rows = [...byV.entries()]
    .map(([vid, list]) => {
      const qty = list.reduce((a, l) => a + l.quantity, 0),
        amt = list.reduce((a, l) => a + l.totalAmount, 0);
      const eff = computeEfficiency(list);
      return {
        vehicle: nm.get(vid)?.registrationNumber ?? "(removed)",
        fills: list.length,
        quantity: round2(qty),
        amount: round2(amt),
        avgPrice: qty ? round2(amt / qty) : null,
        measuredKm: eff.km,
        kmPerUnit: eff.averageKmPerUnit,
      };
    })
    .sort((a, b) => b.amount - a.amount);
  return {
    columns: [
      { key: "vehicle", label: "Vehicle" },
      { key: "fills", label: "Fills", type: "number" },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "amount", label: "Spend (₹)", type: "money" },
      { key: "avgPrice", label: "Avg price / unit (₹)", type: "money" },
      { key: "measuredKm", label: "Measured km", type: "number" },
      { key: "kmPerUnit", label: "km per unit", type: "number" },
    ],
    rows,
    totals: {
      vehicle: "Total",
      fills: logs.length,
      quantity: round2(rows.reduce((a, r) => a + r.quantity, 0)),
      amount: round2(rows.reduce((a, r) => a + r.amount, 0)),
    },
    notes: [
      "km per unit is measured only between consecutive full-tank fills inside the period; it is blank when there are fewer than two full-tank fills. It is never estimated.",
    ],
  };
}

async function vehicleExpenses(ctx) {
  const { start, endExclusive } = bounds(ctx);
  const [fuel, maint, exp, trips, vehicles] = await Promise.all([
    FuelLog.aggregate([
      {
        $match: {
          organization: ctx.org,
          filledAt: { $gte: start, $lt: endExclusive },
        },
      },
      { $group: { _id: "$vehicle", t: { $sum: "$totalAmount" } } },
    ]),
    Maintenance.aggregate([
      {
        $match: {
          organization: ctx.org,
          status: "completed",
          serviceDate: { $gte: start, $lt: endExclusive },
        },
      },
      { $group: { _id: "$vehicle", t: { $sum: "$cost" } } },
    ]),
    Expense.aggregate([
      {
        $match: {
          organization: ctx.org,
          status: "approved",
          date: { $gte: start, $lt: endExclusive },
        },
      },
      { $group: { _id: "$vehicle", t: { $sum: "$amount" } } },
    ]),
    Trip.aggregate([
      {
        $match: tripMatch(ctx, { status: "completed", vehicle: { $ne: null } }),
      },
      {
        $group: {
          _id: "$vehicle",
          trips: { $sum: 1 },
          km: { $sum: { $ifNull: ["$actualDistanceKm", 0] } },
          kmTrips: {
            $sum: { $cond: [{ $gt: ["$actualDistanceKm", 0] }, 1, 0] },
          },
        },
      },
    ]),
    Vehicle.find({ organization: ctx.org, archivedAt: null })
      .select("registrationNumber")
      .lean(),
  ]);
  const m = (list) => new Map(list.map((x) => [String(x._id ?? "none"), x]));
  const F = m(fuel),
    M = m(maint),
    E = m(exp),
    T = m(trips);
  const rows = vehicles
    .map((v) => {
      const k = String(v._id);
      const fuelAmt = F.get(k)?.t ?? 0,
        mAmt = M.get(k)?.t ?? 0,
        eAmt = E.get(k)?.t ?? 0,
        total = fuelAmt + mAmt + eAmt;
      const t = T.get(k);
      const allTimed = t && t.kmTrips === t.trips && t.km > 0;
      return {
        vehicle: v.registrationNumber,
        fuel: round2(fuelAmt),
        maintenance: round2(mAmt),
        expenses: round2(eAmt),
        total: round2(total),
        completedTrips: t?.trips ?? 0,
        costPerTrip: t?.trips ? round2(total / t.trips) : null,
        costPerKm: allTimed ? round2(total / t.km) : null,
      };
    })
    .filter((r) => r.total > 0 || r.completedTrips > 0)
    .sort((a, b) => b.total - a.total);
  const shared = E.get("none")?.t ?? 0;
  const sum = (k) => round2(rows.reduce((a, r) => a + r[k], 0));
  const notes = [
    "Fuel is by fill date, maintenance by service date (completed only), expenses by expense date (approved only).",
    "Cost per km is shown only when every completed trip of the vehicle has a recorded distance.",
  ];
  if (shared)
    notes.push(
      `₹${round2(shared)} of approved expenses are not linked to a vehicle and are not included above.`,
    );
  return {
    columns: [
      { key: "vehicle", label: "Vehicle" },
      { key: "fuel", label: "Fuel (₹)", type: "money" },
      { key: "maintenance", label: "Maintenance (₹)", type: "money" },
      { key: "expenses", label: "Expenses (₹)", type: "money" },
      { key: "total", label: "Total (₹)", type: "money" },
      { key: "completedTrips", label: "Completed trips", type: "number" },
      { key: "costPerTrip", label: "Cost / trip (₹)", type: "money" },
      { key: "costPerKm", label: "Cost / km (₹)", type: "money" },
    ],
    rows,
    totals: {
      vehicle: "Total",
      fuel: sum("fuel"),
      maintenance: sum("maintenance"),
      expenses: sum("expenses"),
      total: sum("total"),
    },
    notes,
  };
}

// ---------- document expiry (as of today; the date range is not used) ---------------------
async function documentExpiry(ctx) {
  const { soonDays } = await soonWindow(ctx.org);
  const horizon = new Date(
    Date.now() + (ctx.withinDays ?? Math.max(soonDays, 60)) * DAY,
  );
  const rows = [];
  const push = (subject, kind, doc, number, expiry) => {
    const left = daysLeft(expiry);
    rows.push({
      subject,
      kind,
      document: doc,
      number: number ?? "",
      expiry,
      daysLeft: left,
      status:
        left < 0 ? "expired" : left <= soonDays ? "expiring_soon" : "valid",
    });
  };
  const [vehicles, drivers] = await Promise.all([
    Vehicle.find({ organization: ctx.org, archivedAt: null })
      .select("registrationNumber documents")
      .lean(),
    Driver.find({
      organization: ctx.org,
      archivedAt: null,
      "licence.expiryDate": { $lte: horizon },
    })
      .select("name licence")
      .lean(),
  ]);
  for (const v of vehicles)
    for (const k of [
      "insurance",
      "registration",
      "fitness",
      "permit",
      "pollution",
    ]) {
      const d = v.documents?.[k];
      if (d?.expiryDate && d.expiryDate <= horizon)
        push(v.registrationNumber, "Vehicle", k, d.number, d.expiryDate);
    }
  for (const d of drivers)
    push(d.name, "Driver", "licence", d.licence.number, d.licence.expiryDate);
  rows.sort((a, b) => a.daysLeft - b.daysLeft);
  return {
    columns: [
      { key: "subject", label: "Vehicle / person" },
      { key: "kind", label: "Type" },
      { key: "document", label: "Document" },
      { key: "number", label: "Number" },
      { key: "expiry", label: "Expiry", type: "date" },
      { key: "daysLeft", label: "Days left", type: "number" },
      { key: "status", label: "Status" },
    ],
    rows,
    notes: [
      "Shows everything expired or expiring within the window as of today; the date filter does not apply to this report.",
    ],
  };
}

export const REPORTS = {
  trips_daily: {
    label: "Daily trip report",
    group: "Trips",
    needs: ["trips:read"],
    run: tripReport({ $substr: ["$scheduledDate", 0, 10] }, "Date", "date"),
  },
  trips_monthly: {
    label: "Monthly trip report",
    group: "Trips",
    needs: ["trips:read"],
    run: tripReport({ $substr: ["$scheduledDate", 0, 7] }, "Month", "text"),
  },
  trips_by_route: {
    label: "Trips by route",
    group: "Trips",
    needs: ["trips:read"],
    run: async (ctx) => {
      const rows = await tripsByEntity(ctx, "route", Route, "code", "Route");
      return tripEntity(rows, "Route");
    },
  },
  trips_by_vehicle: {
    label: "Trips by vehicle",
    group: "Trips",
    needs: ["trips:read", "vehicles:read"],
    run: async (ctx) =>
      tripEntity(
        await tripsByEntity(
          ctx,
          "vehicle",
          Vehicle,
          "registrationNumber",
          "Vehicle",
        ),
        "Vehicle",
      ),
  },
  trips_by_driver: {
    label: "Trips by driver",
    group: "Trips",
    needs: ["trips:read", "drivers:read"],
    run: async (ctx) =>
      tripEntity(
        await tripsByEntity(ctx, "driver", Driver, "name", "Driver"),
        "Driver",
      ),
  },
  vehicle_utilization: {
    label: "Vehicle utilization",
    group: "Fleet",
    needs: ["trips:read", "vehicles:read"],
    run: vehicleUtilization,
  },
  driver_duty: {
    label: "Driver duty",
    group: "Fleet",
    needs: ["trips:read", "drivers:read"],
    run: driverDuty,
  },
  route_performance: {
    label: "Route performance",
    group: "Trips",
    needs: ["trips:read"],
    run: routePerformance,
  },
  delayed_trips: {
    label: "Delayed trips",
    group: "Trips",
    needs: ["trips:read"],
    run: delayedTrips,
  },
  cancelled_trips: {
    label: "Cancelled trips",
    group: "Trips",
    needs: ["trips:read"],
    run: cancelledTrips,
  },
  maintenance: {
    label: "Maintenance",
    group: "Costs",
    needs: ["maintenance:read"],
    run: maintenanceReport,
  },
  fuel: {
    label: "Fuel consumption",
    group: "Costs",
    needs: ["expenses:read"],
    module: "fuelExpenses",
    run: fuelConsumption,
  },
  vehicle_expenses: {
    label: "Vehicle expenses",
    group: "Costs",
    needs: ["expenses:read"],
    module: "fuelExpenses",
    run: vehicleExpenses,
  },
  document_expiry: {
    label: "Document expiry",
    group: "Fleet",
    needs: ["vehicles:read"],
    noRange: true,
    run: documentExpiry,
  },
};

function tripEntity(rows, label) {
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  return {
    columns: [
      { key: "group", label },
      ...STATUS_COLS,
      { key: "km", label: "Distance (km)", type: "number" },
    ],
    rows,
    totals: {
      group: "Total",
      total: sum("total"),
      completed: sum("completed"),
      inProgress: sum("inProgress"),
      upcoming: sum("upcoming"),
      delayed: sum("delayed"),
      cancelled: sum("cancelled"),
      aborted: sum("aborted"),
      km: round1(sum("km")),
    },
    notes: [],
  };
}
