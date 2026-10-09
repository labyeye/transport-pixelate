import { Organization } from "../models/Organization.js";
import { forbidden } from "../utils/errors.js";
import { ah } from "../utils/asyncHandler.js";

/** Optional modules can be switched off per organization; everything else keeps working. */
export const requireModule = (name) =>
  ah(async (req, _res, next) => {
    const org = await Organization.findById(req.user.organization).select(
      "modules",
    );
    if (!org?.modules?.[name])
      throw forbidden("This module is not enabled for your organization");
    next();
  });
