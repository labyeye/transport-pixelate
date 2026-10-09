import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User";
import { Organization } from "../models/Organization";
import { forbidden, unauthorized } from "../utils/errors";
import { can, Permission } from "../utils/permissions";
import { ah } from "../utils/asyncHandler";

export interface AccessClaims {
  id: string;
  org: string;
}

export const protect = ah(async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw unauthorized("Not authorized, no token");
  let claims: AccessClaims;
  try {
    claims = jwt.verify(header.slice(7), process.env.JWT_SECRET!) as AccessClaims;
  } catch {
    throw unauthorized("Token invalid or expired");
  }
  const user = await User.findById(claims.id);
  if (!user || user.status !== "active") throw unauthorized("Account inactive");
  // Tenant check: the token's org must still match the user's org.
  if (String(user.organization) !== claims.org) throw unauthorized();
  const org = await Organization.findById(user.organization).select("status");
  if (!org || org.status !== "active") throw forbidden("Organization is suspended");
  req.user = user;
  next();
});

export const requirePermission =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!perms.every((p) => can(req.user!.role, p))) return next(forbidden("Insufficient permissions"));
    next();
  };

/** Every tenant-owned query must start from this filter. */
export const orgScope = (req: Request) => ({ organization: req.user!.organization });
