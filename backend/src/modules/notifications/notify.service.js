import { Notification } from "../../models/Notification.js";
import { NotificationSetting } from "../../models/NotificationSetting.js";
import { NotificationTemplate } from "../../models/NotificationTemplate.js";
import { DeliveryAttempt } from "../../models/DeliveryAttempt.js";
import { User } from "../../models/User.js";
import { emitToUser } from "../../realtime.js";
import { CHANNELS, EVENTS, EXTERNAL } from "./catalog.js";
import { channels } from "./channels/index.js";
import { render } from "./render.js";
import {
  commit,
  isMetered,
  refund,
  reserve,
} from "../credits/credits.service.js";
import {
  ensureSubscription,
  featuresFor,
} from "../saas/subscription.service.js";

const MAX_ATTEMPTS = 3;
const BACKOFF_MIN = [1, 5, 30];

/** Effective rule = built-in default overlaid with the organization's overrides. */
export async function ruleFor(org, event) {
  const def = EVENTS[event];
  if (!def) return null;
  const s = await NotificationSetting.findOne({ organization: org }).lean();
  const o = s?.events?.[event];
  // an organization that pays per message with credits does not need the plan's WhatsApp tier
  const wa =
    featuresFor(await ensureSubscription(org)).whatsapp || (await isMetered(org));
  const chOn = (c) =>
    c === "in_app" ||
    (s?.channels?.[c]?.enabled === true && (c !== "whatsapp" || wa));
  return {
    enabled: o?.enabled ?? true,
    channels: (o?.channels ?? def.channels).filter(
      (c) => CHANNELS.includes(c) && chOn(c),
    ),
    roles: o?.roles ?? def.roles,
  };
}

async function templateFor(org, event, channel) {
  const t = await NotificationTemplate.findOne({
    organization: org,
    event,
    channel,
  }).lean();
  const def = EVENTS[event];
  return { subject: t?.subject ?? def.title, body: t?.body ?? def.body };
}

/**
 * Raise a notification. NEVER throws: callers invoke it after their own work is committed, and a
 * notification problem must not undo or fail that work.
 *
 * extra: [{ userId?, email?, phone?, name? }]  — e.g. a driver profile that has no login.
 */
export async function notify(
  event,
  { org, vars = {}, link, dedupeKey, extra = [], excludeUserId } = {},
) {
  try {
    const rule = await ruleFor(org, event);
    if (!rule?.enabled) return { delivered: 0 };
    const def = EVENTS[event];

    // Recipients: users holding a rule role, plus explicit users/contacts.
    const roleUsers = rule.roles.length
      ? await User.find({
          organization: org,
          role: { $in: rule.roles },
          status: "active",
        })
          .select("name email phone mutedChannels role")
          .lean()
      : [];
    const extraUserIds = extra.filter((e) => e.userId).map((e) => e.userId);
    const extraUsers = extraUserIds.length
      ? await User.find({
          organization: org,
          _id: { $in: extraUserIds },
          status: "active",
        })
          .select("name email phone mutedChannels")
          .lean()
      : [];
    const people = new Map();
    for (const u of [...roleUsers, ...extraUsers])
      people.set(String(u._id), {
        userId: u._id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        muted: u.mutedChannels ?? [],
      });
    // A login account may lack a phone/email that the person's staff profile has; use it as a fallback.
    for (const e of extra) {
      const p = e.userId && people.get(String(e.userId));
      if (p) {
        p.phone ??= e.phone;
        p.email ??= e.email;
      }
    }
    const contacts = extra
      .filter((e) => !e.userId && (e.email || e.phone))
      .map((e) => ({
        name: e.name,
        email: e.email,
        phone: e.phone,
        muted: [],
      }));
    if (excludeUserId) people.delete(String(excludeUserId));
    const recipients = [...people.values(), ...contacts];

    let delivered = 0;
    // In-app (always available): one row per user, deduplicated.
    if (rule.channels.includes("in_app")) {
      const tpl = await templateFor(org, event, "in_app");
      const title = render(tpl.subject, vars),
        body = render(tpl.body, vars);
      for (const p of people.values()) {
        try {
          const n = await Notification.create({
            organization: org,
            user: p.userId,
            event,
            severity: def.severity,
            title,
            body,
            link,
            dedupeKey,
          });
          emitToUser(String(p.userId), "notification:new", {
            _id: n._id,
            title,
            body,
            severity: def.severity,
            link,
            createdAt: n.createdAt,
          });
          delivered++;
        } catch (e) {
          if (e?.code !== 11000) throw e; // duplicate = already notified
        }
      }
    }
    // External channels: queue an attempt per recipient/channel, then send.
    for (const ch of rule.channels.filter((c) => EXTERNAL.includes(c))) {
      const tpl = await templateFor(org, event, ch);
      const subject = render(tpl.subject, vars),
        body = render(tpl.body, vars);
      for (const p of recipients) {
        if (p.muted.includes(ch)) continue;
        const to = ch === "email" ? p.email : ch === "push" ? null : p.phone;
        if (!to) continue;
        let attempt;
        try {
          attempt = await DeliveryAttempt.create({
            organization: org,
            event,
            channel: ch,
            to,
            recipientName: p.name,
            subject,
            body,
            dedupeKey: dedupeKey ? `${dedupeKey}` : undefined,
          });
        } catch (e) {
          if (e?.code === 11000) continue; // already sent this exact thing to this address
          throw e;
        }
        await deliver(attempt);
        delivered++;
      }
    }
    return { delivered };
  } catch (e) {
    console.error("[notify]", event, e.message);
    return { delivered: 0, error: e.message };
  }
}

/** Try to send one queued/failed attempt; always records the outcome. */
export async function deliver(attempt) {
  const adapter = channels[attempt.channel];
  attempt.attempts += 1;
  if (!adapter?.configured()) {
    attempt.status = "skipped";
    attempt.error = `${attempt.channel} provider is not configured`;
    attempt.nextRetryAt = undefined;
    return attempt.save();
  }
  // WhatsApp credits: a metered organization pays per WhatsApp / SMS message, charged before sending and
  // refunded if the provider rejects it. Email and in-app are free.
  const paid = attempt.channel === "whatsapp" || attempt.channel === "sms";
  const hold = paid
    ? await reserve(attempt.organization, {
        kind: attempt.channel,
        phone: attempt.to,
      })
    : null;
  if (hold && !hold.ok) {
    attempt.status = "skipped";
    attempt.error =
      hold.reason === "daily_cap"
        ? "Daily message limit reached"
        : "Not enough credits";
    attempt.nextRetryAt = undefined;
    return attempt.save();
  }
  try {
    const out = await adapter.send({
      to: attempt.to,
      subject: attempt.subject,
      body: attempt.body,
    });
    if (hold) await commit(hold, out.id);
    Object.assign(attempt, {
      status: "sent",
      provider: adapter.key,
      providerMessageId: out.id,
      sentAt: new Date(),
      error: undefined,
      nextRetryAt: undefined,
    });
  } catch (e) {
    if (hold) await refund(hold);
    attempt.error = String(e.message).slice(0, 300); // provider text only; never includes our credentials
    if (attempt.attempts >= MAX_ATTEMPTS) {
      attempt.status = "failed";
      attempt.nextRetryAt = undefined;
    } else {
      attempt.status = "queued";
      attempt.nextRetryAt = new Date(
        Date.now() + BACKOFF_MIN[attempt.attempts - 1] * 60000,
      );
    }
  }
  return attempt.save();
}

/** Called on a timer: retry attempts whose backoff has elapsed. */
export async function retryDue(now = new Date()) {
  const due = await DeliveryAttempt.find({
    status: "queued",
    nextRetryAt: { $lte: now },
  }).limit(100);
  for (const a of due) await deliver(a);
  return due.length;
}
