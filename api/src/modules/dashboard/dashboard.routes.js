import { Router } from "express";
import { Vehicle } from "../../models/Vehicle.js";
import { Driver } from "../../models/Driver.js";
import { protect, requirePermission, orgScope } from "../../middleware/auth.js";
import { Trip } from "../../models/Trip.js";
import { Organization } from "../../models/Organization.js";
import { dateInZone } from "../../utils/time.js";
import { ah } from "../../utils/asyncHandler.js";
const r = Router();
r.use(protect);
const DOC_KEYS = [
  "insurance",
  "registration",
  "fitness",
  "permit",
  "pollution",
];
// All numbers come from real records. Trip/maintenance metrics will be added as those modules land.
r.get(
  "/",
  requirePermission("vehicles:read"),
  ah(async (req, res) => {
    const scope = { ...orgScope(req), archivedAt: null };
    const soon = new Date(Date.now() + 30 * 86400000);
    const now = new Date();
    const tz = (
      await Organization.findById(req.user.organization).select("timezone")
    ).timezone;
    const today = dateInZone(now, tz);
    const [vehicleStatus, driverStatus, vehicles, drivers, tripStatus] =
      await Promise.all([
        Vehicle.aggregate([
          { $match: scope },
          { $group: { _id: "$status", n: { $sum: 1 } } },
        ]),
        Driver.aggregate([
          { $match: scope },
          { $group: { _id: "$status", n: { $sum: 1 } } },
        ]),
        Vehicle.find(scope).select("registrationNumber documents").lean(),
        Driver.find(scope).select("name licence").lean(),
        Trip.aggregate([
          { $match: { ...orgScope(req), scheduledDate: today } },
          { $group: { _id: "$status", n: { $sum: 1 } } },
        ]),
      ]);
    const count = (rows, k) => rows.find((x) => x._id === k)?.n ?? 0;
    const sum = (rows) => rows.reduce((a, b) => a + b.n, 0);
    const expiries = [];
    for (const v of vehicles) {
      for (const k of DOC_KEYS) {
        const exp = v.documents?.[k]?.expiryDate;
        if (exp && exp <= soon)
          expiries.push({
            kind: "vehicle",
            label: v.registrationNumber,
            document: k,
            expiryDate: exp,
            expired: exp < now,
          });
      }
    }
    for (const d of drivers) {
      const exp = d.licence?.expiryDate;
      if (exp && exp <= soon)
        expiries.push({
          kind: "driver",
          label: d.name,
          document: "licence",
          expiryDate: exp,
          expired: exp < now,
        });
    }
    expiries.sort((a, b) => +a.expiryDate - +b.expiryDate);
    res.json({
      success: true,
      data: {
        vehicles: {
          total: sum(vehicleStatus),
          available: count(vehicleStatus, "available"),
          assigned: count(vehicleStatus, "assigned"),
          onTrip: count(vehicleStatus, "on_trip"),
          maintenance: count(vehicleStatus, "maintenance"),
          outOfService: count(vehicleStatus, "out_of_service"),
        },
        drivers: {
          total: sum(driverStatus),
          onDuty: count(driverStatus, "on_duty"),
          onLeave: count(driverStatus, "on_leave"),
        },
        trips: {
          today: sum(tripStatus),
          scheduled:
            count(tripStatus, "scheduled") +
            count(tripStatus, "assigned") +
            count(tripStatus, "ready"),
          inProgress: count(tripStatus, "in_progress"),
          delayed: count(tripStatus, "delayed"),
          completed: count(tripStatus, "completed"),
          cancelled:
            count(tripStatus, "cancelled") + count(tripStatus, "aborted"),
        },
        expiries: expiries.slice(0, 20),
      },
    });
  }),
);
export default r;
