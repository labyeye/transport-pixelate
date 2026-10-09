import { Schema, model } from "mongoose";

// In-app notification for one user.
const notificationSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    event: { type: String, required: true },
    severity: {
      type: String,
      enum: ["info", "warning", "critical"],
      default: "info",
    },
    title: { type: String, required: true },
    body: String,
    link: String,
    readAt: Date,
    dedupeKey: String, // same key for the same user is stored once
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, readAt: 1 });
notificationSchema.index(
  { user: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } },
);

export const Notification = model("Notification", notificationSchema);
