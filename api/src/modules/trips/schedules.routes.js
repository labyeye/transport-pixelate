import { Router } from "express";
import { z } from "zod";
import { TripSchedule } from "../../models/TripSchedule.js";
import { Trip } from "../../models/Trip.js";
import { Organization } from "../../models/Organization.js";
import { protect, requirePermission, orgScope } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import { badRequest, notFound } from "../../utils/errors.js";
import { audit } from "../../models/AuditLog.js";
import { dayOfWeek, eachDate, zonedToUtc } from "../../utils/time.js";
import { buildSnapshot, createTrip } from "./trip.service.js";
import { HttpError } from "../../utils/errors.js";

const r = Router();
r.use(protect);

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const body = z
  .object({
    name: z.string().trim().min(2).max(120),
    route: id,
    tripType: z
      .enum(["morning", "afternoon", "outbound", "return", "custom"])
      .default("custom"),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
    startDate: ymd,
    endDate: ymd.optional(),
    departureTime: hhmm,
    durationMin: z.coerce.number().int().min(1).max(1440),
    vehicle: id.nullable().optional(),
    driver: id.nullable().optional(),
    attendant: id.nullable().optional(),
  })
  .refine((b) => !b.endDate || b.endDate >= b.startDate, {
    message: "End date is before start date",
    path: ["endDate"],
  });

r.get(
  "/",
  requirePermission("trips:read"),
  ah(async (req, res) => {
    const items = await TripSchedule.find({
      ...orgScope(req),
      archivedAt: null,
    })
      .populate("route", "name code")
      .populate("vehicle", "registrationNumber")
      .populate("driver", "name")
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ success: true, data: items });
  }),
);

r.post(
  "/",
  requirePermission("trips:write"),
  validate(body),
  ah(async (req, res) => {
    await buildSnapshot(req.user.organization, req.body.route); // route must exist and be usable
    const s = await TripSchedule.create({ ...req.body, ...orgScope(req) });
    await audit(req, "schedule.create", "TripSchedule", s.id);
    res.status(201).json({ success: true, data: s });
  }),
);

r.patch(
  "/:id/active",
  requirePermission("trips:write"),
  validate(z.object({ active: z.boolean() })),
  ah(async (req, res) => {
    const s = await TripSchedule.findOneAndUpdate(
      { _id: req.params.id, ...orgScope(req), archivedAt: null },
      { active: req.body.active },
      { new: true },
    );
    if (!s) throw notFound("Schedule not found");
    res.json({ success: true, data: s });
  }),
);

r.delete(
  "/:id",
  requirePermission("trips:write"),
  ah(async (req, res) => {
    const s = await TripSchedule.findOneAndUpdate(
      { _id: req.params.id, ...orgScope(req), archivedAt: null },
      { archivedAt: new Date(), active: false },
    );
    if (!s) throw notFound("Schedule not found");
    res.json({ success: true });
  }),
);

// Controlled generation: bounded range, idempotent per (schedule, date), conflicts reported not hidden.
const MAX_DAYS = 62;
r.post(
  "/:id/generate",
  requirePermission("trips:write"),
  validate(z.object({ from: ymd, to: ymd })),
  ah(async (req, res) => {
    const { from, to } = req.body;
    if (to < from) throw badRequest("'to' is before 'from'");
    const s = await TripSchedule.findOne({
      _id: req.params.id,
      ...orgScope(req),
      archivedAt: null,
    });
    if (!s) throw notFound("Schedule not found");
    if (!s.active) throw badRequest("Schedule is inactive");
    const org = req.user.organization;
    const tz = (await Organization.findById(org).select("timezone")).timezone;
    const created = [],
      skipped = [];
    let count = 0;
    for (const date of eachDate(from, to)) {
      if (++count > MAX_DAYS)
        throw badRequest(`Generate at most ${MAX_DAYS} days at a time`);
      if (
        date < s.startDate ||
        (s.endDate && date > s.endDate) ||
        !s.daysOfWeek.includes(dayOfWeek(date))
      )
        continue;
      const key = `${s.id}:${date}`;
      if (await Trip.exists({ organization: org, generatedKey: key })) {
        skipped.push({ date, reason: "already generated" });
        continue;
      }
      const start = zonedToUtc(date, s.departureTime, tz);
      const input = {
        route: s.route,
        tripType: s.tripType,
        scheduledDate: date,
        scheduledDeparture: start,
        expectedArrival: new Date(start.getTime() + s.durationMin * 60000),
      };
      try {
        const trip = await createTrip(
          org,
          req.user._id,
          {
            ...input,
            vehicle: s.vehicle,
            driver: s.driver,
            attendant: s.attendant,
          },
          { schedule: s._id, generatedKey: key },
        );
        created.push({ date, tripNumber: trip.tripNumber });
      } catch (e) {
        if (e?.code === 11000) {
          skipped.push({ date, reason: "already generated" });
          continue;
        }
        if (!(e instanceof HttpError)) throw e;
        // Resource conflict: still create the trip, unassigned, so the dispatcher sees the gap.
        try {
          const trip = await createTrip(org, req.user._id, input, {
            schedule: s._id,
            generatedKey: key,
          });
          skipped.push({
            date,
            reason: `created unassigned: ${e.message}`,
            tripNumber: trip.tripNumber,
          });
        } catch (e2) {
          skipped.push({ date, reason: e2.message });
        }
      }
    }
    await audit(req, "schedule.generate", "TripSchedule", s.id, {
      from,
      to,
      created: created.length,
    });
    res.json({ success: true, data: { created, skipped } });
  }),
);

export default r;
