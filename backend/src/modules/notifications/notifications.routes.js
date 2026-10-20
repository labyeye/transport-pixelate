import { Router } from "express";
import { z } from "zod";
import { Notification } from "../../models/Notification.js";
import { NotificationSetting } from "../../models/NotificationSetting.js";
import { NotificationTemplate } from "../../models/NotificationTemplate.js";
import { DeliveryAttempt } from "../../models/DeliveryAttempt.js";
import { User } from "../../models/User.js";
import { protect, requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/asyncHandler.js";
import { badRequest, notFound } from "../../utils/errors.js";
import { meta, pageQuery } from "../../utils/pagination.js";
import { ROLES } from "../../utils/permissions.js";
import { audit } from "../../models/AuditLog.js";
import { CHANNELS, EVENTS, EVENT_KEYS, EXTERNAL } from "./catalog.js";
import { channelStatus, channels } from "./channels/index.js";
import { maskTo, render } from "./render.js";
import { deliver, notify, ruleFor } from "./notify.service.js";
import { DeliveryAttempt as DA } from "../../models/DeliveryAttempt.js";

const r = Router();
r.use(protect);
const mine = (req) => ({ user: req.user._id });

// ---- my inbox ---------------------------------------------------------------------------
r.get(
  "/",
  validate(
    pageQuery.extend({ unread: z.enum(["true", "false"]).optional() }),
    "query",
  ),
  ah(async (req, res) => {
    const q = req.query;
    const filter = {
      ...mine(req),
      ...(q.unread === "true" && { readAt: null }),
    };
    const [items, total, unread] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ ...mine(req), readAt: null }),
    ]);
    res.json({
      success: true,
      data: items,
      meta: meta(q.page, q.limit, total),
      unreadCount: unread,
    });
  }),
);
r.get(
  "/unread-count",
  ah(async (req, res) => {
    res.json({
      success: true,
      data: {
        count: await Notification.countDocuments({
          ...mine(req),
          readAt: null,
        }),
      },
    });
  }),
);
r.post(
  "/read-all",
  ah(async (req, res) => {
    await Notification.updateMany(
      { ...mine(req), readAt: null },
      { readAt: new Date() },
    );
    res.json({ success: true });
  }),
);
r.post(
  "/:id/read",
  ah(async (req, res) => {
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, ...mine(req) },
      { readAt: new Date() },
      { new: true },
    );
    if (!n) throw notFound("Notification not found");
    res.json({ success: true, data: n });
  }),
);

// ---- personal channel preferences (in-app cannot be muted) -------------------------------
r.get(
  "/preferences",
  ah(async (req, res) => {
    const u = await User.findById(req.user._id).select(
      "mutedChannels phone email",
    );
    res.json({
      success: true,
      data: { mutedChannels: u.mutedChannels, email: u.email, phone: u.phone },
    });
  }),
);
r.put(
  "/preferences",
  validate(
    z.object({
      mutedChannels: z.array(z.enum(EXTERNAL)).max(4).optional(),
      phone: z
        .string()
        .trim()
        .regex(/^\+?\d[\d\s-]{7,15}$/, "Invalid phone number")
        .optional(),
    }),
  ),
  ah(async (req, res) => {
    const u = await User.findByIdAndUpdate(req.user._id, req.body, {
      new: true,
    }).select("mutedChannels phone");
    res.json({ success: true, data: u });
  }),
);

// ---- organization settings (admin) -------------------------------------------------------
r.get(
  "/settings",
  requirePermission("settings:write"),
  ah(async (req, res) => {
    const org = req.user.organization;
    const events = await Promise.all(
      EVENT_KEYS.map(async (k) => ({
        event: k,
        label: EVENTS[k].label,
        severity: EVENTS[k].severity,
        ...(await ruleFor(org, k)),
      })),
    );
    const s = await NotificationSetting.findOne({ organization: org }).lean();
    res.json({
      success: true,
      data: {
        events,
        channels: channelStatus().map((c) => ({
          ...c,
          enabled: s?.channels?.[c.key]?.enabled === true,
        })),
        roles: ROLES,
      },
    });
  }),
);
const settingsBody = z.object({
  channels: z
    .partialRecord(z.enum(EXTERNAL), z.object({ enabled: z.boolean() }))
    .optional(),
  events: z
    .partialRecord(
      z.enum(EVENT_KEYS),
      z.object({
        enabled: z.boolean().optional(),
        channels: z.array(z.enum(CHANNELS)).optional(),
        roles: z.array(z.enum(ROLES)).optional(),
      }),
    )
    .optional(),
});
r.put(
  "/settings",
  requirePermission("settings:write"),
  validate(settingsBody),
  ah(async (req, res) => {
    const org = req.user.organization;
    const set = {};
    for (const [k, v] of Object.entries(req.body.channels ?? {})) {
      // An unconfigured provider can't be switched on; this stops people believing messages are going out.
      if (v.enabled && !channels[k].configured())
        throw badRequest(
          `${channels[k].label} has no credentials configured on the server`,
        );
      set[`channels.${k}.enabled`] = v.enabled;
    }
    for (const [k, v] of Object.entries(req.body.events ?? {}))
      for (const [f, val] of Object.entries(v)) set[`events.${k}.${f}`] = val;
    if (Object.keys(set).length)
      await NotificationSetting.updateOne(
        { organization: org },
        { $set: set },
        { upsert: true },
      );
    await audit(
      req,
      "notifications.settings",
      "NotificationSetting",
      org,
      req.body,
    );
    res.json({ success: true });
  }),
);

// ---- templates ---------------------------------------------------------------------------
r.get(
  "/templates",
  requirePermission("settings:write"),
  ah(async (req, res) => {
    const rows = await NotificationTemplate.find({
      organization: req.user.organization,
    }).lean();
    const by = new Map(rows.map((t) => [`${t.event}:${t.channel}`, t]));
    const data = EVENT_KEYS.flatMap((e) =>
      CHANNELS.map((c) => {
        const t = by.get(`${e}:${c}`);
        return {
          event: e,
          channel: c,
          subject: t?.subject ?? EVENTS[e].title,
          body: t?.body ?? EVENTS[e].body,
          custom: !!t,
        };
      }),
    );
    res.json({ success: true, data });
  }),
);
r.put(
  "/templates/:event/:channel",
  requirePermission("settings:write"),
  validate(
    z.object({
      subject: z.string().trim().max(150).optional(),
      body: z.string().trim().min(3).max(1000),
    }),
  ),
  ah(async (req, res) => {
    const { event, channel } = req.params;
    if (!EVENTS[event] || !CHANNELS.includes(channel))
      throw notFound("Unknown event or channel");
    const t = await NotificationTemplate.findOneAndUpdate(
      { organization: req.user.organization, event, channel },
      req.body,
      { upsert: true, new: true },
    );
    res.json({ success: true, data: t });
  }),
);
r.delete(
  "/templates/:event/:channel",
  requirePermission("settings:write"),
  ah(async (req, res) => {
    await NotificationTemplate.deleteOne({
      organization: req.user.organization,
      event: req.params.event,
      channel: req.params.channel,
    });
    res.json({ success: true });
  }),
);

// ---- delivery log + test -----------------------------------------------------------------
r.get(
  "/deliveries",
  requirePermission("settings:write"),
  validate(
    pageQuery.extend({
      status: z.enum(["queued", "sent", "failed", "skipped"]).optional(),
      channel: z.enum(EXTERNAL).optional(),
    }),
    "query",
  ),
  ah(async (req, res) => {
    const q = req.query;
    const filter = {
      organization: req.user.organization,
      ...(q.status && { status: q.status }),
      ...(q.channel && { channel: q.channel }),
    };
    const [items, total] = await Promise.all([
      DeliveryAttempt.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .select("-body")
        .lean(),
      DeliveryAttempt.countDocuments(filter),
    ]);
    res.json({
      success: true,
      data: items.map((a) => ({ ...a, to: maskTo(a.to) })),
      meta: meta(q.page, q.limit, total),
    });
  }),
);

// Send a real test message to yourself on one channel and report exactly what happened.
r.post(
  "/test",
  requirePermission("settings:write"),
  validate(z.object({ channel: z.enum(CHANNELS) })),
  ah(async (req, res) => {
    const { channel } = req.body;
    const org = req.user.organization;
    if (channel === "in_app") {
      await notify("test", { org, extra: [{ userId: req.user._id }] });
      return res.json({ success: true, data: { status: "sent" } });
    }
    const u = await User.findById(req.user._id).select("email phone name");
    const to = channel === "email" ? u.email : u.phone;
    if (!to)
      throw badRequest(
        channel === "email"
          ? "Your account has no email"
          : "Add your phone number in your notification preferences first",
      );
    const a = await DA.create({
      organization: org,
      event: "test",
      channel,
      to,
      recipientName: u.name,
      subject: "Nest Transport test",
      body: render(EVENTS.test.body),
    });
    await deliver(a);
    res.json({
      success: a.status === "sent",
      data: { status: a.status, error: a.error, provider: a.provider },
    });
  }),
);

export default r;
