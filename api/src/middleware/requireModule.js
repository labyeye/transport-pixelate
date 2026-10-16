import { Organization } from "../models/Organization.js";
import { forbidden } from "../utils/errors.js";
import { ah } from "../utils/asyncHandler.js";
import {
  ensureSubscription,
  featuresFor,
} from "../modules/saas/subscription.service.js";

/** A capability that only some plans include (modules above are per-organization switches). */
export const requireFeature = (name) =>
  ah(async (req, _res, next) => {
    const sub = await ensureSubscription(req.user.organization);
    if (!featuresFor(sub)[name])
      throw forbidden("This feature is not included in your plan. Upgrade to use it.");
    next();
  });

/** Optional modules can be switched off per organization; everything else keeps working. */
export const requireModule = (name) =>
  ah(async (req, _res, next) => {
    const org = await Organization.findById(req.user.organization).select(
      "modules",
    );
    if (!org?.modules?.[name])
      throw forbidden("This module is not enabled for your organization");
    // Some modules are also a paid-tier feature.
    const sub = await ensureSubscription(req.user.organization);
    if (featuresFor(sub)[name] === false)
      throw forbidden(
        "This module is not included in your plan. Upgrade to use it.",
      );
    next();
  });
