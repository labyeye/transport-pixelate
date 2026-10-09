import { Schema, model, Types } from "mongoose";
import { ROLES } from "../utils/permissions";

const userSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    phone: String,
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    // Bumped on logout / password change; refresh tokens carry it and are rejected on mismatch.
    tokenVersion: { type: Number, default: 0 },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: Date,
    lastLoginAt: Date,
  },
  { timestamps: true },
);

export interface IUser {
  _id: Types.ObjectId;
  organization: Types.ObjectId;
  name: string;
  email: string;
  role: (typeof ROLES)[number];
  status: "active" | "inactive";
  tokenVersion: number;
}
export const User = model("User", userSchema);
