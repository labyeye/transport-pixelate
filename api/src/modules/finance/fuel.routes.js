import { Router } from "express";
import { z } from "zod";
import { FuelLog } from "../../models/FuelLog.js";
import { Vehicle } from "../../models/Vehicle.js";
import { Trip } from "../../models/Trip.js";
import { protect, requirePermission, orgScope } from "../../middleware/auth.js";
import { requireModule } from "../../middleware/requireModule.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import { badRequest, conflict, notFound } from "../../utils/errors.js";
import { meta, pageQuery } from "../../utils/pagination.js";
import { audit } from "../../models/AuditLog.js";

const r = Router();
r.use(protect, requireModule("fuelExpenses"));
const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const round2 = (n) => Math.round(n * 100) / 100;

const body = z.object({
  vehicle: id,
  trip: id.optional(),
  filledAt: z.coerce.date(),
  quantity: z.coerce.number().positive().max(2000),
  pricePerUnit: z.coerce.number().min(0).max(1000),
  totalAmount: z.coerce.number().min(0).optional(),
  odometer: z.coerce.number().min(0),
  fullTank: z.boolean().default(false),
  station: z.string().trim().max(120).optional(),
  clientRef: z.string().trim().min(8).max(80).optional(),
});

// The server computes/validates the total; a client-supplied total that disagrees is rejected.
function checkTotal(b) {
  const expected = round2(b.quantity * b.pricePerUnit);
  if (b.totalAmount == null) return expected;
  if (Math.abs(b.totalAmount - expected) > 1)
    throw badRequest(
      `Total ${b.totalAmount} doesn't match quantity × price (${expected})`,
    );
  return round2(b.totalAmount);
}

async function checkOdometer(org, vehicleId, filledAt, odometer, excludeId) {
  const base = {
    organization: org,
    vehicle: vehicleId,
    ...(excludeId && { _id: { $ne: excludeId } }),
  };
  const [prev, next] = await Promise.all([
    FuelLog.findOne({ ...base, filledAt: { $lte: filledAt } })
      .sort({ filledAt: -1 })
      .select("odometer filledAt"),
    FuelLog.findOne({ ...base, filledAt: { $gt: filledAt } })
      .sort({ filledAt: 1 })
      .select("odometer filledAt"),
  ]);
  if (prev && odometer < prev.odometer)
    throw badRequest(
      `Odometer is lower than the earlier fill (${prev.odometer} km)`,
    );
  if (next && odometer > next.odometer)
    throw badRequest(
      `Odometer is higher than a later fill (${next.odometer} km)`,
    );
}

const listQuery = pageQuery.extend({
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
    if (q.vehicle) filter.vehicle = q.vehicle;
    if (q.from || q.to)
      filter.filledAt = {
        ...(q.from && { $gte: q.from }),
        ...(q.to && { $lte: q.to }),
      };
    const [items, total] = await Promise.all([
      FuelLog.find(filter)
        .populate("vehicle", "registrationNumber")
        .populate("recordedBy", "name")
        .sort({ filledAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      FuelLog.countDocuments(filter),
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
    const org = req.user.organization;
    if (b.clientRef) {
      const dup = await FuelLog.findOne({
        organization: org,
        clientRef: b.clientRef,
      });
      if (dup) return res.json({ success: true, data: dup, duplicate: true });
    }
    const v = await Vehicle.findOne({
      _id: b.vehicle,
      ...orgScope(req),
      archivedAt: null,
    });
    if (!v) throw notFound("Vehicle not found");
    if (b.trip && !(await Trip.exists({ _id: b.trip, ...orgScope(req) })))
      throw notFound("Trip not found");
    if (+b.filledAt > Date.now() + 5 * 60000)
      throw badRequest("Fill time is in the future");
    // Same vehicle, time and quantity is almost certainly a double submit.
    if (
      await FuelLog.exists({
        organization: org,
        vehicle: v._id,
        filledAt: b.filledAt,
        quantity: b.quantity,
      })
    )
      throw conflict("This fill has already been recorded");
    await checkOdometer(org, v._id, b.filledAt, b.odometer);
    const total = checkTotal(b);
    const { totalAmount, ...rest } = b;
    const log = await FuelLog.create({
      ...rest,
      totalAmount: total,
      fuelType: v.fuelType,
      organization: org,
      recordedBy: req.user._id,
    });
    if (b.odometer > v.odometer) {
      v.odometer = b.odometer;
      await v.save();
    }
    await audit(req, "fuel.create", "FuelLog", log.id);
    res.status(201).json({ success: true, data: log });
  }),
);

r.put(
  "/:id",
  requirePermission("expenses:write"),
  validate(body.omit({ vehicle: true, clientRef: true })),
  ah(async (req, res) => {
    const log = await FuelLog.findOne({ _id: req.params.id, ...orgScope(req) });
    if (!log) throw notFound("Fuel record not found");
    await checkOdometer(
      req.user.organization,
      log.vehicle,
      req.body.filledAt,
      req.body.odometer,
      log._id,
    );
    const total = checkTotal(req.body);
    const { totalAmount, ...rest } = req.body;
    log.set({ ...rest, totalAmount: total });
    await log.save();
    await audit(req, "fuel.update", "FuelLog", log.id);
    res.json({ success: true, data: log });
  }),
);

r.delete(
  "/:id",
  requirePermission("expenses:approve"),
  ah(async (req, res) => {
    const log = await FuelLog.findOneAndDelete({
      _id: req.params.id,
      ...orgScope(req),
    });
    if (!log) throw notFound("Fuel record not found");
    await audit(req, "fuel.delete", "FuelLog", log.id, {
      amount: log.totalAmount,
    });
    res.json({ success: true });
  }),
);

// Measured efficiency only: km between two consecutive FULL-tank fills divided by the litres of the later fill.
// Partial fills break the measurement, so intervals that include one are reported as not measurable.
r.get(
  "/efficiency",
  requirePermission("expenses:read"),
  validate(z.object({ vehicle: id }), "query"),
  ah(async (req, res) => {
    const v = await Vehicle.findOne({
      _id: req.query.vehicle,
      ...orgScope(req),
    }).select("registrationNumber");
    if (!v) throw notFound("Vehicle not found");
    const logs = await FuelLog.find({ ...orgScope(req), vehicle: v._id })
      .sort({ filledAt: 1 })
      .lean();
    const intervals = [];
    let anchor = null;
    let litres = 0;
    for (const l of logs) {
      if (anchor) litres += l.quantity;
      if (!l.fullTank) continue;
      if (anchor) {
        const km = l.odometer - anchor.odometer;
        if (km > 0 && litres > 0)
          intervals.push({
            from: anchor.filledAt,
            to: l.filledAt,
            km,
            litres: round2(litres),
            kmPerUnit: round2(km / litres),
          });
      }
      anchor = l;
      litres = 0;
    }
    const totalKm = intervals.reduce((a, b) => a + b.km, 0);
    const totalL = intervals.reduce((a, b) => a + b.litres, 0);
    res.json({
      success: true,
      data: {
        vehicle: v,
        intervals,
        averageKmPerUnit: totalL ? round2(totalKm / totalL) : null,
        basis: "measured between consecutive full-tank fills",
      },
    });
  }),
);

export default r;
