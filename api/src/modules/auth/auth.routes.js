import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { User } from "../../models/User.js";
import { Organization } from "../../models/Organization.js";
import { validate } from "../../middleware/validate.js";
import { protect } from "../../middleware/auth.js";
import { ah } from "../../utils/asyncHandler.js";
import { badRequest, conflict, unauthorized } from "../../utils/errors.js";
import { audit } from "../../models/AuditLog.js";
import {
  consumeToken,
  issueToken,
  sendSecurityEmail,
} from "./passwordReset.service.js";
import { ROLE_PERMISSIONS } from "../../utils/permissions.js";
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
  permissions: ROLE_PERMISSIONS[u.role],
});
const registerSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  category: z
    .enum(["school", "employee", "institution", "contractor", "other"])
    .default("school"),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});
// Self-service sign-up creates a new organization and its owner.
r.post(
  "/register",
  loginLimiter,
  validate(registerSchema),
  ah(async (req, res) => {
    const b = req.body;
    if (await User.exists({ email: b.email.toLowerCase() }))
      throw conflict("Email already registered");
    const org = await Organization.create({
      name: b.organizationName,
      category: b.category,
    });
    const user = await User.create({
      organization: org._id,
      name: b.name,
      email: b.email,
      password: await bcrypt.hash(b.password, 12),
      role: "owner",
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
    user.lastLoginAt = new Date();
    await user.save();
    res.json({
      success: true,
      data: {
        user: publicUser(user),
        accessToken: signAccess(user),
        refreshToken: signRefresh(user),
      },
    });
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
    const u = await User.findByIdAndUpdate(
      req.user._id,
      { name: req.body.name, phone: req.body.phone },
      { new: true },
    );
    res.json({ success: true, data: publicUser(u) });
  }),
);

export default r;
