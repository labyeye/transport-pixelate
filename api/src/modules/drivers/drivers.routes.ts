import { Router } from "express";
import { z } from "zod";
import { Driver, DRIVER_STATUSES } from "../../models/Driver";
import { Vehicle } from "../../models/Vehicle";
import { protect, requirePermission, orgScope } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { ah } from "../../utils/asyncHandler";
import { conflict, notFound } from "../../utils/errors";
import { escapeRegex, meta, pageQuery } from "../../utils/pagination";
import { audit } from "../../models/AuditLog";

const r = Router();
r.use(protect);

const phone = z.string().trim().regex(/^[+\d][\d\s-]{7,15}$/, "Invalid phone number");

const body = z.object({
  staffRole: z.enum(["driver", "attendant", "dispatcher", "other"]).default("driver"),
  name: z.string().trim().min(2).max(100),
  phone,
  email: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  address: z.string().max(300).optional(),
  emergencyContact: z.object({ name: z.string().max(100).optional(), phone: phone.optional() }).optional(),
  licence: z
    .object({ number: z.string().trim().max(30).optional(), class: z.string().max(20).optional(), expiryDate: z.coerce.date().optional() })
    .optional(),
  joiningDate: z.coerce.date().optional(),
  employmentType: z.enum(["employee", "contract"]).default("employee"),
  branch: z.string().trim().max(80).optional(),
}).refine((d) => d.staffRole !== "driver" || (d.licence?.number && d.licence?.expiryDate), {
  message: "Licence number and expiry date are required for drivers",
  path: ["licence"],
});

const listQuery = pageQuery.extend({
  status: z.enum(DRIVER_STATUSES).optional(),
  staffRole: z.enum(["driver", "attendant", "dispatcher", "other"]).optional(),
});

r.get("/", requirePermission("drivers:read"), validate(listQuery, "query"), ah(async (req, res) => {
  const q = req.query as unknown as z.infer<typeof listQuery>;
  const filter: Record<string, unknown> = { ...orgScope(req), archivedAt: null };
  if (q.status) filter.status = q.status;
  if (q.staffRole) filter.staffRole = q.staffRole;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), "i");
    filter.$or = [{ name: rx }, { phone: rx }, { "licence.number": rx }];
  }
  const [items, total] = await Promise.all([
    Driver.find(filter).populate("assignedVehicle", "registrationNumber").sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
    Driver.countDocuments(filter),
  ]);
  res.json({ success: true, data: items, meta: meta(q.page, q.limit, total) });
}));

r.post("/", requirePermission("drivers:write"), validate(body), ah(async (req, res) => {
  const lic = req.body.licence?.number;
  if (lic && (await Driver.exists({ ...orgScope(req), "licence.number": lic.toUpperCase(), archivedAt: null })))
    throw conflict("A driver with this licence number already exists");
  const d = await Driver.create({ ...req.body, ...orgScope(req) });
  await audit(req, "driver.create", "Driver", d.id);
  res.status(201).json({ success: true, data: d });
}));

r.get("/:id", requirePermission("drivers:read"), ah(async (req, res) => {
  const d = await Driver.findOne({ _id: req.params.id, ...orgScope(req) }).populate("assignedVehicle", "registrationNumber status");
  if (!d) throw notFound("Driver not found");
  res.json({ success: true, data: d });
}));

r.put("/:id", requirePermission("drivers:write"), validate(body), ah(async (req, res) => {
  const d = await Driver.findOne({ _id: req.params.id, ...orgScope(req), archivedAt: null });
  if (!d) throw notFound("Driver not found");
  const lic = req.body.licence?.number?.toUpperCase();
  if (lic && lic !== d.licence?.number && (await Driver.exists({ ...orgScope(req), "licence.number": lic, archivedAt: null, _id: { $ne: d._id } })))
    throw conflict("A driver with this licence number already exists");
  d.set(req.body);
  await d.save();
  await audit(req, "driver.update", "Driver", d.id);
  res.json({ success: true, data: d });
}));

r.patch("/:id/status", requirePermission("drivers:write"), validate(z.object({ status: z.enum(DRIVER_STATUSES) })), ah(async (req, res) => {
  const d = await Driver.findOne({ _id: req.params.id, ...orgScope(req), archivedAt: null });
  if (!d) throw notFound("Driver not found");
  const next = req.body.status as (typeof DRIVER_STATUSES)[number];
  // A driver on an active trip stays "on_duty" until the trip workflow releases them.
  if (d.status === "on_duty" && next !== "on_duty") {
    const onTrip = d.assignedVehicle && (await Vehicle.exists({ _id: d.assignedVehicle, ...orgScope(req), status: "on_trip" }));
    if (onTrip) throw conflict("Driver is on a trip; complete the trip first");
  }
  d.status = next;
  await d.save();
  await audit(req, "driver.status", "Driver", d.id, { status: next });
  res.json({ success: true, data: d });
}));

r.delete("/:id", requirePermission("drivers:write"), ah(async (req, res) => {
  const d = await Driver.findOne({ _id: req.params.id, ...orgScope(req), archivedAt: null });
  if (!d) throw notFound("Driver not found");
  if (d.assignedVehicle) throw conflict("Unassign the vehicle before archiving this driver");
  d.archivedAt = new Date();
  d.status = "inactive";
  await d.save();
  await audit(req, "driver.archive", "Driver", d.id);
  res.json({ success: true });
}));

export default r;
