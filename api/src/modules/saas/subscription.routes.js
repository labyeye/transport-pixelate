import { Router } from "express";
import { z } from "zod";
import { Vehicle } from "../../models/Vehicle.js";
import { protect, requirePermission, orgScope } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import { badRequest, HttpError } from "../../utils/errors.js";
import { audit } from "../../models/AuditLog.js";
import {
  razorpay,
  verifyCheckoutSignature,
} from "../billing/billing.service.js";
import { TIERS, GST_RATE, FEATURES, calculatePricing } from "./pricing.js";
import {
  ensureSubscription,
  evaluate,
  featuresFor,
  findOffer,
  activateFromPending,
} from "./subscription.service.js";

// The Nest platform subscription (what the organization pays us). Not to be confused with
// /billing, which is the passenger transport-fee module.
const r = Router();
r.use(protect);
const planBody = z.object({
  vehicles: z.number().int().min(1).max(100_000),
  tier: z.enum(["basic", "pro"]),
  billingCycle: z.enum(["monthly", "yearly"]).default("monthly"),
  offerCode: z.string().trim().max(40).optional(),
});

async function view(req) {
  const sub = await ensureSubscription(req.user.organization);
  const vehicles = await Vehicle.countDocuments({
    ...orgScope(req),
    archivedAt: null,
  });
  return {
    subscription: {
      tier: sub.tier,
      isTrial: sub.isTrial,
      status: sub.status,
      paymentStatus: sub.paymentStatus,
      billingCycle: sub.billingCycle,
      vehicleLimit: sub.vehicleLimit,
      trialEndDate: sub.trialEndDate,
      renewalDate: sub.renewalDate,
      amountPaid: sub.amountPaid,
      offerCode: sub.offerCode,
      ...evaluate(sub),
    },
    usage: { vehicles },
    features: featuresFor(sub),
    plans: Object.fromEntries(
      Object.entries(TIERS).map(([k, t]) => [
        k,
        { label: t.label, ratePerVehicle: t.rate(), features: FEATURES[k] },
      ]),
    ),
    gstRate: GST_RATE,
    paymentsConfigured: razorpay.configured(),
  };
}

r.get(
  "/",
  ah(async (req, res) =>
    res.json({ success: true, data: await view(req) }),
  ),
);

r.post(
  "/quote",
  requirePermission("settings:write"),
  validate(planBody),
  ah(async (req, res) => {
    const b = req.body;
    const offer = await findOffer(b.offerCode);
    res.json({
      success: true,
      data: calculatePricing(b.vehicles, b.tier, b.billingCycle, offer),
    });
  }),
);

r.post(
  "/order",
  requirePermission("settings:write"),
  validate(planBody),
  ah(async (req, res) => {
    if (!razorpay.configured())
      throw new HttpError(503, "Online payment is not configured");
    const b = req.body;
    const used = await Vehicle.countDocuments({
      ...orgScope(req),
      archivedAt: null,
    });
    if (b.vehicles < used)
      throw badRequest(
        `You already have ${used} active vehicles; choose at least ${used} or archive some first`,
      );
    const offer = await findOffer(b.offerCode);
    const p = calculatePricing(b.vehicles, b.tier, b.billingCycle, offer);
    const sub = await ensureSubscription(req.user.organization);
    const order = await razorpay.createOrder({
      amount: p.total,
      currency: "INR",
      receipt: `sub_${String(sub._id).slice(-12)}_${Date.now() % 1e7}`,
    });
    sub.pending = {
      orderId: order.id,
      tier: b.tier,
      vehicles: b.vehicles,
      billingCycle: b.billingCycle,
      offerCode: offer?.code,
      bonusMonths: p.bonusMonths,
      amount: p.total,
      subtotal: p.subtotal,
      gstAmount: p.gstAmount,
      rate: p.rate,
    };
    await sub.save();
    await audit(req, "subscription.order", "Subscription", sub.id, {
      amount: p.total,
    });
    res.status(201).json({
      success: true,
      data: {
        orderId: order.id,
        currency: "INR",
        keyId: razorpay.keyId(),
        ...p,
      },
    });
  }),
);

r.post(
  "/verify",
  requirePermission("settings:write"),
  validate(
    z.object({
      razorpay_order_id: z.string(),
      razorpay_payment_id: z.string(),
      razorpay_signature: z.string(),
    }),
  ),
  ah(async (req, res) => {
    const b = req.body;
    const sub = await ensureSubscription(req.user.organization);
    if (sub.razorpayPaymentId === b.razorpay_payment_id)
      return res.json({ success: true, data: await view(req) });
    if (!sub.pending?.orderId || sub.pending.orderId !== b.razorpay_order_id)
      throw badRequest("No matching pending order");
    if (
      !verifyCheckoutSignature(
        b.razorpay_order_id,
        b.razorpay_payment_id,
        b.razorpay_signature,
      )
    )
      throw badRequest("Payment signature is invalid");
    // The signature proves the checkout happened; the amount is read back from Razorpay, never the browser.
    const pay = await razorpay.fetchPayment(b.razorpay_payment_id);
    if (
      pay.order_id !== sub.pending.orderId ||
      pay.amount !== sub.pending.amount ||
      !["captured", "authorized"].includes(pay.status)
    )
      throw badRequest("Payment does not match the order");
    await activateFromPending(sub, b.razorpay_payment_id);
    await audit(req, "subscription.activated", "Subscription", sub.id, {
      tier: sub.tier,
      vehicles: sub.vehicleLimit,
    });
    res.json({ success: true, data: await view(req) });
  }),
);

export default r;
