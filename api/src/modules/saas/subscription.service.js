import { Subscription } from "../../models/Subscription.js";
import { Vehicle } from "../../models/Vehicle.js";
import { OfferCode } from "../../models/OfferCode.js";
import { badRequest, conflict, HttpError } from "../../utils/errors.js";
import { FEATURES, GRACE_DAYS, TRIAL_DAYS, TRIAL_VEHICLES } from "./pricing.js";

const DAY = 86_400_000;
export const addMonths = (d, n) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
};

export async function createTrial(organization) {
  const now = new Date();
  return Subscription.create({
    organization,
    tier: "pro", // the trial shows everything
    vehicleLimit: TRIAL_VEHICLES(),
    isTrial: true,
    startDate: now,
    trialEndDate: new Date(now.getTime() + TRIAL_DAYS() * DAY),
  });
}

/** Organizations created before subscriptions existed start a trial the first time they are seen. */
export async function ensureSubscription(organization) {
  const s = await Subscription.findOne({ organization });
  if (s) return s;
  try {
    return await createTrial(organization);
  } catch (e) {
    if (e.code === 11000) return Subscription.findOne({ organization }); // lost a creation race
    throw e;
  }
}

/** { ok, reason, endsAt, daysLeft }, computed on read and never stored, so it cannot go stale. */
export function evaluate(sub, now = new Date()) {
  if (sub.isTrial) {
    const ok = now <= sub.trialEndDate;
    return {
      ok,
      reason: ok ? null : "trial_expired",
      endsAt: sub.trialEndDate,
      daysLeft: Math.ceil((sub.trialEndDate - now) / DAY),
    };
  }
  const hardEnd = new Date(sub.renewalDate.getTime() + GRACE_DAYS * DAY);
  const ok = sub.paymentStatus === "completed" && now <= hardEnd;
  return {
    ok,
    reason: ok ? null : "expired",
    endsAt: sub.renewalDate,
    daysLeft: Math.ceil((sub.renewalDate - now) / DAY),
  };
}

export const featuresFor = (sub) => FEATURES[sub.tier] ?? FEATURES.basic;

export async function assertActive(organization) {
  const sub = await ensureSubscription(organization);
  const e = evaluate(sub);
  if (!e.ok)
    // The code lets clients (mobile) show a "plan ended" screen instead of a generic error.
    throw new HttpError(
      403,
      e.reason === "trial_expired"
        ? "Your free trial has ended. Subscribe to continue."
        : "Your subscription has expired. Renew to continue.",
      { code: "SUBSCRIPTION_REQUIRED" },
    );
  return sub;
}

export async function assertVehicleQuota(organization) {
  const sub = await ensureSubscription(organization);
  const used = await Vehicle.countDocuments({ organization, archivedAt: null });
  if (used >= sub.vehicleLimit)
    throw conflict(
      `Vehicle limit reached (${sub.vehicleLimit}). Upgrade your plan to add more vehicles.`,
    );
}

export async function findOffer(code) {
  if (!code) return null;
  const o = await OfferCode.findOne({
    code: code.trim().toUpperCase(),
    isActive: true,
  });
  if (!o || o.usedCount >= o.maxUses || (o.expiresAt && o.expiresAt < new Date()))
    throw badRequest("Offer code is invalid or expired");
  return o;
}

/** Turns a verified, paid pending order into live access. Idempotent per payment id. */
export async function activateFromPending(sub, paymentId) {
  if (sub.razorpayPaymentId === paymentId || !sub.pending?.orderId) return sub;
  const p = sub.pending.toObject(); // a copy: clearing sub.pending below would blank a live subdocument
  const now = new Date();
  // Renewing early keeps the time already paid for.
  const base = !sub.isTrial && sub.renewalDate > now ? sub.renewalDate : now;
  sub.tier = p.tier;
  sub.vehicleLimit = p.vehicles;
  sub.billingCycle = p.billingCycle;
  sub.isTrial = false;
  sub.status = "active";
  sub.paymentStatus = "completed";
  sub.startDate = now;
  sub.renewalDate = addMonths(
    base,
    (p.billingCycle === "yearly" ? 12 : 1) + (p.bonusMonths || 0),
  );
  sub.ratePerVehicle = p.rate;
  sub.subtotal = p.subtotal;
  sub.gstAmount = p.gstAmount;
  sub.amountPaid = p.amount;
  sub.offerCode = p.offerCode;
  sub.bonusMonths = p.bonusMonths || 0;
  sub.razorpayOrderId = p.orderId;
  sub.razorpayPaymentId = paymentId;
  sub.pending = undefined;
  await sub.save();
  if (p.offerCode)
    await OfferCode.updateOne({ code: p.offerCode }, { $inc: { usedCount: 1 } });
  return sub;
}

export { Subscription };
