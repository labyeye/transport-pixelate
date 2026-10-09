import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { User } from "../../models/User";
import { Organization } from "../../models/Organization";
import { validate } from "../../middleware/validate";
import { protect } from "../../middleware/auth";
import { ah } from "../../utils/asyncHandler";
import { badRequest, conflict, unauthorized } from "../../utils/errors";
import { audit } from "../../models/AuditLog";
import { ROLE_PERMISSIONS } from "../../utils/permissions";

const r = Router();
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === "test" ? 1000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const signAccess = (u: { _id: unknown; organization: unknown }) =>
  jwt.sign({ id: String(u._id), org: String(u.organization) }, process.env.JWT_SECRET!, { expiresIn: "15m" });
const signRefresh = (u: { _id: unknown; tokenVersion: number }) =>
  jwt.sign({ id: String(u._id), v: u.tokenVersion }, process.env.JWT_REFRESH_SECRET!, { expiresIn: "30d" });

const publicUser = (u: any) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  organization: String(u.organization),
  permissions: ROLE_PERMISSIONS[u.role as keyof typeof ROLE_PERMISSIONS],
});

const registerSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  category: z.enum(["school", "employee", "institution", "contractor", "other"]).default("school"),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

// Self-service sign-up creates a new organization and its owner.
r.post("/register", loginLimiter, validate(registerSchema), ah(async (req, res) => {
  const b = req.body as z.infer<typeof registerSchema>;
  if (await User.exists({ email: b.email.toLowerCase() })) throw conflict("Email already registered");
  const org = await Organization.create({ name: b.organizationName, category: b.category });
  const user = await User.create({
    organization: org._id,
    name: b.name,
    email: b.email,
    password: await bcrypt.hash(b.password, 12),
    role: "owner",
  });
  res.status(201).json({
    success: true,
    data: { user: publicUser(user), accessToken: signAccess(user), refreshToken: signRefresh(user) },
  });
}));

const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1) });

r.post("/login", loginLimiter, validate(loginSchema), ah(async (req, res) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;
  const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
  // Same message for unknown user / wrong password to avoid account enumeration.
  const fail = () => unauthorized("Invalid email or password");
  if (!user) throw fail();
  if (user.lockedUntil && user.lockedUntil > new Date()) throw unauthorized("Account temporarily locked. Try again later.");
  if (!(await bcrypt.compare(password, user.password))) {
    user.failedLogins += 1;
    if (user.failedLogins >= MAX_FAILS) {
      user.lockedUntil = new Date(Date.now() + LOCK_MS);
      user.failedLogins = 0;
      await audit({ user: { _id: user._id, organization: user.organization }, ip: req.ip }, "auth.lockout", "User", user.id);
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
    data: { user: publicUser(user), accessToken: signAccess(user), refreshToken: signRefresh(user) },
  });
}));

r.post("/refresh", validate(z.object({ refreshToken: z.string().min(10) })), ah(async (req, res) => {
  let claims: { id: string; v: number };
  try {
    claims = jwt.verify(req.body.refreshToken, process.env.JWT_REFRESH_SECRET!) as any;
  } catch {
    throw unauthorized("Session expired");
  }
  const user = await User.findById(claims.id);
  if (!user || user.status !== "active" || user.tokenVersion !== claims.v) throw unauthorized("Session expired");
  res.json({ success: true, data: { accessToken: signAccess(user), refreshToken: signRefresh(user) } });
}));

// Logout invalidates every refresh token for the user.
r.post("/logout", protect, ah(async (req, res) => {
  await User.updateOne({ _id: req.user!._id }, { $inc: { tokenVersion: 1 } });
  res.json({ success: true });
}));

r.get("/me", protect, ah(async (req, res) => {
  res.json({ success: true, data: publicUser(req.user) });
}));

r.post("/change-password", protect, validate(z.object({ current: z.string(), next: z.string().min(8).max(128) })), ah(async (req, res) => {
  const user = await User.findById(req.user!._id).select("+password");
  if (!user || !(await bcrypt.compare(req.body.current, user.password))) throw badRequest("Current password is incorrect");
  user.password = await bcrypt.hash(req.body.next, 12);
  user.tokenVersion += 1;
  await user.save();
  await audit(req, "auth.password_change", "User", user.id);
  res.json({ success: true });
}));

export default r;
