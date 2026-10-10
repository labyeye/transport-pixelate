import { Router } from "express";
import { z } from "zod";
import { FeePlan } from "../../models/FeePlan.js";
import { PassengerCharge } from "../../models/PassengerCharge.js";
import { Invoice } from "../../models/Invoice.js";
import { Payment } from "../../models/Payment.js";
import { Refund } from "../../models/Refund.js";
import { PaymentIntent } from "../../models/PaymentIntent.js";
import { Passenger } from "../../models/Passenger.js";
import { Route } from "../../models/Route.js";
import { Organization } from "../../models/Organization.js";
import { protect, requirePermission, orgScope } from "../../middleware/auth.js";
import { requireModule } from "../../middleware/requireModule.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import { badRequest, conflict, notFound } from "../../utils/errors.js";
import { meta, pageQuery } from "../../utils/pagination.js";
import { audit, AuditLog } from "../../models/AuditLog.js";
import {
  createManualInvoice,
  generateInvoices,
  periodOk,
  razorpay,
  recompute,
  recordPayment,
  refundPayment,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "./billing.service.js";

const r = Router();
const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const minor = z.number().int().min(0).max(1_000_000_000);
const period = z
  .string()
  .trim()
  .refine(periodOk, "Use a short period label such as 2030-04 or Term 1");

// ---- Razorpay webhook: public, authenticated only by its signature over the RAW body ---------
r.post(
  "/razorpay/webhook",
  ah(async (req, res) => {
    const raw = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body ?? {}));
    if (!verifyWebhookSignature(raw, req.headers["x-razorpay-signature"]))
      return res
        .status(400)
        .json({ success: false, message: "Invalid signature" });
    let event;
    try {
      event = JSON.parse(raw.toString("utf8"));
    } catch {
      return res
        .status(400)
        .json({ success: false, message: "Malformed body" });
    }
    if (!["payment.captured", "order.paid"].includes(event.event))
      return res.json({ success: true, ignored: true });
    const p = event.payload?.payment?.entity;
    if (!p?.id || !p.order_id)
      return res.json({ success: true, ignored: true });
    const intent = await PaymentIntent.findOne({ orderId: p.order_id });
    if (!intent) return res.json({ success: true, ignored: true }); // not an order we created
    if (
      p.amount !== intent.amount ||
      (p.currency ?? "INR") !== intent.currency
    ) {
      await AuditLog.create({
        organization: intent.organization,
        action: "billing.webhook_mismatch",
        entity: "PaymentIntent",
        entityId: String(intent._id),
        meta: { paymentId: p.id },
      });
      return res.json({ success: true, ignored: true });
    }
    const out = await recordPayment(intent.organization, {
      invoice: intent.invoice,
      amount: p.amount,
      method: "razorpay",
      reference: p.id,
      source: "razorpay",
      razorpayOrderId: p.order_id,
      razorpayPaymentId: p.id,
    });
    await PaymentIntent.updateOne({ _id: intent._id }, { status: "paid" });
    res.json({ success: true, duplicate: out.duplicate });
  }),
);

r.use(protect, requireModule("billing"));

r.get(
  "/config",
  requirePermission("billing:read"),
  ah(async (req, res) => {
    const o = await Organization.findById(req.user.organization).select(
      "currency",
    );
    res.json({
      success: true,
      data: {
        currency: o.currency,
        razorpay: {
          enabled: razorpay.configured(),
          keyId: razorpay.configured() ? razorpay.keyId() : null,
          webhook: razorpay.webhookConfigured(),
        },
      },
    });
  }),
);

// ---- fee plans -------------------------------------------------------------------------------
const planBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    kind: z.enum(["route", "stop", "flat"]),
    route: id.optional(),
    stopName: z.string().trim().min(1).max(120).optional(),
    amount: minor,
    frequency: z.enum(["monthly", "term", "one_time"]).default("monthly"),
    active: z.boolean().default(true),
  })
  .refine((p) => p.kind === "flat" || p.route, {
    message: "Route is required",
    path: ["route"],
  })
  .refine((p) => p.kind !== "stop" || p.stopName, {
    message: "Stop is required",
    path: ["stopName"],
  });

async function checkPlan(req, p) {
  if (p.kind === "flat") return;
  const route = await Route.findOne({
    _id: p.route,
    ...orgScope(req),
    archivedAt: null,
  });
  if (!route) throw notFound("Route not found");
  if (p.kind === "stop" && !route.stops.some((s) => s.name === p.stopName))
    throw conflict(`"${p.stopName}" is not a stop on ${route.code}`);
}

r.get(
  "/fee-plans",
  requirePermission("billing:read"),
  ah(async (req, res) => {
    const items = await FeePlan.find({ ...orgScope(req), archivedAt: null })
      .populate("route", "code name")
      .sort({ kind: 1, name: 1 })
      .lean();
    res.json({ success: true, data: items });
  }),
);
r.post(
  "/fee-plans",
  requirePermission("billing:write"),
  validate(planBody),
  ah(async (req, res) => {
    await checkPlan(req, req.body);
    const dup = await FeePlan.exists({
      ...orgScope(req),
      archivedAt: null,
      kind: req.body.kind,
      route: req.body.route ?? null,
      stopName: req.body.stopName ?? null,
      frequency: req.body.frequency,
      active: true,
    });
    if (dup && req.body.active)
      throw conflict(
        "An active plan already exists for this route/stop and frequency",
      );
    const p = await FeePlan.create({ ...req.body, ...orgScope(req) });
    await audit(req, "billing.plan.create", "FeePlan", p.id, {
      amount: p.amount,
    });
    res.status(201).json({ success: true, data: p });
  }),
);
r.put(
  "/fee-plans/:id",
  requirePermission("billing:write"),
  validate(planBody),
  ah(async (req, res) => {
    const p = await FeePlan.findOne({
      _id: req.params.id,
      ...orgScope(req),
      archivedAt: null,
    });
    if (!p) throw notFound("Fee plan not found");
    await checkPlan(req, req.body);
    p.set(req.body);
    await p.save();
    // Existing invoices keep their own lines; a plan edit only affects invoices generated afterwards.
    await audit(req, "billing.plan.update", "FeePlan", p.id, {
      amount: p.amount,
    });
    res.json({ success: true, data: p });
  }),
);
r.delete(
  "/fee-plans/:id",
  requirePermission("billing:write"),
  ah(async (req, res) => {
    const p = await FeePlan.findOneAndUpdate(
      { _id: req.params.id, ...orgScope(req) },
      { archivedAt: new Date(), active: false },
    );
    if (!p) throw notFound("Fee plan not found");
    await audit(req, "billing.plan.archive", "FeePlan", p.id);
    res.json({ success: true });
  }),
);

// ---- passenger-specific discounts / surcharges ------------------------------------------------
const chargeBody = z
  .object({
    passenger: id,
    label: z.string().trim().min(2).max(80),
    type: z.enum(["discount", "surcharge"]),
    mode: z.enum(["fixed", "percent"]),
    value: z.number().min(0),
    fromPeriod: z.string().trim().max(20).optional(),
    toPeriod: z.string().trim().max(20).optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((c) => c.mode !== "percent" || (c.value > 0 && c.value <= 100), {
    message: "Percent must be between 0 and 100",
    path: ["value"],
  })
  .refine((c) => c.mode !== "fixed" || Number.isInteger(c.value), {
    message: "Fixed amounts are whole minor units",
    path: ["value"],
  });

r.get(
  "/charges",
  requirePermission("billing:read"),
  validate(z.object({ passenger: id.optional() }), "query"),
  ah(async (req, res) => {
    const items = await PassengerCharge.find({
      ...orgScope(req),
      ...(req.query.passenger && { passenger: req.query.passenger }),
    })
      .populate("passenger", "name")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: items });
  }),
);
r.post(
  "/charges",
  requirePermission("billing:write"),
  validate(chargeBody),
  ah(async (req, res) => {
    if (
      !(await Passenger.exists({
        _id: req.body.passenger,
        ...orgScope(req),
        archivedAt: null,
      }))
    )
      throw notFound("Passenger not found");
    const c = await PassengerCharge.create({ ...req.body, ...orgScope(req) });
    await audit(req, "billing.charge.create", "PassengerCharge", c.id, {
      type: c.type,
      mode: c.mode,
      value: c.value,
    });
    res.status(201).json({ success: true, data: c });
  }),
);
r.patch(
  "/charges/:id",
  requirePermission("billing:write"),
  validate(z.object({ active: z.boolean() })),
  ah(async (req, res) => {
    const c = await PassengerCharge.findOneAndUpdate(
      { _id: req.params.id, ...orgScope(req) },
      { active: req.body.active },
      { new: true },
    );
    if (!c) throw notFound("Charge not found");
    await audit(req, "billing.charge.toggle", "PassengerCharge", c.id, {
      active: c.active,
    });
    res.json({ success: true, data: c });
  }),
);

// ---- invoices ---------------------------------------------------------------------------------
const lineBody = z.object({
  description: z.string().trim().min(2).max(120),
  kind: z.enum(["fee", "discount", "surcharge", "adjustment"]),
  amount: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  reason: z.string().trim().max(200).optional(),
});
const signOk = (l) =>
  l.kind === "discount"
    ? l.amount < 0
    : ["fee", "surcharge"].includes(l.kind)
      ? l.amount > 0
      : l.amount !== 0;

const listQuery = pageQuery.extend({
  status: z
    .enum(["issued", "partially_paid", "paid", "void", "unpaid", "overdue"])
    .optional(),
  passenger: id.optional(),
  period: z.string().max(20).optional(),
});
r.get(
  "/invoices",
  requirePermission("billing:read"),
  validate(listQuery, "query"),
  ah(async (req, res) => {
    const q = req.query;
    const f = { ...orgScope(req) };
    if (q.status === "unpaid") f.status = { $in: ["issued", "partially_paid"] };
    else if (q.status === "overdue") {
      f.status = { $in: ["issued", "partially_paid"] };
      f.dueDate = { $lt: new Date() };
    } else if (q.status) f.status = q.status;
    if (q.passenger) f.passenger = q.passenger;
    if (q.period) f.period = q.period;
    if (q.search) f.number = new RegExp(q.search.replace(/[^\w-]/g, ""), "i");
    const [items, total] = await Promise.all([
      Invoice.find(f)
        .select("-lines")
        .populate("passenger", "name identifier")
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      Invoice.countDocuments(f),
    ]);
    res.json({
      success: true,
      data: items,
      meta: meta(q.page, q.limit, total),
    });
  }),
);

r.post(
  "/invoices/generate",
  requirePermission("billing:write"),
  validate(
    z.object({
      period,
      dueDate: z.coerce.date(),
      route: id.optional(),
      preview: z.boolean().default(false),
    }),
  ),
  ah(async (req, res) => {
    const out = await generateInvoices(req.user.organization, req.body);
    if (!req.body.preview)
      await audit(req, "billing.generate", "Invoice", undefined, {
        period: req.body.period,
        created: out.created.length,
        amount: out.totalAmount,
      });
    res.json({ success: true, data: out });
  }),
);

r.post(
  "/invoices",
  requirePermission("billing:write"),
  validate(
    z.object({
      passenger: id,
      period,
      dueDate: z.coerce.date(),
      notes: z.string().max(300).optional(),
      lines: z.array(lineBody).min(1).max(20),
    }),
  ),
  ah(async (req, res) => {
    if (req.body.lines.some((l) => !signOk(l)))
      throw badRequest(
        "Discounts must be negative; fees and surcharges positive",
      );
    const inv = await createManualInvoice(req.user.organization, {
      ...req.body,
      userId: req.user._id,
    });
    await audit(req, "billing.invoice.create", "Invoice", inv.id, {
      total: inv.total,
    });
    res.status(201).json({ success: true, data: inv });
  }),
);

r.get(
  "/invoices/:id",
  requirePermission("billing:read"),
  ah(async (req, res) => {
    const inv = await Invoice.findOne({ _id: req.params.id, ...orgScope(req) })
      .populate("passenger", "name identifier grade")
      .populate("lines.addedBy", "name")
      .lean();
    if (!inv) throw notFound("Invoice not found");
    const payments = await Payment.find({ invoice: inv._id })
      .populate("recordedBy", "name")
      .sort({ receivedAt: 1 })
      .lean();
    const refunds = await Refund.find({ invoice: inv._id })
      .populate("by", "name")
      .sort({ createdAt: 1 })
      .lean();
    res.json({ success: true, data: { ...inv, payments, refunds } });
  }),
);

// Discounts / write-offs / corrections after issue: always a new, attributed line with a reason.
r.post(
  "/invoices/:id/adjust",
  requirePermission("billing:write"),
  validate(lineBody.extend({ reason: z.string().trim().min(3).max(200) })),
  ah(async (req, res) => {
    const inv = await Invoice.findOne({ _id: req.params.id, ...orgScope(req) });
    if (!inv) throw notFound("Invoice not found");
    if (inv.status === "void") throw conflict("This invoice is void");
    if (!signOk(req.body))
      throw badRequest(
        "Discounts must be negative; fees and surcharges positive",
      );
    const newTotal = Math.max(
      0,
      inv.lines.reduce((a, l) => a + l.amount, 0) + req.body.amount,
    );
    if (newTotal < inv.paid)
      throw conflict(
        "That would put the invoice below what has been paid; refund the payment first",
      );
    inv.lines.push({ ...req.body, addedBy: req.user._id });
    await inv.save();
    const out = await recompute(inv._id);
    await audit(req, "billing.invoice.adjust", "Invoice", inv.id, {
      amount: req.body.amount,
      reason: req.body.reason,
    });
    res.json({ success: true, data: out });
  }),
);

r.post(
  "/invoices/:id/void",
  requirePermission("billing:write"),
  validate(z.object({ reason: z.string().trim().min(3).max(200) })),
  ah(async (req, res) => {
    const inv = await Invoice.findOne({ _id: req.params.id, ...orgScope(req) });
    if (!inv) throw notFound("Invoice not found");
    if (inv.status === "void") throw conflict("Already void");
    if (inv.paid > 0)
      throw conflict("Refund the payments before voiding this invoice");
    inv.status = "void";
    inv.generatedKey = undefined; // frees the period for a corrected invoice
    inv.voidReason = req.body.reason;
    inv.voidedAt = new Date();
    await inv.save();
    await audit(req, "billing.invoice.void", "Invoice", inv.id, {
      reason: req.body.reason,
    });
    res.json({ success: true, data: inv });
  }),
);

// ---- payments ---------------------------------------------------------------------------------
r.post(
  "/invoices/:id/payments",
  requirePermission("billing:collect"),
  validate(
    z.object({
      amount: z.number().int().min(1),
      method: z.enum(["cash", "upi", "card", "bank", "cheque"]),
      reference: z.string().trim().max(80).optional(),
      receivedAt: z.coerce.date().optional(),
      clientRef: z.string().trim().min(8).max(80).optional(),
    }),
  ),
  ah(async (req, res) => {
    if (req.body.receivedAt && +req.body.receivedAt > Date.now() + 86400000)
      throw badRequest("Received date is in the future");
    if (
      ["upi", "bank", "cheque"].includes(req.body.method) &&
      !req.body.reference
    )
      throw badRequest(
        "A reference number is required for this payment method",
      );
    const out = await recordPayment(req.user.organization, {
      ...req.body,
      invoice: req.params.id,
      userId: req.user._id,
    });
    if (!out.duplicate)
      await audit(req, "billing.payment", "Payment", out.payment.id, {
        amount: req.body.amount,
        method: req.body.method,
      });
    res.status(out.duplicate ? 200 : 201).json({
      success: true,
      data: out.payment,
      invoice: out.invoice,
      duplicate: out.duplicate,
    });
  }),
);

r.get(
  "/payments",
  requirePermission("billing:read"),
  validate(
    pageQuery.extend({
      method: z.string().max(10).optional(),
      reconciled: z.enum(["true", "false"]).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }),
    "query",
  ),
  ah(async (req, res) => {
    const q = req.query;
    const f = { ...orgScope(req) };
    if (q.method) f.method = q.method;
    if (q.reconciled)
      f["reconciled.at"] = q.reconciled === "true" ? { $ne: null } : null;
    if (q.from || q.to)
      f.receivedAt = {
        ...(q.from && { $gte: q.from }),
        ...(q.to && { $lte: q.to }),
      };
    const [items, total] = await Promise.all([
      Payment.find(f)
        .populate("passenger", "name")
        .populate("invoice", "number")
        .sort({ receivedAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      Payment.countDocuments(f),
    ]);
    res.json({
      success: true,
      data: items,
      meta: meta(q.page, q.limit, total),
    });
  }),
);

r.post(
  "/payments/:id/reconcile",
  requirePermission("billing:collect"),
  validate(z.object({ reference: z.string().trim().max(80).optional() })),
  ah(async (req, res) => {
    const p = await Payment.findOneAndUpdate(
      { _id: req.params.id, ...orgScope(req), "reconciled.at": null },
      {
        reconciled: {
          at: new Date(),
          by: req.user._id,
          reference: req.body.reference,
        },
      },
      { new: true },
    );
    if (!p) throw conflict("Payment not found or already reconciled");
    await audit(req, "billing.reconcile", "Payment", p.id, {
      reference: req.body.reference,
    });
    res.json({ success: true, data: p });
  }),
);

r.post(
  "/payments/:id/refund",
  requirePermission("billing:refund"),
  validate(
    z.object({
      amount: z.number().int().min(1),
      reason: z.string().trim().min(3).max(200),
      method: z.string().max(20).optional(),
      reference: z.string().max(80).optional(),
    }),
  ),
  ah(async (req, res) => {
    const out = await refundPayment(req.user.organization, {
      ...req.body,
      payment: req.params.id,
      userId: req.user._id,
    });
    await audit(req, "billing.refund", "Refund", out.refund.id, {
      amount: req.body.amount,
      reason: req.body.reason,
    });
    res
      .status(201)
      .json({ success: true, data: out.refund, invoice: out.invoice });
  }),
);

r.get(
  "/payments/:id/receipt",
  requirePermission("billing:read"),
  ah(async (req, res) => {
    const p = await Payment.findOne({ _id: req.params.id, ...orgScope(req) })
      .populate("recordedBy", "name")
      .lean();
    if (!p) throw notFound("Payment not found");
    const [inv, org] = await Promise.all([
      Invoice.findById(p.invoice)
        .populate("passenger", "name identifier")
        .lean(),
      Organization.findById(req.user.organization)
        .select("name currency")
        .lean(),
    ]);
    res.json({
      success: true,
      data: {
        receiptNumber: p.number,
        organization: org.name,
        currency: org.currency,
        payment: p,
        invoice: {
          number: inv.number,
          period: inv.period,
          total: inv.total,
          paid: inv.paid,
          balance: inv.balance,
        },
        passenger: inv.passenger,
        billTo: inv.billTo,
      },
    });
  }),
);

// ---- outstanding balances ---------------------------------------------------------------------
r.get(
  "/outstanding",
  requirePermission("billing:read"),
  ah(async (req, res) => {
    const now = Date.now();
    const invs = await Invoice.find({
      ...orgScope(req),
      status: { $in: ["issued", "partially_paid"] },
      balance: { $gt: 0 },
    })
      .populate("passenger", "name identifier")
      .lean();
    const by = new Map();
    for (const i of invs) {
      const k = String(i.passenger._id);
      const late = Math.floor((now - +i.dueDate) / 86400000);
      const bucket =
        late <= 0
          ? "current"
          : late <= 30
            ? "d1_30"
            : late <= 60
              ? "d31_60"
              : "d61_plus";
      const row = by.get(k) ?? {
        passenger: i.passenger,
        invoices: 0,
        balance: 0,
        current: 0,
        d1_30: 0,
        d31_60: 0,
        d61_plus: 0,
      };
      row.invoices++;
      row.balance += i.balance;
      row[bucket] += i.balance;
      by.set(k, row);
    }
    const rows = [...by.values()].sort((a, b) => b.balance - a.balance);
    const totals = rows.reduce(
      (t, r2) => ({
        balance: t.balance + r2.balance,
        current: t.current + r2.current,
        d1_30: t.d1_30 + r2.d1_30,
        d31_60: t.d31_60 + r2.d31_60,
        d61_plus: t.d61_plus + r2.d61_plus,
      }),
      { balance: 0, current: 0, d1_30: 0, d31_60: 0, d61_plus: 0 },
    );
    res.json({ success: true, data: { rows, totals } });
  }),
);

// ---- Razorpay online payment ------------------------------------------------------------------
r.post(
  "/invoices/:id/razorpay-order",
  requirePermission("billing:collect"),
  ah(async (req, res) => {
    if (!razorpay.configured())
      throw conflict("Online payments are not configured on the server");
    const inv = await Invoice.findOne({ _id: req.params.id, ...orgScope(req) });
    if (!inv) throw notFound("Invoice not found");
    if (inv.status === "void" || inv.balance <= 0)
      throw conflict("Nothing is due on this invoice");
    const org = await Organization.findById(req.user.organization).select(
      "currency",
    );
    let order;
    try {
      order = await razorpay.createOrder({
        amount: inv.balance,
        currency: org.currency,
        receipt: inv.number,
      });
    } catch (e) {
      throw conflict(e.message);
    }
    await PaymentIntent.create({
      organization: req.user.organization,
      invoice: inv._id,
      amount: inv.balance,
      currency: org.currency,
      orderId: order.id,
      createdBy: req.user._id,
    });
    res.json({
      success: true,
      data: {
        orderId: order.id,
        amount: inv.balance,
        currency: org.currency,
        keyId: razorpay.keyId(),
        invoiceNumber: inv.number,
      },
    });
  }),
);

// The browser reports what checkout returned. Nothing is recorded on its word alone: the signature is
// checked, then the payment is looked up directly with Razorpay and compared with the order we created.
r.post(
  "/razorpay/verify",
  requirePermission("billing:collect"),
  validate(
    z.object({
      orderId: z.string().min(5).max(80),
      paymentId: z.string().min(5).max(80),
      signature: z.string().regex(/^[a-f\d]{64}$/i),
    }),
  ),
  ah(async (req, res) => {
    const { orderId, paymentId, signature } = req.body;
    if (!razorpay.configured())
      throw conflict("Online payments are not configured on the server");
    const intent = await PaymentIntent.findOne({
      orderId,
      organization: req.user.organization,
    });
    if (!intent) throw notFound("Unknown order");
    if (!verifyCheckoutSignature(orderId, paymentId, signature)) {
      await audit(
        req,
        "billing.razorpay_bad_signature",
        "PaymentIntent",
        intent.id,
      );
      throw badRequest("Payment verification failed");
    }
    let remote;
    try {
      remote = await razorpay.fetchPayment(paymentId);
    } catch (e) {
      return res.status(202).json({
        success: true,
        pending: true,
        message: "Payment is being confirmed; it will appear shortly.",
      });
    }
    if (remote.order_id !== orderId || remote.amount !== intent.amount)
      throw badRequest("Payment does not match the order");
    if (remote.status !== "captured")
      return res.status(202).json({
        success: true,
        pending: true,
        message: `Payment is ${remote.status}; it will be recorded once captured.`,
      });
    const out = await recordPayment(req.user.organization, {
      invoice: intent.invoice,
      amount: intent.amount,
      method: "razorpay",
      reference: paymentId,
      source: "razorpay",
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      userId: req.user._id,
    });
    await PaymentIntent.updateOne({ _id: intent._id }, { status: "paid" });
    res.json({
      success: true,
      data: out.payment,
      invoice: out.invoice,
      duplicate: out.duplicate,
    });
  }),
);

export default r;
