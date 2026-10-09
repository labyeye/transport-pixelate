// External channel adapters. Each: { key, label, configured(), send({ to, subject, body }) -> { id } }.
// send() throws on failure. Real provider calls are unverified until credentials are supplied and tested.
import nodemailer from "nodemailer";

let fetchImpl = (...a) => fetch(...a);
let mailTransport = null;
export const __setFetch = (f) => (fetchImpl = f ?? ((...a) => fetch(...a)));
export const __setMailTransport = (t) => (mailTransport = t);

const env = (k) => process.env[k];

const email = {
  key: "email",
  label: "Email (SMTP)",
  configured: () => !!(mailTransport || (env("SMTP_HOST") && env("SMTP_FROM"))),
  async send({ to, subject, body }) {
    const t =
      mailTransport ??
      (mailTransport = nodemailer.createTransport({
        host: env("SMTP_HOST"),
        port: Number(env("SMTP_PORT") ?? 587),
        secure: env("SMTP_SECURE") === "true",
        auth: env("SMTP_USER")
          ? { user: env("SMTP_USER"), pass: env("SMTP_PASS") }
          : undefined,
      }));
    const info = await t.sendMail({
      from: env("SMTP_FROM"),
      to,
      subject: subject || "Nest Transport",
      text: body,
    });
    return { id: info.messageId };
  },
};

const sms = {
  key: "sms",
  label: "SMS (Twilio)",
  configured: () =>
    !!(
      env("TWILIO_ACCOUNT_SID") &&
      env("TWILIO_AUTH_TOKEN") &&
      env("TWILIO_FROM")
    ),
  async send({ to, body }) {
    const sid = env("TWILIO_ACCOUNT_SID");
    const res = await fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${sid}:${env("TWILIO_AUTH_TOKEN")}`).toString(
              "base64",
            ),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: to,
          From: env("TWILIO_FROM"),
          Body: body,
        }),
      },
    );
    const j = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(
        `SMS provider error ${res.status}: ${j.message ?? "unknown"}`,
      );
    return { id: j.sid };
  },
};

// WhatsApp Business Cloud API. Business-initiated messages outside the 24h window need pre-approved
// templates; this adapter sends plain text, so it only reaches users in an open conversation until
// template support is added and tested with a real account.
const whatsapp = {
  key: "whatsapp",
  label: "WhatsApp (Meta Cloud API)",
  configured: () => !!(env("WHATSAPP_PHONE_ID") && env("WHATSAPP_TOKEN")),
  async send({ to, body }) {
    const res = await fetchImpl(
      `https://graph.facebook.com/v19.0/${env("WHATSAPP_PHONE_ID")}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: to.replace(/\D/g, ""),
          type: "text",
          text: { body },
        }),
      },
    );
    const j = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(
        `WhatsApp provider error ${res.status}: ${j.error?.message ?? "unknown"}`,
      );
    return { id: j.messages?.[0]?.id };
  },
};

// Push needs device registration + a service worker / native token flow that does not exist yet.
const push = {
  key: "push",
  label: "Push",
  configured: () => false,
  async send() {
    throw new Error("Push is not implemented");
  },
};

export const channels = { email, sms, whatsapp, push };
export const channelStatus = () =>
  Object.values(channels).map((c) => ({
    key: c.key,
    label: c.label,
    configured: c.configured(),
    implemented: c.key !== "push",
  }));
