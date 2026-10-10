import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { Organization } from "../models/Organization.js";
import { forbidden, unauthorized } from "../utils/errors.js";
import { can } from "../utils/permissions.js";
import { ah } from "../utils/asyncHandler.js";
export const protect = ah(async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer "))
    throw unauthorized("Not authorized, no token");
  let claims;
  try {
    claims = jwt.verify(header.slice(7), process.env.JWT_SECRET);
  } catch {
    throw unauthorized("Token invalid or expired");
  }
  const user = await User.findById(claims.id);
  if (!user || user.status !== "active") throw unauthorized("Account inactive");
  // Tenant check: the token's org must still match the user's org.
  if (String(user.organization) !== claims.org) throw unauthorized();
  const org = await Organization.findById(user.organization).select("status");
  if (!org || org.status !== "active")
    throw forbidden("Organization is suspended");
  req.user = user;
  next();
});
protect.meta = { kind: "protect" };

export const requirePermission = (...perms) => {
  const middleware = (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!perms.every((p) => can(req.user.role, p)))
      return next(forbidden("Insufficient permissions"));
    next();
  };
  middleware.meta = { kind: "permission", permissions: perms };
  return middleware;
};
/** Every tenant-owned query must start from this filter. */
export const orgScope = (req) => ({ organization: req.user.organization });
