import crypto from "crypto";

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
export const OTP_TTL_MS = 10 * 60 * 1000;

// ---- WhatsApp one-time codes (6 digits, stored hashed) --------------------------------------
export const generateOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");
export const hashOtp = sha;
/** Matches the same number however it was typed: +91 98765 43210, 9876543210, 919876543210. */
export const phoneVariants = (raw) => {
  const d = String(raw || "").replace(/\D/g, "").slice(-10);
  return [d, `+91${d}`, `91${d}`];
};

let fetchImpl = (...a) => fetch(...a);
export const __setFetch = (f) => (fetchImpl = f ?? ((...a) => fetch(...a)));

/** Sends the code with a pre-approved AUTHENTICATION template from the platform's own WhatsApp number. */
export async function sendWhatsAppOtp(phone, code) {
  const token = process.env.WHATSAPP_PLATFORM_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PLATFORM_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error("WhatsApp OTP is not configured on the server");
  const components = [{ type: "body", parameters: [{ type: "text", text: code }] }];
  if (process.env.WHATSAPP_OTP_HAS_BUTTON !== "false")
    components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] });
  const res = await fetchImpl(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: String(phone).replace(/\D/g, ""),
      type: "template",
      template: {
        name: process.env.WHATSAPP_OTP_TEMPLATE_NAME || "user_otp",
        language: { code: process.env.WHATSAPP_OTP_TEMPLATE_LANG || "en_US" },
        components,
      },
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.message || "WhatsApp API error");
}

// ---- TOTP (RFC 6238, SHA-1, 30s, 6 digits) -------------------------------------------------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32encode = (buf) => {
  let bits = 0, v = 0, out = "";
  for (const byte of buf) {
    v = (v << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return bits ? out + B32[(v << (5 - bits)) & 31] : out;
};
const b32decode = (s) => {
  let bits = 0, v = 0;
  const out = [];
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    v = (v << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
};
export const generateSecret = () => b32encode(crypto.randomBytes(20));
export const otpauthUrl = (email, secret) =>
  `otpauth://totp/${encodeURIComponent(`Nest Transport:${email}`)}?secret=${secret}&issuer=${encodeURIComponent("Nest Transport")}`;

export function totpAt(secret, time = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30000)));
  const h = crypto.createHmac("sha1", b32decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, "0");
}
/** Accepts the previous/current/next step, the standard allowance for clock drift and in-flight requests. */
export const verifyTotp = (code, secret) => {
  if (!secret || !/^\d{6}$/.test(String(code))) return false;
  const now = Date.now();
  return [-30000, 0, 30000].some((d) => {
    const a = Buffer.from(totpAt(secret, now + d)), b = Buffer.from(String(code));
    return crypto.timingSafeEqual(a, b);
  });
};
