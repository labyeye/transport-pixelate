import { Router } from "express";
import { Vehicle } from "../../models/Vehicle";
import { Driver } from "../../models/Driver";
import { protect, requirePermission, orgScope } from "../../middleware/auth";
import { ah } from "../../utils/asyncHandler";

const r = Router();
r.use(protect);

const DOC_KEYS = ["insurance", "registration", "fitness", "permit", "pollution"] as const;

// All numbers come from real records. Trip/maintenance metrics will be added as those modules land.
r.get("/", requirePermission("vehicles:read"), ah(async (req, res) => {
  const scope = { ...orgScope(req), archivedAt: null };
  const soon = new Date(Date.now() + 30 * 86400000);
  const now = new Date();

  const [vehicleStatus, driverStatus, vehicles, drivers] = await Promise.all([
    Vehicle.aggregate([{ $match: scope }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    Driver.aggregate([{ $match: scope }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    Vehicle.find(scope).select("registrationNumber documents").lean(),
    Driver.find(scope).select("name licence").lean(),
  ]);
  const count = (rows: { _id: string; n: number }[], k: string) => rows.find((x) => x._id === k)?.n ?? 0;
  const sum = (rows: { n: number }[]) => rows.reduce((a, b) => a + b.n, 0);

  const expiries: { kind: "vehicle" | "driver"; label: string; document: string; expiryDate: Date; expired: boolean }[] = [];
  for (const v of vehicles) {
    for (const k of DOC_KEYS) {
      const exp = (v.documents as any)?.[k]?.expiryDate as Date | undefined;
      if (exp && exp <= soon) expiries.push({ kind: "vehicle", label: v.registrationNumber, document: k, expiryDate: exp, expired: exp < now });
    }
  }
  for (const d of drivers) {
    const exp = d.licence?.expiryDate;
    if (exp && exp <= soon) expiries.push({ kind: "driver", label: d.name, document: "licence", expiryDate: exp, expired: exp < now });
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
      expiries: expiries.slice(0, 20),
    },
  });
}));

export default r;
