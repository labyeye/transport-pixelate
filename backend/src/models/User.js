import { Schema, model } from "mongoose";
import { ROLES } from "../utils/permissions.js";
const userSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
    },
    phone: String,
    phoneVerified: { type: Boolean, default: false },
    // false from self-service sign-up until the onboarding wizard (company, fleet size, plan) is finished.
    // Defaults to true so every existing account is treated as already onboarded.
    onboarded: { type: Boolean, default: true },
    // One-time WhatsApp codes (hashed): phoneOtp verifies the number, loginOtp is passwordless sign-in.
    phoneOtpHash: { type: String, select: false },
    phoneOtpExpires: { type: Date, select: false },
    loginOtpHash: { type: String, select: false },
    loginOtpExpires: { type: Date, select: false },
    loginOtpFails: { type: Number, default: 0, select: false },
    // Authenticator-app 2FA. Secret is set at setup, totpEnabled flips once the first code is confirmed.
    totpSecret: { type: String, select: false },
    totpEnabled: { type: Boolean, default: false },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    mutedChannels: { type: [String], default: [] }, // external channels this person opted out of
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    // Bumped on logout / password change; refresh tokens carry it and are rejected on mismatch.
    tokenVersion: { type: Number, default: 0 },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: Date,
    lastLoginAt: Date,
  },
  { timestamps: true },
);
export const User = model("User", userSchema);
