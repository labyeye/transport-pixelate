import { Router } from "express";
import { z } from "zod";
import { creditsConfig as cfg } from "../../config/credits.js";
import { CreditLedger } from "../../models/CreditLedger.js";
import { CreditTopup } from "../../models/CreditTopup.js";
import { protect, requirePermission, orgScope } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import { badRequest, notFound } from "../../utils/errors.js";
import {
  razorpay,
  verifyCheckoutSignature,
} from "../billing/billing.service.js";
import {
  completeTopup,
  createTopup,
  getBalance,
  syncPending,
  toCredits,
} from "./credits.service.js";

// The organization's WhatsApp / SMS wallet. Owner and admin only (same people who manage the plan).
const r = Router();
r.use(protect, requirePermission("settings:write"));

r.get(
  "/balance",
  ah(async (req, res) => {
    await syncPending(req.user.organization).catch(() => {}); // a top-up paid in a tab that closed
    res.json({ success: true, data: await getBalance(req.user.organization) });
  }),
);

r.get(
  "/packs",
  ah(async (_req, res) => {
    const packs = cfg.PACKS.map((p) => {
      const gst = Math.round(p.price * cfg.GST_PCT) / 100;
      return { ...p, gst, total: p.price + gst, bonus: Math.max(p.credits - p.price, 0) };
    });
    res.json({ success: true, data: { packs, gstPct: cfg.GST_PCT, rates: cfg.RATES } });
  }),
);

// Message list: what was charged, to whom, and what was skipped for lack of credits.
r.get(
  "/ledger",
  ah(async (req, res) => {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const filter = { ...orgScope(req) };
    if (["topup", "bonus", "debit", "refund", "skipped"].includes(req.query.type))
      filter.type = req.query.type;
    const [rows, total] = await Promise.all([
      CreditLedger.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CreditLedger.countDocuments(filter),
    ]);
    res.json({
      success: true,
      total,
      page,
      data: rows.map((x) => ({
        _id: x._id,
        type: x.type,
        credits: toCredits(x.units),
        event: x.event,
        phone: x.phone,
        status: x.status,
        note: x.note,
        createdAt: x.createdAt,
      })),
    });
  }),
);

// Trips and fees are not predictable, so the estimate is what the last 7 days actually cost.
r.get(
  "/estimate",
  ah(async (req, res) => {
    const since = new Date(Date.now() - 7 * 86400000);
    const [row] = await CreditLedger.aggregate([
      {
        $match: {
          organization: req.user.organization,
          type: { $in: ["debit", "refund"] },
          createdAt: { $gte: since },
        },
      },
      { $group: { _id: null, units: { $sum: "$units" } } },
    ]);
    const spent = -toCredits(row?.units ?? 0);
    res.json({
      success: true,
      data: {
        last7Days: Math.round(spent * 100) / 100,
        perDay: Math.round((spent / 7) * 100) / 100,
      },
    });
  }),
);

r.post(
  "/topup",
  validate(z.object({ packId: z.string().max(20) })),
  ah(async (req, res) =>
    res.status(201).json({
      success: true,
      data: await createTopup(req.user, req.body.packId),
    }),
  ),
);

r.post(
  "/topup/verify",
  validate(
    z.object({
      razorpay_order_id: z.string(),
      razorpay_payment_id: z.string(),
      razorpay_signature: z.string(),
    }),
  ),
  ah(async (req, res) => {
    const b = req.body;
    const order = await CreditTopup.findOne({ orderId: b.razorpay_order_id })
      .select("organization")
      .lean();
    if (!order || String(order.organization) !== String(req.user.organization))
      throw notFound("Order not found");
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
      pay.order_id !== b.razorpay_order_id ||
      !["captured", "authorized"].includes(pay.status)
    )
      throw badRequest("Payment does not match the order");
    await completeTopup({
      orderId: b.razorpay_order_id,
      paymentId: b.razorpay_payment_id,
      paidAmount: pay.amount,
    }); // null = already credited
    res.json({ success: true, data: await getBalance(req.user.organization) });
  }),
);

r.get(
  "/topups",
  ah(async (req, res) => {
    const rows = await CreditTopup.find({ ...orgScope(req), status: "paid" })
      .sort({ paidAt: -1 })
      .limit(50)
      .lean();
    res.json({
      success: true,
      data: rows.map((t) => ({
        _id: t._id,
        invoiceNumber: t.invoiceNumber,
        credits: t.credits,
        price: t.price,
        gst: t.gst,
        total: t.total,
        paidAt: t.paidAt,
      })),
    });
  }),
);

export default r;
