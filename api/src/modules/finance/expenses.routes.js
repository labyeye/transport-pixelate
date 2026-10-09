import { Router } from "express";
import { z } from "zod";
import { Expense, EXPENSE_CATEGORIES } from "../../models/Expense.js";
import { FuelLog } from "../../models/FuelLog.js";
import { Maintenance } from "../../models/Maintenance.js";
import { Vehicle } from "../../models/Vehicle.js";
import { Trip } from "../../models/Trip.js";
import { protect, requirePermission, orgScope } from "../../middleware/auth.js";
import { requireModule } from "../../middleware/requireModule.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "../../utils/errors.js";
import { meta, pageQuery } from "../../utils/pagination.js";
import { audit } from "../../models/AuditLog.js";
import { can } from "../../utils/permissions.js";

const r = Router();
r.use(protect, requireModule("fuelExpenses"));
const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

const body = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  vehicle: id.optional(),
  trip: id.optional(),
  amount: z.coerce.number().positive().max(10_000_000),
  date: z.coerce.date(),
  vendor: z.string().trim().max(120).optional(),
  paymentMethod: z
    .enum(["cash", "card", "upi", "bank", "other"])
    .default("cash"),
  notes: z.string().max(1000).optional(),
  clientRef: z.string().trim().min(8).max(80).optional(),
});

async function checkRefs(req, b) {
  if (
    b.vehicle &&
    !(await Vehicle.exists({
      _id: b.vehicle,
      ...orgScope(req),
      archivedAt: null,
    }))
  )
    throw notFound("Vehicle not found");
  if (b.trip && !(await Trip.exists({ _id: b.trip, ...orgScope(req) })))
    throw notFound("Trip not found");
  if (+b.date > Date.now() + 86400000)
    throw badRequest("Date is in the future");
}

const listQuery = pageQuery.extend({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  vehicle: id.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
r.get(
  "/",
  requirePermission("expenses:read"),
  validate(listQuery, "query"),
  ah(async (req, res) => {
    const q = req.query;
    const filter = { ...orgScope(req) };
    for (const k of ["status", "category", "vehicle"])
      if (q[k]) filter[k] = q[k];
    if (q.from || q.to)
      filter.date = {
        ...(q.from && { $gte: q.from }),
        ...(q.to && { $lte: q.to }),
      };
    const [items, total] = await Promise.all([
      Expense.find(filter)
        .populate("vehicle", "registrationNumber")
        .populate("submittedBy", "name")
        .populate("reviewedBy", "name")
        .sort({ date: -1, createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      Expense.countDocuments(filter),
    ]);
    res.json({
      success: true,
      data: items,
      meta: meta(q.page, q.limit, total),
    });
  }),
);

r.post(
  "/",
  requirePermission("expenses:write"),
  validate(body),
  ah(async (req, res) => {
    const b = req.body;
    if (b.clientRef) {
      const dup = await Expense.findOne({
        ...orgScope(req),
        clientRef: b.clientRef,
      });
      if (dup) return res.json({ success: true, data: dup, duplicate: true });
    }
    await checkRefs(req, b);
    // Identical amount/vendor/vehicle/date submitted by the same person is treated as a double click.
    const twin = await Expense.exists({
      ...orgScope(req),
      submittedBy: req.user._id,
      category: b.category,
      amount: b.amount,
      date: b.date,
      vehicle: b.vehicle ?? null,
      vendor: b.vendor ?? null,
      createdAt: { $gt: new Date(Date.now() - 10 * 60000) },
    });
    if (twin) throw conflict("An identical expense was just submitted");
    // Approvers' own entries still go through review by someone else.
    const e = await Expense.create({
      ...b,
      vehicle: b.vehicle ?? null,
      vendor: b.vendor ?? null,
      ...orgScope(req),
      submittedBy: req.user._id,
    });
    await audit(req, "expense.create", "Expense", e.id);
    res.status(201).json({ success: true, data: e });
  }),
);

r.put(
  "/:id",
  requirePermission("expenses:write"),
  validate(body.omit({ clientRef: true })),
  ah(async (req, res) => {
    const e = await Expense.findOne({ _id: req.params.id, ...orgScope(req) });
    if (!e) throw notFound("Expense not found");
    if (e.status !== "pending")
      throw conflict(`A ${e.status} expense can't be edited`);
    if (
      String(e.submittedBy) !== String(req.user._id) &&
      !can(req.user.role, "expenses:approve")
    )
      throw forbidden("Only the submitter can edit this expense");
    await checkRefs(req, req.body);
    e.set(req.body);
    await e.save();
    await audit(req, "expense.update", "Expense", e.id);
    res.json({ success: true, data: e });
  }),
);

r.post(
  "/:id/review",
  requirePermission("expenses:approve"),
  validate(
    z.object({
      decision: z.enum(["approved", "rejected"]),
      note: z.string().trim().max(500).optional(),
    }),
  ),
  ah(async (req, res) => {
    const e = await Expense.findOne({ _id: req.params.id, ...orgScope(req) });
    if (!e) throw notFound("Expense not found");
    if (e.status !== "pending")
      throw conflict(`This expense is already ${e.status}`);
    if (String(e.submittedBy) === String(req.user._id))
      throw forbidden("You can't review your own expense");
    if (req.body.decision === "rejected" && !req.body.note)
      throw badRequest("Give a reason for rejecting");
    Object.assign(e, {
      status: req.body.decision,
      reviewedBy: req.user._id,
      reviewedAt: new Date(),
      reviewNote: req.body.note,
    });
    await e.save();
    await audit(req, "expense.review", "Expense", e.id, { decision: e.status });
    res.json({ success: true, data: e });
  }),
);

r.delete(
  "/:id",
  requirePermission("expenses:write"),
  ah(async (req, res) => {
    const e = await Expense.findOne({ _id: req.params.id, ...orgScope(req) });
    if (!e) throw notFound("Expense not found");
    if (e.status !== "pending")
      throw conflict("Only pending expenses can be deleted");
    if (
      String(e.submittedBy) !== String(req.user._id) &&
      !can(req.user.role, "expenses:approve")
    )
      throw forbidden("Only the submitter can delete this expense");
    await e.deleteOne();
    await audit(req, "expense.delete", "Expense", e.id);
    res.json({ success: true });
  }),
);

// Cost roll-up per vehicle for a date range: fuel + completed maintenance + APPROVED expenses only.
r.get(
  "/costs/summary",
  requirePermission("expenses:read"),
  validate(z.object({ from: z.coerce.date(), to: z.coerce.date() }), "query"),
  ah(async (req, res) => {
    const { from, to } = req.query;
    if (to < from) throw badRequest("'to' is before 'from'");
    const org = req.user.organization;
    const [fuel, maint, exp] = await Promise.all([
      FuelLog.aggregate([
        { $match: { organization: org, filledAt: { $gte: from, $lte: to } } },
        { $group: { _id: "$vehicle", total: { $sum: "$totalAmount" } } },
      ]),
      Maintenance.aggregate([
        {
          $match: {
            organization: org,
            status: "completed",
            serviceDate: { $gte: from, $lte: to },
          },
        },
        { $group: { _id: "$vehicle", total: { $sum: "$cost" } } },
      ]),
      Expense.aggregate([
        {
          $match: {
            organization: org,
            status: "approved",
            date: { $gte: from, $lte: to },
          },
        },
        { $group: { _id: "$vehicle", total: { $sum: "$amount" } } },
      ]),
    ]);
    const rows = new Map();
    const add = (list, key) =>
      list.forEach((x) => {
        const k = String(x._id ?? "none");
        rows.set(k, {
          ...(rows.get(k) ?? {
            vehicleId: x._id ?? null,
            fuel: 0,
            maintenance: 0,
            expenses: 0,
          }),
          [key]: Math.round(x.total * 100) / 100,
        });
      });
    add(fuel, "fuel");
    add(maint, "maintenance");
    add(exp, "expenses");
    const vehicles = await Vehicle.find({
      organization: org,
      _id: { $in: [...rows.values()].map((x) => x.vehicleId).filter(Boolean) },
    })
      .select("registrationNumber")
      .lean();
    const name = new Map(
      vehicles.map((v) => [String(v._id), v.registrationNumber]),
    );
    const data = [...rows.values()].map((x) => ({
      ...x,
      registrationNumber: x.vehicleId
        ? name.get(String(x.vehicleId))
        : "Not vehicle-specific",
      total: Math.round((x.fuel + x.maintenance + x.expenses) * 100) / 100,
    }));
    const totals = data.reduce(
      (a, x) => ({
        fuel: a.fuel + x.fuel,
        maintenance: a.maintenance + x.maintenance,
        expenses: a.expenses + x.expenses,
      }),
      { fuel: 0, maintenance: 0, expenses: 0 },
    );
    res.json({
      success: true,
      data: {
        rows: data,
        totals,
        note: "Expenses count only once approved; maintenance counts only when completed.",
      },
    });
  }),
);

export default r;
