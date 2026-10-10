import crypto from "crypto";
import { FeePlan } from "../../models/FeePlan.js";
import { PassengerCharge } from "../../models/PassengerCharge.js";
import { Invoice } from "../../models/Invoice.js";
import { Payment } from "../../models/Payment.js";
import { Refund } from "../../models/Refund.js";
import { Passenger } from "../../models/Passenger.js";
import { PassengerAssignment } from "../../models/PassengerAssignment.js";
import { nextSeq } from "../../models/Counter.js";
import { conflict, notFound, badRequest } from "../../utils/errors.js";

// ---------------------------------------------------------------------------------------------
// All amounts are integers in minor units (paise). Never use floating point for money here.
// ---------------------------------------------------------------------------------------------

export const periodOk = (p) => /^[\w .-]{1,20}$/.test(p);
const inPeriod = (c, period) =>
  (!c.fromPeriod || period >= c.fromPeriod) &&
  (!c.toPeriod || period <= c.toPeriod);

/** Rebuild total/paid/balance/status from the lines, payments and refunds. Safe to call repeatedly. */
export async function recompute(invoiceId) {
  const inv = await Invoice.findById(invoiceId);
  if (!inv) throw notFound("Invoice not found");
  const [pay] = await Payment.aggregate([
    { $match: { invoice: inv._id } },
    {
      $group: {
        _id: null,
        paid: { $sum: "$amount" },
        refunded: { $sum: "$refundedAmount" },
      },
    },
  ]);
  const raw = inv.lines.reduce((a, l) => a + l.amount, 0);
  inv.total = Math.max(0, raw);
  inv.paid = (pay?.paid ?? 0) - (pay?.refunded ?? 0);
  inv.balance = inv.total - inv.paid;
  if (inv.status !== "void")
    inv.status =
      inv.balance <= 0 ? "paid" : inv.paid > 0 ? "partially_paid" : "issued";
  await inv.save();
  return inv;
}

async function newInvoice(org, data) {
  const seq = await nextSeq(org, "invoice");
  return Invoice.create({
    ...data,
    organization: org,
    number: `INV-${String(seq).padStart(5, "0")}`,
  });
}

/** Choose the fee lines for one passenger: the most specific plan per assignment, plus flat plans once. */
export function pickPlans(assignments, plans) {
  const chosen = new Map();
  for (const a of assignments) {
    const routeId = String(a.route._id ?? a.route);
    const stop = plans.find(
      (p) =>
        p.kind === "stop" &&
        String(p.route) === routeId &&
        p.stopName === a.pickupStop,
    );
    const route = plans.find(
      (p) => p.kind === "route" && String(p.route) === routeId,
    );
    const plan = stop ?? route;
    if (plan) chosen.set(String(plan._id), { plan, routeCode: a.route.code });
  }
  for (const p of plans.filter((x) => x.kind === "flat"))
    chosen.set(String(p._id), { plan: p });
  return [...chosen.values()];
}

/** Discount/surcharge lines for the chosen fees. Percentages apply to the fee subtotal. */
export function chargeLines(feeTotal, charges, period) {
  const lines = [];
  for (const c of charges.filter((x) => x.active && inPeriod(x, period))) {
    const raw =
      c.mode === "percent" ? Math.round((feeTotal * c.value) / 100) : c.value;
    if (raw <= 0) continue;
    lines.push({
      description: c.label,
      kind: c.type,
      amount: c.type === "discount" ? -raw : raw,
      reason: c.reason,
    });
  }
  return lines;
}

/**
 * Bulk-generate invoices for a period. Idempotent per passenger+period (unique key); `preview` writes nothing.
 * Returns what was / would be created and why anyone was skipped.
 */
export async function generateInvoices(
  org,
  { period, dueDate, route, preview = false },
) {
  const [plans, passengers, assignments, charges] = await Promise.all([
    FeePlan.find({
      organization: org,
      active: true,
      archivedAt: null,
      frequency: { $in: ["monthly", "term"] },
    }).lean(),
    Passenger.find({ organization: org, active: true, archivedAt: null })
      .select("name phone guardian")
      .lean(),
    PassengerAssignment.find({ organization: org, active: true })
      .populate("route", "code")
      .lean(),
    PassengerCharge.find({ organization: org, active: true }).lean(),
  ]);
  const byPassenger = new Map();
  for (const a of assignments)
    byPassenger.set(String(a.passenger), [
      ...(byPassenger.get(String(a.passenger)) ?? []),
      a,
    ]);
  const out = { created: [], skipped: [], totalAmount: 0 };
  for (const p of passengers) {
    let mine = byPassenger.get(String(p._id)) ?? [];
    if (route) mine = mine.filter((a) => String(a.route._id) === String(route));
    if (!mine.length) {
      if (!route)
        out.skipped.push({
          passenger: p.name,
          reason: "Not assigned to a route",
        });
      continue;
    }
    const fees = pickPlans(mine, plans);
    if (!fees.length) {
      out.skipped.push({
        passenger: p.name,
        reason: "No fee plan applies to their route or stop",
      });
      continue;
    }
    const feeLines = fees.map(({ plan, routeCode }) => ({
      description: routeCode ? `${plan.name} (${routeCode})` : plan.name,
      kind: "fee",
      amount: plan.amount,
      plan: plan._id,
    }));
    const feeTotal = feeLines.reduce((a, l) => a + l.amount, 0);
    const lines = [
      ...feeLines,
      ...chargeLines(
        feeTotal,
        charges.filter((c) => String(c.passenger) === String(p._id)),
        period,
      ),
    ];
    const key = `${p._id}:${period}`;
    if (await Invoice.exists({ organization: org, generatedKey: key })) {
      out.skipped.push({
        passenger: p.name,
        reason: `Already invoiced for ${period}`,
      });
      continue;
    }
    const total = Math.max(
      0,
      lines.reduce((a, l) => a + l.amount, 0),
    );
    if (preview) {
      out.created.push({ passenger: p.name, total });
      out.totalAmount += total;
      continue;
    }
    try {
      const inv = await newInvoice(org, {
        passenger: p._id,
        billTo: {
          name: p.guardian?.name ?? p.name,
          phone: p.guardian?.phone ?? p.phone,
        },
        period,
        dueDate,
        lines,
        generatedKey: key,
      });
      await recompute(inv._id);
      out.created.push({ passenger: p.name, number: inv.number, total });
      out.totalAmount += total;
    } catch (e) {
      if (e?.code === 11000)
        out.skipped.push({
          passenger: p.name,
          reason: `Already invoiced for ${period}`,
        });
      else throw e;
    }
  }
  return out;
}

export async function createManualInvoice(
  org,
  { passenger, period, dueDate, lines, notes, userId },
) {
  const p = await Passenger.findOne({
    _id: passenger,
    organization: org,
    archivedAt: null,
  });
  if (!p) throw notFound("Passenger not found");
  const inv = await newInvoice(org, {
    passenger: p._id,
    billTo: {
      name: p.guardian?.name ?? p.name,
      phone: p.guardian?.phone ?? p.phone,
    },
    period,
    dueDate,
    notes,
    lines: lines.map((l) => ({ ...l, addedBy: userId })),
  });
  return recompute(inv._id);
}

/**
 * Record money received against an invoice. Manual payments may not exceed the balance; verified provider
 * payments always record (the money has already moved) and surface as credit if the invoice was settled meanwhile.
 */
async function findPrior(org, { invoice, clientRef, razorpayPaymentId }) {
  const or = [];
  if (clientRef) or.push({ clientRef });
  if (razorpayPaymentId) or.push({ razorpayPaymentId });
  return or.length
    ? Payment.findOne({ organization: org, invoice, $or: or })
    : null;
}

export async function recordPayment(
  org,
  {
    invoice,
    amount,
    method,
    reference,
    receivedAt,
    userId,
    source = "manual",
    razorpayOrderId,
    razorpayPaymentId,
    clientRef,
  },
) {
  const inv = await Invoice.findOne({ _id: invoice, organization: org });
  if (!inv) throw notFound("Invoice not found");
  // A retry of something already recorded must succeed with the original, even if the invoice has since been settled.
  const prior = await findPrior(org, {
    invoice: inv._id,
    clientRef,
    razorpayPaymentId,
  });
  if (prior)
    return {
      payment: prior,
      invoice: await recompute(inv._id),
      duplicate: true,
    };
  if (inv.status === "void") throw conflict("This invoice is void");
  if (!Number.isInteger(amount) || amount < 1)
    throw badRequest("Amount must be positive");
  if (source === "manual" && amount > inv.balance)
    throw conflict(`Amount exceeds the outstanding balance (${inv.balance})`);
  const seq = await nextSeq(org, "receipt");
  let pay;
  try {
    pay = await Payment.create({
      organization: org,
      number: `RCT-${String(seq).padStart(5, "0")}`,
      invoice: inv._id,
      passenger: inv.passenger,
      amount,
      method,
      reference,
      receivedAt: receivedAt ?? new Date(),
      recordedBy: userId,
      source,
      razorpayOrderId,
      razorpayPaymentId,
      clientRef,
    });
  } catch (e) {
    if (e?.code === 11000) {
      const existing = await Payment.findOne({
        organization: org,
        $or: [
          { razorpayPaymentId: razorpayPaymentId ?? "\0" },
          { clientRef: clientRef ?? "\0" },
        ],
      });
      if (existing)
        return {
          payment: existing,
          invoice: await recompute(inv._id),
          duplicate: true,
        };
    }
    throw e;
  }
  const updated = await recompute(inv._id);
  // Two concurrent manual payments could both have passed the balance check; undo the loser.
  if (source === "manual" && updated.balance < 0) {
    await Payment.deleteOne({ _id: pay._id });
    await recompute(inv._id);
    throw conflict(
      "The invoice was paid by someone else at the same moment; nothing was recorded",
    );
  }
  return { payment: pay, invoice: updated, duplicate: false };
}

export async function refundPayment(
  org,
  { payment, amount, reason, method, reference, userId },
) {
  const pay = await Payment.findOne({ _id: payment, organization: org });
  if (!pay) throw notFound("Payment not found");
  const left = pay.amount - pay.refundedAmount;
  if (amount > left)
    throw conflict(`Only ${left} of this payment can still be refunded`);
  // Guarded increment so two simultaneous refunds can't exceed the payment.
  const upd = await Payment.findOneAndUpdate(
    { _id: pay._id, refundedAmount: { $lte: pay.amount - amount } },
    { $inc: { refundedAmount: amount } },
    { new: true },
  );
  if (!upd)
    throw conflict(
      "This payment was refunded at the same moment; check the refund list",
    );
  const refund = await Refund.create({
    organization: org,
    payment: pay._id,
    invoice: pay.invoice,
    amount,
    reason,
    method,
    reference,
    by: userId,
  });
  return { refund, invoice: await recompute(pay.invoice) };
}

// ---------------------------------------------------------------------------------------------
// Razorpay. Credentials come from the server environment only and never reach the browser (except key id).
// ---------------------------------------------------------------------------------------------
let fetchImpl = (...a) => fetch(...a);
export const __setBillingFetch = (f) =>
  (fetchImpl = f ?? ((...a) => fetch(...a)));

export const razorpay = {
  configured: () =>
    !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
  webhookConfigured: () => !!process.env.RAZORPAY_WEBHOOK_SECRET,
  keyId: () => process.env.RAZORPAY_KEY_ID,
  auth: () =>
    "Basic " +
    Buffer.from(
      `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`,
    ).toString("base64"),
  async createOrder({ amount, currency, receipt }) {
    const res = await fetchImpl("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: this.auth(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount, currency, receipt, payment_capture: 1 }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(
        `Razorpay error ${res.status}: ${j.error?.description ?? "order failed"}`,
      );
    return j;
  },
  async fetchPayment(id) {
    const res = await fetchImpl(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(id)}`,
      { headers: { Authorization: this.auth() } },
    );
    const j = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(
        `Razorpay error ${res.status}: ${j.error?.description ?? "lookup failed"}`,
      );
    return j;
  },
};

const hmac = (secret, data) =>
  crypto.createHmac("sha256", secret).update(data).digest("hex");
const safeEq = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Checkout callback signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export const verifyCheckoutSignature = (orderId, paymentId, signature) =>
  safeEq(
    hmac(process.env.RAZORPAY_KEY_SECRET ?? "", `${orderId}|${paymentId}`),
    signature,
  );
/** Webhook signature: HMAC_SHA256(raw body, webhook secret). Must be computed over the exact bytes received. */
export const verifyWebhookSignature = (rawBody, signature) =>
  !!process.env.RAZORPAY_WEBHOOK_SECRET &&
  safeEq(hmac(process.env.RAZORPAY_WEBHOOK_SECRET, rawBody), signature);
