import type { HydratedDocument } from "mongoose";

declare global {
  namespace Express {
    interface Request {
      user?: HydratedDocument<{
        organization: import("mongoose").Types.ObjectId;
        name: string;
        email: string;
        role: import("./utils/permissions").Role;
        status: string;
        tokenVersion: number;
      }>;
    }
  }
}
export {};
