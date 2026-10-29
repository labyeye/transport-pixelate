import { creditsConfig as cfg } from "../../config/credits.js";
import { CreditWallet } from "../../models/CreditWallet.js";
import { CreditLedger } from "../../models/CreditLedger.js";
import { CreditTopup } from "../../models/CreditTopup.js";
import { Organization } from "../../models/Organization.js";
import { User } from "../../models/User.js";
import { Types } from "mongoose";
import { nextSeq } from "../../models/Counter.js";
import { razorpay } from "../billing/billing.service.js";
import { channels } from "../notifications/channels/index.js";
import { badRequest } from "../../utils/errors.js";

const U = cfg.UNIT;
export const toUnits = (c) => Math.round(c * U);
export const toCredits = (u) => u / U;
const round2 = (n) => Math.round(n * 100) / 100;
const istDay = () =>
  new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const mask = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  return d.length > 6 ? `${d.slice(0, 2)}******${d.slice(-4)}` : "****";
};
// top-up invoice numbers are one platform-wide sequence; Counter is per organization, so they share this fixed id
const PLATFORM = new Types.ObjectId("000000000000000000000001");

/** True when this organization pays for WhatsApp / SMS with credits. No wallet = not metered = free, as before. */
export async function isMetered(organization) {
  if (!organization) return false;
  return !!(await CreditWallet.exists({ organization, metered: true }));
}

const activeBonus = (w) =>
  w.bonusExpiresAt && w.bonusExpiresAt > new Date() ? w.bonusBalance || 0 : 0;

/**
 * Take the price of one message BEFORE sending it. Atomic: the balance check is part of the update filter,
 * so two parallel sends can never spend the same credit. Bonus credits are spent first.
 * `kind` is the channel (whatsapp / sms) and picks the rate.
 * Returns { ok:true, free:true } (not metered), { ok:true, ledgerId } (charged) or { ok:false, reason }.
 */
export async function reserve(organization, { kind, phone }) {
  const w = await CreditWallet.findOne({ organization, metered: true })
    .select("dailyCap dayKey")
    .lean();
  if (!w) return { ok: true, free: true };

  const cost = toUnits(cfg.RATES[kind] ?? cfg.DEFAULT_RATE);
  const key = istDay();
  if (w.dayKey !== key)
    await CreditWallet.updateOne(
      { _id: w._id, dayKey: { $ne: key } },
      { $set: { dayKey: key, dayCount: 0 } },
    );
  const cap = { dayCount: { $lt: w.dailyCap || cfg.DAILY_CAP } };

  let bucket = "bonus";
  let r = await CreditWallet.updateOne(
    {
      _id: w._id,
      ...cap,
      bonusBalance: { $gte: cost },
      bonusExpiresAt: { $gt: new Date() },
    },
    { $inc: { bonusBalance: -cost, dayCount: 1 } },
  );
  if (!r.modifiedCount) {
    bucket = "main";
    r = await CreditWallet.updateOne(
      { _id: w._id, ...cap, balance: { $gte: cost } },
      { $inc: { balance: -cost, dayCount: 1 } },
    );
  }
  if (!r.modifiedCount) {
    const cur = await CreditWallet.findById(w._id)
      .select("dayCount dailyCap")
      .lean();
    const reason =
      cur.dayCount >= (cur.dailyCap || cfg.DAILY_CAP)
        ? "daily_cap"
        : "low_balance";
    await CreditLedger.create({
      organization,
      type: "skipped",
      units: 0,
      event: kind,
      phone: mask(phone),
      status: "skipped",
      note: reason,
    });
    checkLow(organization).catch(() => {});
    return { ok: false, reason };
  }

  try {
    const row = await CreditLedger.create({
      organization,
      type: "debit",
      units: -cost,
      bucket,
      event: kind,
      phone: mask(phone),
      status: "reserved",
    });
    checkLow(organization).catch(() => {});
    return { ok: true, ledgerId: row._id };
  } catch (e) {
    // could not record the debit: give the credit back rather than charge without a trace
    await CreditWallet.updateOne(
      { _id: w._id },
      { $inc: bucket === "bonus" ? { bonusBalance: cost } : { balance: cost } },
    );
    throw e;
  }
}

/** The provider accepted the message: remember its id. */
export async function commit(hold, providerId) {
  if (!hold || hold.free || !hold.ledgerId) return;
  await CreditLedger.updateOne(
    { _id: hold.ledgerId, status: "reserved" },
    { $set: { status: "sent", wamid: providerId || undefined } },
  );
}

async function refundWhere(filter, note) {
  // flipping status is the claim: a second refund attempt finds nothing to flip
  const row = await CreditLedger.findOneAndUpdate(
    { ...filter, type: "debit", status: { $in: ["reserved", "sent"] } },
    { $set: { status: "refunded", note } },
  );
  if (!row) return false;
  await CreditWallet.updateOne(
    { organization: row.organization },
    {
      $inc:
        row.bucket === "bonus"
          ? { bonusBalance: -row.units }
          : { balance: -row.units },
    },
  );
  await CreditLedger.create({
    organization: row.organization,
    type: "refund",
    units: -row.units,
    bucket: row.bucket,
    event: row.event,
    phone: row.phone,
    refId: `refund:${row._id}`,
    note,
  });
  return true;
}

/** The message was never sent (provider rejected it / network error). */
export const refund = (hold, note = "send_failed") =>
  hold && hold.ledgerId ? refundWhere({ _id: hold.ledgerId }, note) : false;
export const refundByProviderId = (id, note = "delivery_failed") =>
  id ? refundWhere({ wamid: id }, note) : false;

export async function getBalance(organization) {
  const w = await CreditWallet.findOne({ organization }).lean();
  if (!w || !w.metered) return { metered: false };
  const bonus = activeBonus(w);
  const total = w.balance + bonus;
  return {
    metered: true,
    balance: toCredits(w.balance),
    bonus: toCredits(bonus),
    bonusExpiresAt: bonus ? w.bonusExpiresAt : null,
    total: toCredits(total),
    low: total < toUnits(cfg.LOW_BALANCE_CREDITS),
    zero: total <= 0,
    dailyCap: w.dailyCap || cfg.DAILY_CAP,
    rates: cfg.RATES,
  };
}

/** Free credits (plan bonus, manual gift). refId makes it safe to call twice. The bonus bucket expires. */
export async function grantBonus(
  organization,
  { credits, days = cfg.BONUS_DAYS, refId, note },
) {
  const units = toUnits(credits);
  try {
    await CreditLedger.create({
      organization,
      type: "bonus",
      units,
      bucket: "bonus",
      refId,
      note,
    });
  } catch (e) {
    if (e.code === 11000) return false; // already granted
    throw e;
  }
  const expires = new Date(Date.now() + days * 86400000);
  await CreditWallet.updateOne(
    { organization },
    {
      $inc: { bonusBalance: units },
      $set: { alerted: null },
      $max: { bonusExpiresAt: expires },
    },
    { upsert: true },
  );
  return true;
}

/** Turn metering on for an organization (creates the wallet). */
export async function enable(organization) {
  await CreditWallet.updateOne(
    { organization },
    { $set: { metered: true }, $setOnInsert: { balance: 0, bonusBalance: 0 } },
    { upsert: true },
  );
}

/** Called when a plan payment completes. New metered organizations get the bonus once per payment. amountPaid is paise. */
export async function onSubscriptionPaid(organization, { amountPaid, refId }) {
  if (
    process.env.CREDITS_FOR_NEW_SIGNUPS === "true" &&
    !(await CreditWallet.exists({ organization }))
  )
    await enable(organization);
  if (!(await isMetered(organization))) return;
  const credits = cfg.bonusFor((amountPaid || 0) / 100);
  if (!credits) return;
  await grantBonus(organization, {
    credits,
    refId: `sub:${refId}`,
    note: "Plan purchase bonus",
  });
}

// ---- top-up (Razorpay) ------------------------------------------------------

export async function createTopup(user, packId) {
  const pack = cfg.PACKS.find((p) => p.id === packId);
  if (!pack) throw badRequest("Unknown credit pack");
  if (!(await isMetered(user.organization)))
    throw badRequest("Credits are not enabled for your organization");
  if (!razorpay.configured()) throw badRequest("Online payment is not configured");
  const gst = round2((pack.price * cfg.GST_PCT) / 100);
  const total = round2(pack.price + gst);
  const order = await razorpay.createOrder({
    amount: Math.round(total * 100),
    currency: "INR",
    receipt: `cr_${String(user.organization).slice(-10)}_${Date.now() % 1e7}`,
  });
  await CreditTopup.create({
    organization: user.organization,
    user: user._id,
    packId,
    credits: pack.credits,
    price: pack.price,
    gst,
    total,
    orderId: order.id,
  });
  return {
    orderId: order.id,
    keyId: razorpay.keyId(),
    amount: total,
    currency: "INR",
    pack: { ...pack, gst, total },
  };
}

/**
 * Credit the wallet for a paid order. Called by the browser verify call, the Razorpay webhook AND syncPending;
 * whichever comes first wins the atomic created->paid flip, the others are no-ops.
 * paidAmount (paise, read back from Razorpay) must match the order when given.
 * ponytail: a process crash between the flip and the wallet update loses that top-up; reconcile by hand from Razorpay.
 */
export async function completeTopup({ orderId, paymentId, paidAmount }) {
  if (paidAmount != null) {
    const t0 = await CreditTopup.findOne({ orderId }).select("total").lean();
    if (t0 && Math.round(t0.total * 100) !== paidAmount)
      throw badRequest("Payment does not match the order");
  }
  const t = await CreditTopup.findOneAndUpdate(
    { orderId, status: "created" },
    { $set: { status: "paid", paymentId, paidAt: new Date() } },
    { new: true },
  );
  if (!t) return null;
  try {
    const seq = await nextSeq(PLATFORM, "credit-invoice");
    t.invoiceNumber = `CR-TRN-${String(seq).padStart(4, "0")}`;
    await t.save();
    await CreditWallet.updateOne(
      { organization: t.organization },
      { $inc: { balance: toUnits(t.credits) }, $set: { alerted: null } },
    );
  } catch (e) {
    await CreditTopup.updateOne({ _id: t._id }, { $set: { status: "created" } }); // nothing credited yet: let a retry run
    throw e;
  }
  await CreditLedger.create({
    organization: t.organization,
    type: "topup",
    units: toUnits(t.credits),
    bucket: "main",
    refId: paymentId,
    note: `${t.invoiceNumber} (Rs ${t.total} incl. GST)`,
  }).catch((e) =>
    console.error("[credits] topup credited but ledger row failed:", e.message),
  );
  return t;
}

/**
 * If the Razorpay webhook is not configured (or missed), an order paid in a tab that then closed is found by
 * asking Razorpay about the pending orders of the last 24h. Safe to call often (completeTopup is idempotent).
 */
export async function syncPending(organization) {
  if (!razorpay.configured()) return 0;
  const pending = await CreditTopup.find({
    organization,
    status: "created",
    createdAt: { $gt: new Date(Date.now() - 24 * 3600 * 1000) },
  })
    .select("orderId")
    .limit(5)
    .lean();
  let credited = 0;
  for (const p of pending) {
    try {
      const pays = await razorpay.fetchOrderPayments(p.orderId);
      const paid = pays.find((x) => x.status === "captured");
      if (
        paid &&
        (await completeTopup({
          orderId: p.orderId,
          paymentId: paid.id,
          paidAmount: paid.amount,
        }))
      )
        credited++;
    } catch (e) {
      console.error("[credits] syncPending:", e.message);
    }
  }
  return credited;
}

// ---- low balance alert ------------------------------------------------------

async function checkLow(organization) {
  const w = await CreditWallet.findOne({ organization, metered: true }).lean();
  if (!w) return;
  const total = w.balance + activeBonus(w);
  const level =
    total <= 0 ? "zero" : total < toUnits(cfg.LOW_BALANCE_CREDITS) ? "low" : null;
  if (!level || w.alerted === level) return;
  // only one worker wins this flip, so one email per level
  const flip = await CreditWallet.updateOne(
    { _id: w._id, alerted: w.alerted ?? null },
    { $set: { alerted: level } },
  );
  if (!flip.modifiedCount || !channels.email.configured()) return;
  const [org, owners] = await Promise.all([
    Organization.findById(organization).select("name").lean(),
    User.find({ organization, role: "owner", status: "active" })
      .select("email")
      .lean(),
  ]);
  const zero = level === "zero";
  const body = zero
    ? "Your WhatsApp / SMS credits are 0. Trip and fee messages are paused until you add credits. In-app alerts and login codes are not affected."
    : `You have ${toCredits(Math.max(total, 0))} WhatsApp / SMS credits left. Add credits so your messages don't stop.`;
  for (const o of owners)
    if (o.email)
      await channels.email
        .send({
          to: o.email,
          subject: zero
            ? `${org?.name ?? "NestTransport"}: credits finished, messages paused`
            : `${org?.name ?? "NestTransport"}: credits running low`,
          body,
        })
        .catch(() => {});
}
