import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import { Vehicle, VEHICLE_STATUSES } from "../../models/Vehicle.js";
import { Driver } from "../../models/Driver.js";
import { protect, requirePermission, orgScope } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import { badRequest, conflict, notFound } from "../../utils/errors.js";
import { escapeRegex, meta, pageQuery } from "../../utils/pagination.js";
import { audit } from "../../models/AuditLog.js";
import { assertVehicleQuota } from "../saas/subscription.service.js";
const r = Router();
r.use(protect);
// Indian registration format, e.g. MH12AB1234 / DL1CAB1234 (spaces/hyphens stripped first).
const REG_RE = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/;
const normReg = (s) => s.replace(/[\s-]/g, "").toUpperCase();
const docSchema = z
  .object({
    number: z.string().trim().max(60).optional(),
    issueDate: z.coerce.date().optional(),
    expiryDate: z.coerce.date().optional(),
    verified: z.boolean().optional(),
  })
  .optional();
const vehicleBody = z.object({
  registrationNumber: z
    .string()
    .transform(normReg)
    .refine((s) => REG_RE.test(s), "Invalid registration number"),
  fleetNumber: z.string().trim().max(30).optional(),
  category: z.string().trim().min(1).max(40).default("bus"),
  make: z.string().trim().max(60).optional(),
  model: z.string().trim().max(60).optional(),
  year: z.coerce
    .number()
    .int()
    .min(1980)
    .max(new Date().getFullYear() + 1)
    .optional(),
  capacity: z.coerce.number().int().min(1).max(200),
  fuelType: z
    .enum(["diesel", "petrol", "cng", "electric", "hybrid", "other"])
    .default("diesel"),
  tankCapacity: z.coerce.number().min(0).optional(),
  odometer: z.coerce.number().min(0).default(0),
  ownership: z.enum(["owned", "leased", "contracted"]).default("owned"),
  branch: z.string().trim().max(80).optional(),
  gpsDevice: z
    .object({
      provider: z.string().max(40).optional(),
      deviceId: z.string().max(80).optional(),
    })
    .optional(),
  documents: z
    .object({
      insurance: docSchema,
      registration: docSchema,
      fitness: docSchema,
      permit: docSchema,
      pollution: docSchema,
    })
    .optional(),
  notes: z.string().max(2000).optional(),
});
const listQuery = pageQuery.extend({
  status: z.enum(VEHICLE_STATUSES).optional(),
  category: z.string().optional(),
  branch: z.string().optional(),
  driver: z.string().optional(),
});
r.get(
  "/",
  requirePermission("vehicles:read"),
  validate(listQuery, "query"),
  ah(async (req, res) => {
    const q = req.query;
    const filter = { ...orgScope(req), archivedAt: null };
    if (q.status) filter.status = q.status;
    if (q.category) filter.category = q.category;
    if (q.branch) filter.branch = q.branch;
    if (q.driver && Types.ObjectId.isValid(q.driver))
      filter.assignedDriver = q.driver;
    if (q.search)
      filter.registrationNumber = new RegExp(
        escapeRegex(normReg(q.search)),
        "i",
      );
    const [items, total] = await Promise.all([
      Vehicle.find(filter)
        .populate("assignedDriver", "name phone")
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      Vehicle.countDocuments(filter),
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
  requirePermission("vehicles:write"),
  validate(vehicleBody),
  ah(async (req, res) => {
    const exists = await Vehicle.exists({
      ...orgScope(req),
      registrationNumber: req.body.registrationNumber,
      archivedAt: null,
    });
    if (exists)
      throw conflict("A vehicle with this registration number already exists");
    await assertVehicleQuota(req.user.organization);
    const v = await Vehicle.create({ ...req.body, ...orgScope(req) });
    await audit(req, "vehicle.create", "Vehicle", v.id);
    res.status(201).json({ success: true, data: v });
  }),
);
r.get(
  "/:id",
  requirePermission("vehicles:read"),
  ah(async (req, res) => {
    const v = await Vehicle.findOne({
      _id: req.params.id,
      ...orgScope(req),
    }).populate("assignedDriver", "name phone licence");
    if (!v) throw notFound("Vehicle not found");
    res.json({ success: true, data: v });
  }),
);
r.put(
  "/:id",
  requirePermission("vehicles:write"),
  validate(vehicleBody.partial()),
  ah(async (req, res) => {
    const v = await Vehicle.findOne({
      _id: req.params.id,
      ...orgScope(req),
      archivedAt: null,
    });
    if (!v) throw notFound("Vehicle not found");
    if (
      req.body.registrationNumber &&
      req.body.registrationNumber !== v.registrationNumber
    ) {
      if (
        await Vehicle.exists({
          ...orgScope(req),
          registrationNumber: req.body.registrationNumber,
          archivedAt: null,
          _id: { $ne: v._id },
        })
      )
        throw conflict(
          "A vehicle with this registration number already exists",
        );
    }
    v.set(req.body);
    await v.save();
    await audit(req, "vehicle.update", "Vehicle", v.id);
    res.json({ success: true, data: v });
  }),
);
// Status changes are explicit. A vehicle with an assigned driver can't be marked unavailable
// without unassigning first, and "on_trip" is controlled by the trip workflow only.
const MANUAL_STATUSES = [
  "available",
  "maintenance",
  "out_of_service",
  "inactive",
];
r.patch(
  "/:id/status",
  requirePermission("vehicles:write"),
  validate(z.object({ status: z.enum(MANUAL_STATUSES) })),
  ah(async (req, res) => {
    const v = await Vehicle.findOne({
      _id: req.params.id,
      ...orgScope(req),
      archivedAt: null,
    });
    if (!v) throw notFound("Vehicle not found");
    if (v.status === "on_trip")
      throw conflict("Vehicle is on a trip; complete or abort the trip first");
    const target = req.body.status;
    if (target !== "available" && v.assignedDriver)
      throw conflict("Unassign the driver before changing status");
    v.status = target;
    await v.save();
    await audit(req, "vehicle.status", "Vehicle", v.id, { status: target });
    res.json({ success: true, data: v });
  }),
);
// Assign / unassign a driver. Both sides of the link are kept consistent.
r.post(
  "/:id/assign-driver",
  requirePermission("vehicles:write", "drivers:write"),
  validate(z.object({ driverId: z.string().nullable() })),
  ah(async (req, res) => {
    const v = await Vehicle.findOne({
      _id: req.params.id,
      ...orgScope(req),
      archivedAt: null,
    });
    if (!v) throw notFound("Vehicle not found");
    if (v.status === "on_trip")
      throw conflict("Cannot change driver while the vehicle is on a trip");
    const { driverId } = req.body;
    if (v.assignedDriver)
      await Driver.updateOne(
        { _id: v.assignedDriver, ...orgScope(req) },
        { assignedVehicle: null },
      );
    if (!driverId) {
      v.assignedDriver = null;
      if (v.status === "assigned") v.status = "available";
    } else {
      if (!Types.ObjectId.isValid(driverId)) throw badRequest("Invalid driver");
      if (["maintenance", "out_of_service", "inactive"].includes(v.status))
        throw conflict(
          `Vehicle is ${v.status.replace("_", " ")} and cannot be assigned`,
        );
      const d = await Driver.findOne({
        _id: driverId,
        ...orgScope(req),
        archivedAt: null,
      });
      if (!d) throw notFound("Driver not found");
      if (["suspended", "inactive", "on_leave"].includes(d.status))
        throw conflict(
          `Driver is ${d.status.replace("_", " ")} and cannot be assigned`,
        );
      if (d.assignedVehicle && String(d.assignedVehicle) !== v.id) {
        await Vehicle.updateOne(
          { _id: d.assignedVehicle, ...orgScope(req) },
          { assignedDriver: null, status: "available" },
        );
      }
      d.assignedVehicle = v._id;
      await d.save();
      v.assignedDriver = d._id;
      v.status = "assigned";
    }
    await v.save();
    await audit(req, "vehicle.assign_driver", "Vehicle", v.id, { driverId });
    res.json({ success: true, data: v });
  }),
);
// Archive (soft delete). Blocked while the vehicle is on a trip or has an assigned driver.
r.delete(
  "/:id",
  requirePermission("vehicles:write"),
  ah(async (req, res) => {
    const v = await Vehicle.findOne({
      _id: req.params.id,
      ...orgScope(req),
      archivedAt: null,
    });
    if (!v) throw notFound("Vehicle not found");
    if (v.status === "on_trip")
      throw conflict("Vehicle is on a trip and cannot be archived");
    if (v.assignedDriver)
      throw conflict("Unassign the driver before archiving");
    v.archivedAt = new Date();
    v.status = "inactive";
    await v.save();
    await audit(req, "vehicle.archive", "Vehicle", v.id);
    res.json({ success: true });
  }),
);
export default r;
