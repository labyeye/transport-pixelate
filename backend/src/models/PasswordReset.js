import { Schema, model } from "mongoose";

// Single-use, short-lived tokens for forgot-password and for "set your password" invitations.
// Only a SHA-256 of the token is stored; the token itself exists only in the link.
const resetSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true },
    purpose: { type: String, enum: ["reset", "invite"], default: "reset" },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
resetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 }); // clean up a day after expiry

export const PasswordReset = model("PasswordReset", resetSchema);
