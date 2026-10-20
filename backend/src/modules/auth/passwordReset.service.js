import crypto from "crypto";
import { PasswordReset } from "../../models/PasswordReset.js";
import { DeliveryAttempt } from "../../models/DeliveryAttempt.js";
import { channels } from "../notifications/channels/index.js";
import { deliver } from "../notifications/notify.service.js";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const appUrl = () =>
  (
    process.env.APP_URL ??
    process.env.ALLOWED_ORIGINS?.split(",")[0] ??
    "http://localhost:5175"
  ).replace(/\/$/, "");

/** Create a new token (invalidating older unused ones for that user). Returns the link containing the raw token. */
export async function issueToken(
  userId,
  { purpose = "reset", ttlMinutes = 60 } = {},
) {
  await PasswordReset.updateMany(
    { user: userId, usedAt: null },
    { usedAt: new Date() },
  );
  const token = crypto.randomBytes(32).toString("hex");
  await PasswordReset.create({
    user: userId,
    tokenHash: sha(token),
    purpose,
    expiresAt: new Date(Date.now() + ttlMinutes * 60000),
  });
  return { token, link: `${appUrl()}/reset-password?token=${token}` };
}

/** Atomically consume a token (single use). Returns the user id or null. */
export async function consumeToken(token) {
  const row = await PasswordReset.findOneAndUpdate(
    { tokenHash: sha(token), usedAt: null, expiresAt: { $gt: new Date() } },
    { usedAt: new Date() },
    { new: true },
  );
  return row ? row.user : null;
}

/** Security emails go out whenever email is configured on the server, regardless of notification settings. */
export async function sendSecurityEmail({ org, to, name, subject, body }) {
  if (!channels.email.configured())
    return { sent: false, reason: "Email is not configured on the server" };
  const a = await DeliveryAttempt.create({
    organization: org,
    event: "security",
    channel: "email",
    to,
    recipientName: name,
    subject,
    body,
  });
  await deliver(a);
  return { sent: a.status === "sent", reason: a.error };
}
