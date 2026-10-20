import { Document } from "../../models/Document.js";
import { Vehicle } from "../../models/Vehicle.js";
import { Driver } from "../../models/Driver.js";
import { Expense } from "../../models/Expense.js";
import { Maintenance } from "../../models/Maintenance.js";
import { FuelLog } from "../../models/FuelLog.js";
import { TransportRequest } from "../../models/TransportRequest.js";
import { can } from "../../utils/permissions.js";
import { forbidden } from "../../utils/errors.js";
import { Organization } from "../../models/Organization.js";

export const DAY = 86400000;

// Which permission guards each kind of owner (read / write).
export const OWNER_PERMS = {
  request: ["requests:create", "requests:create"],
  vehicle: ["vehicles:read", "vehicles:write"],
  driver: ["drivers:read", "drivers:write"],
  organization: ["vehicles:read", "settings:write"],
  expense: ["expenses:read", "expenses:write"],
  maintenance: ["maintenance:read", "maintenance:write"],
  fuel: ["expenses:read", "expenses:write"],
};
const MODELS = {
  request: TransportRequest,
  vehicle: Vehicle,
  driver: Driver,
  expense: Expense,
  maintenance: Maintenance,
  fuel: FuelLog,
};

export async function ownerExists(org, ownerType, owner) {
  if (ownerType === "organization") return true;
  const M = MODELS[ownerType];
  return !!(owner && (await M.exists({ _id: owner, organization: org })));
}

/** valid | expiring_soon | expired | no_expiry — always derived from the expiry date, never stored. */
export function expiryStatus(expiryDate, soonDays, now = Date.now()) {
  if (!expiryDate) return "no_expiry";
  const t = +new Date(expiryDate);
  if (t < now) return "expired";
  return t <= now + soonDays * DAY ? "expiring_soon" : "valid";
}
export const daysLeft = (expiryDate, now = Date.now()) =>
  Math.ceil((+new Date(expiryDate) - now) / DAY);

export async function soonWindow(org) {
  const o = await Organization.findById(org).select("docReminderDays");
  const days = o?.docReminderDays?.length ? o.docReminderDays : [30, 15, 7];
  return { days, soonDays: Math.max(...days) };
}

const VEHICLE_FIELDS = [
  "insurance",
  "registration",
  "fitness",
  "permit",
  "pollution",
];

/** Keep the legacy expiry fields (used by the dashboard/vehicle form) in step with the newest document. */
export async function syncOwnerFields(doc) {
  if (doc.archivedAt || !doc.expiryDate) return;
  if (doc.ownerType === "vehicle" && VEHICLE_FIELDS.includes(doc.type)) {
    const v = await Vehicle.findOne({
      _id: doc.owner,
      organization: doc.organization,
    });
    const cur = v?.documents?.[doc.type]?.expiryDate;
    if (v && (!cur || cur <= doc.expiryDate)) {
      v.set(`documents.${doc.type}`, {
        number: doc.number,
        issueDate: doc.issueDate,
        expiryDate: doc.expiryDate,
        verified: doc.verification === "verified",
      });
      await v.save();
    }
  }
  if (doc.ownerType === "driver" && doc.type === "licence") {
    const d = await Driver.findOne({
      _id: doc.owner,
      organization: doc.organization,
    });
    const cur = d?.licence?.expiryDate;
    if (d && (!cur || cur <= doc.expiryDate)) {
      d.set("licence.expiryDate", doc.expiryDate);
      if (doc.number) d.set("licence.number", doc.number.toUpperCase());
      await d.save();
    }
  }
}

/**
 * Documents that hit a reminder threshold today (days left equals one of the configured intervals,
 * or it expired within the last day). The notifications job (Phase 9) calls this and de-duplicates
 * on `${documentId}:${threshold}`.
 */
export async function findReminderDue(org, now = Date.now()) {
  const { days } = await soonWindow(org);
  const docs = await Document.find({
    organization: org,
    archivedAt: null,
    expiryDate: { $ne: null, $lte: new Date(now + Math.max(...days) * DAY) },
    verification: { $ne: "rejected" },
    ownerType: { $in: ["vehicle", "driver", "organization"] },
  })
    .select("ownerType owner type number expiryDate")
    .lean();
  const out = [];
  for (const d of docs) {
    const left = daysLeft(d.expiryDate, now);
    // Bucket = the smallest configured interval the document is within; 0 once expired.
    const threshold =
      left <= 0 ? 0 : [...days].sort((x, y) => x - y).find((x) => left <= x);
    if (threshold === undefined) continue;
    out.push({
      document: d,
      daysLeft: left,
      threshold,
      key: `${d._id}:${threshold}`,
    });
  }
  return out;
}

/**
 * Request attachments are visible only to the requester and to reviewers. The role-level check in the
 * documents module is not enough on its own because any driver may file requests.
 */
export async function assertRequestAccess(req, ownerId) {
  if (can(req.user.role, "requests:review")) return;
  const mine = await TransportRequest.exists({
    _id: ownerId,
    organization: req.user.organization,
    requester: req.user._id,
  });
  if (!mine) throw forbidden("Insufficient permissions");
}
