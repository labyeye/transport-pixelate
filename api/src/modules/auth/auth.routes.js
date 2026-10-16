import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { User } from "../../models/User.js";
import { Organization } from "../../models/Organization.js";
import { validate } from "../../middleware/validate.js";
import { protect, requirePermission } from "../../middleware/auth.js";
import { ah } from "../../utils/asyncHandler.js";
import { badRequest, conflict, unauthorized } from "../../utils/errors.js";
import { audit } from "../../models/AuditLog.js";
import {
  consumeToken,
  issueToken,
  sendSecurityEmail,
} from "./passwordReset.service.js";
import { ROLE_PERMISSIONS } from "../../utils/permissions.js";
import { createTrial } from "../saas/subscription.service.js";
import {
  OTP_TTL_MS,
  generateOtp,
  generateSecret,
  hashOtp,
  otpauthUrl,
  phoneVariants,
  sendWhatsAppOtp,
  verifyTotp,
} from "./otp.service.js";
const r = Router();
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === "test" ? 1000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
});
const signAccess = (u) =>
  jwt.sign(
    { id: String(u._id), org: String(u.organization) },
    process.env.JWT_SECRET,
    { expiresIn: "15m" },
  );
const signRefresh = (u) =>
  jwt.sign(
    { id: String(u._id), v: u.tokenVersion },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: "30d" },
  );
const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  organization: String(u.organization),
  phone: u.phone,
  phoneVerified: !!u.phoneVerified,
  onboarded: u.onboarded !== false,
  totpEnabled: !!u.totpEnabled,
  permissions: ROLE_PERMISSIONS[u.role],
});
const session = (u) => ({
  user: publicUser(u),
  accessToken: signAccess(u),
  refreshToken: signRefresh(u),
});
// Short-lived proof that the password step passed; only /2fa/verify accepts it.
const signTemp = (u) =>
  jwt.sign({ id: String(u._id), p: "2fa" }, process.env.JWT_SECRET, { expiresIn: "5m" });
const registerSchema = z.object({
  // Optional: the sign-up form only asks for name / email / password, the onboarding wizard fills in the rest.
  organizationName: z.string().trim().min(2).max(120).optional(),
  category: z
    .enum(["school", "employee", "institution", "contractor", "other"])
    .default("school"),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  // E.164 from the web form (+919876543210); bare digits are still accepted for older API clients.
  phone: z
    .string()
    .trim()
    .regex(/^\+?[1-9]\d{7,14}$/, "Invalid phone number")
    .optional(),
  gstNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, "Invalid GSTIN")
    .optional(),
});
// Self-service sign-up creates a new organization, its owner and a trial subscription.
r.post(
  "/register",
  loginLimiter,
  validate(registerSchema),
  ah(async (req, res) => {
    const b = req.body;
    if (await User.exists({ email: b.email.toLowerCase() }))
      throw conflict("Email already registered");
    const org = await Organization.create({
      name: b.organizationName ?? `${b.name}'s organization`,
      category: b.category,
      phone: b.phone,
      gstNumber: b.gstNumber,
    });
    await createTrial(org._id);
    const user = await User.create({
      organization: org._id,
      name: b.name,
      email: b.email,
      phone: b.phone,
      password: await bcrypt.hash(b.password, 12),
      role: "owner",
      onboarded: !!b.organizationName, // API clients that send the company up front skip the wizard
    });
    res.status(201).json({
      success: true,
      data: {
        user: publicUser(user),
        accessToken: signAccess(user),
        refreshToken: signRefresh(user),
      },
    });
  }),
);
// Onboarding wizard, step 1 and finish. `complete` flips the account to onboarded so the app stops redirecting.
const onboardingSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  category: z.enum(["school", "employee", "institution", "contractor", "other"]),
  phone: z.string().trim().regex(/^\+?[1-9]\d{7,14}$/, "Invalid phone number"),
  address: z.string().trim().max(300).optional(),
  gstNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, "Invalid GSTIN")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  complete: z.boolean().default(false),
});
r.put(
  "/onboarding",
  protect,
  requirePermission("settings:write"),
  validate(onboardingSchema),
  ah(async (req, res) => {
    const b = req.body;
    await Organization.updateOne(
      { _id: req.user.organization },
      { name: b.organizationName, category: b.category, phone: b.phone, address: b.address, gstNumber: b.gstNumber },
    );
    const set = { phone: b.phone };
    if (req.user.phone !== b.phone) set.phoneVerified = false;
    if (b.complete) set.onboarded = true;
    const u = await User.findByIdAndUpdate(req.user._id, set, { new: true });
    await audit(req, b.complete ? "onboarding.complete" : "onboarding.company", "Organization", String(req.user.organization));
    res.json({ success: true, data: publicUser(u) });
  }),
);

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});
r.post(
  "/login",
  loginLimiter,
  validate(loginSchema),
  ah(async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+password",
    );
    // Same message for unknown user / wrong password to avoid account enumeration.
    const fail = () => unauthorized("Invalid email or password");
    if (!user) throw fail();
    if (user.lockedUntil && user.lockedUntil > new Date())
      throw unauthorized("Account temporarily locked. Try again later.");
    if (!(await bcrypt.compare(password, user.password))) {
      user.failedLogins += 1;
      if (user.failedLogins >= MAX_FAILS) {
        user.lockedUntil = new Date(Date.now() + LOCK_MS);
        user.failedLogins = 0;
        await audit(
          {
            user: { _id: user._id, organization: user.organization },
            ip: req.ip,
          },
          "auth.lockout",
          "User",
          user.id,
        );
      }
      await user.save();
      throw fail();
    }
    if (user.status !== "active") throw unauthorized("Account inactive");
    user.failedLogins = 0;
    user.lockedUntil = undefined;
    if (user.totpEnabled) {
      await user.save();
      return res.json({ success: true, data: { requires2FA: true, tempToken: signTemp(user) } });
    }
    user.lastLoginAt = new Date();
    await user.save();
    res.json({ success: true, data: session(user) });
  }),
);

// Second step of a 2FA login: the temp token from /login plus the authenticator code.
r.post(
  "/2fa/verify",
  loginLimiter,
  validate(z.object({ tempToken: z.string().min(10), code: z.string().trim().regex(/^\d{6}$/) })),
  ah(async (req, res) => {
    const expired = () => unauthorized("Sign-in expired. Please start again.");
    let claims;
    try {
      claims = jwt.verify(req.body.tempToken, process.env.JWT_SECRET);
    } catch {
      throw expired();
    }
    if (claims.p !== "2fa") throw expired();
    const user = await User.findById(claims.id).select("+totpSecret");
    if (!user || user.status !== "active" || !user.totpEnabled) throw expired();
    if (user.lockedUntil && user.lockedUntil > new Date())
      throw unauthorized("Account temporarily locked. Try again later.");
    if (!verifyTotp(req.body.code, user.totpSecret)) {
      // Wrong codes count toward the same lockout as wrong passwords.
      user.failedLogins += 1;
      if (user.failedLogins >= MAX_FAILS) {
        user.lockedUntil = new Date(Date.now() + LOCK_MS);
        user.failedLogins = 0;
      }
      await user.save();
      throw unauthorized("Invalid authentication code");
    }
    user.failedLogins = 0;
    user.lastLoginAt = new Date();
    await user.save();
    res.json({ success: true, data: session(user) });
  }),
);

// ---- passwordless sign-in via WhatsApp OTP (phone must already be verified) ----------------
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === "test" ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
});
const phoneSchema = z.string().trim().regex(/^\+?\d[\d\s-]{7,15}$/, "Invalid phone number");
const otpSchema = z.string().trim().regex(/^\d{6}$/);

r.post(
  "/login/otp/send",
  otpLimiter,
  validate(z.object({ phone: phoneSchema })),
  ah(async (req, res) => {
    const user = await User.findOne({
      phone: { $in: phoneVariants(req.body.phone) },
      phoneVerified: true,
      status: "active",
    });
    if (user) {
      const otp = generateOtp();
      await User.updateOne(
        { _id: user._id },
        { loginOtpHash: hashOtp(otp), loginOtpExpires: new Date(Date.now() + OTP_TTL_MS), loginOtpFails: 0 },
      );
      try {
        await sendWhatsAppOtp(user.phone, otp);
      } catch (e) {
        console.error("Login OTP send failed:", e.message);
      }
    }
    // Same answer whether or not the number exists, to avoid phone-number enumeration.
    res.json({ success: true, message: "If that number is registered and verified, a code has been sent on WhatsApp." });
  }),
);

r.post(
  "/login/otp/verify",
  otpLimiter,
  validate(z.object({ phone: phoneSchema, otp: otpSchema })),
  ah(async (req, res) => {
    const user = await User.findOne({
      phone: { $in: phoneVariants(req.body.phone) },
      phoneVerified: true,
      status: "active",
    }).select("+loginOtpHash +loginOtpExpires +loginOtpFails");
    const bad = () => unauthorized("Invalid or expired code");
    if (!user?.loginOtpHash || !user.loginOtpExpires || user.loginOtpExpires < new Date()) throw bad();
    if (user.loginOtpHash !== hashOtp(req.body.otp)) {
      user.loginOtpFails += 1;
      if (user.loginOtpFails >= MAX_FAILS) user.loginOtpHash = undefined; // burn the code after 5 misses
      await user.save();
      throw bad();
    }
    user.loginOtpHash = undefined;
    user.loginOtpExpires = undefined;
    user.loginOtpFails = 0;
    user.lastLoginAt = new Date();
    await user.save();
    await audit({ user: { _id: user._id, organization: user.organization }, ip: req.ip }, "auth.login_otp", "User", user.id);
    res.json({ success: true, data: session(user) });
  }),
);

// ---- phone verification + authenticator setup (signed in) ----------------------------------
r.post(
  "/phone/send-otp",
  protect,
  otpLimiter,
  ah(async (req, res) => {
    if (!req.user.phone) throw badRequest("Add a phone number to your profile first");
    const otp = generateOtp();
    await User.updateOne(
      { _id: req.user._id },
      { phoneOtpHash: hashOtp(otp), phoneOtpExpires: new Date(Date.now() + OTP_TTL_MS) },
    );
    try {
      await sendWhatsAppOtp(req.user.phone, otp);
    } catch (e) {
      throw badRequest(`Could not send the code: ${e.message}`);
    }
    res.json({ success: true, message: "Code sent on WhatsApp" });
  }),
);

r.post(
  "/phone/verify-otp",
  protect,
  otpLimiter,
  validate(z.object({ otp: otpSchema })),
  ah(async (req, res) => {
    const ok = await User.findOneAndUpdate(
      { _id: req.user._id, phoneOtpHash: hashOtp(req.body.otp), phoneOtpExpires: { $gt: new Date() } },
      { phoneVerified: true, $unset: { phoneOtpHash: 1, phoneOtpExpires: 1 } },
      { new: true },
    );
    if (!ok) throw badRequest("This code is invalid or has expired");
    res.json({ success: true, data: publicUser(ok) });
  }),
);

r.post(
  "/2fa/totp/setup",
  protect,
  ah(async (req, res) => {
    if (req.user.totpEnabled) throw conflict("Authenticator app is already enabled");
    const secret = generateSecret();
    await User.updateOne({ _id: req.user._id }, { totpSecret: secret });
    res.json({ success: true, data: { secret, otpauthUrl: otpauthUrl(req.user.email, secret) } });
  }),
);

r.post(
  "/2fa/totp/verify",
  protect,
  validate(z.object({ code: otpSchema })),
  ah(async (req, res) => {
    const user = await User.findById(req.user._id).select("+totpSecret");
    if (!verifyTotp(req.body.code, user.totpSecret)) throw badRequest("Invalid authenticator code");
    user.totpEnabled = true;
    await user.save();
    await audit(req, "auth.2fa_enabled", "User", user.id);
    res.json({ success: true, data: publicUser(user) });
  }),
);

// Turning 2FA off needs the password, so a stolen unlocked phone can't strip it.
r.post(
  "/2fa/totp/disable",
  protect,
  validate(z.object({ password: z.string().min(1) })),
  ah(async (req, res) => {
    const user = await User.findById(req.user._id).select("+password");
    if (!(await bcrypt.compare(req.body.password, user.password))) throw badRequest("Password is incorrect");
    user.totpEnabled = false;
    user.totpSecret = undefined;
    await user.save();
    await audit(req, "auth.2fa_disabled", "User", user.id);
    res.json({ success: true, data: publicUser(user) });
  }),
);
r.post(
  "/refresh",
  validate(z.object({ refreshToken: z.string().min(10) })),
  ah(async (req, res) => {
    let claims;
    try {
      claims = jwt.verify(
        req.body.refreshToken,
        process.env.JWT_REFRESH_SECRET,
      );
    } catch {
      throw unauthorized("Session expired");
    }
    const user = await User.findById(claims.id);
    if (!user || user.status !== "active" || user.tokenVersion !== claims.v)
      throw unauthorized("Session expired");
    res.json({
      success: true,
      data: { accessToken: signAccess(user), refreshToken: signRefresh(user) },
    });
  }),
);
// Logout invalidates every refresh token for the user.
r.post(
  "/logout",
  protect,
  ah(async (req, res) => {
    await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
    res.json({ success: true });
  }),
);
r.get(
  "/me",
  protect,
  ah(async (req, res) => {
    res.json({ success: true, data: publicUser(req.user) });
  }),
);
r.post(
  "/change-password",
  protect,
  validate(z.object({ current: z.string(), next: z.string().min(8).max(128) })),
  ah(async (req, res) => {
    const user = await User.findById(req.user._id).select("+password");
    if (!user || !(await bcrypt.compare(req.body.current, user.password)))
      throw badRequest("Current password is incorrect");
    user.password = await bcrypt.hash(req.body.next, 12);
    user.tokenVersion += 1;
    await user.save();
    await audit(req, "auth.password_change", "User", user.id);
    res.json({ success: true });
  }),
);
// ---- password reset ------------------------------------------------------------------------
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === "test" ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// Always answers the same way so it can't be used to discover which emails have accounts.
r.post(
  "/forgot-password",
  resetLimiter,
  validate(z.object({ email: z.string().trim().email() })),
  ah(async (req, res) => {
    const user = await User.findOne({
      email: req.body.email.toLowerCase(),
      status: "active",
    });
    if (user) {
      const { link } = await issueToken(user._id, {
        purpose: "reset",
        ttlMinutes: 60,
      });
      await sendSecurityEmail({
        org: user.organization,
        to: user.email,
        name: user.name,
        subject: "Reset your Nest Transport password",
        body: `Hi ${user.name},\n\nUse this link within 60 minutes to choose a new password:\n${link}\n\nIf you didn't ask for this, ignore this email.`,
      });
      await audit(
        {
          user: { _id: user._id, organization: user.organization },
          ip: req.ip,
        },
        "auth.forgot_password",
        "User",
        user.id,
      );
    }
    res.json({
      success: true,
      message: "If that email has an account, a reset link has been sent.",
    });
  }),
);

r.post(
  "/reset-password",
  resetLimiter,
  validate(
    z.object({
      token: z.string().regex(/^[a-f\d]{64}$/i, "Invalid link"),
      password: z.string().min(8).max(128),
    }),
  ),
  ah(async (req, res) => {
    const userId = await consumeToken(req.body.token);
    if (!userId)
      throw badRequest(
        "This link is invalid or has expired. Request a new one.",
      );
    const user = await User.findById(userId);
    if (!user || user.status !== "active")
      throw badRequest(
        "This link is invalid or has expired. Request a new one.",
      );
    user.password = await bcrypt.hash(req.body.password, 12);
    user.tokenVersion += 1; // signs out every existing session
    user.failedLogins = 0;
    user.lockedUntil = undefined;
    await user.save();
    await audit(
      { user: { _id: user._id, organization: user.organization }, ip: req.ip },
      "auth.password_reset",
      "User",
      user.id,
    );
    res.json({ success: true });
  }),
);

// ---- own account ---------------------------------------------------------------------------
r.post(
  "/logout-all",
  protect,
  ah(async (req, res) => {
    await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
    await audit(req, "auth.logout_all", "User", req.user.id);
    res.json({ success: true });
  }),
);

r.put(
  "/profile",
  protect,
  validate(
    z.object({
      name: z.string().trim().min(2).max(100),
      phone: z
        .string()
        .trim()
        .regex(/^\+?\d[\d\s-]{7,15}$/, "Invalid phone number")
        .optional()
        .or(z.literal("").transform(() => undefined)),
    }),
  ),
  ah(async (req, res) => {
    const changed = req.body.phone !== req.user.phone;
    const u = await User.findByIdAndUpdate(
      req.user._id,
      { name: req.body.name, phone: req.body.phone, ...(changed ? { phoneVerified: false } : {}) },
      { new: true },
    );
    res.json({ success: true, data: publicUser(u) });
  }),
);

export default r;
