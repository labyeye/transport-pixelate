import { Schema, model } from "mongoose";

// One row per external message. Kept so failures are visible and retriable; contains no secrets.
const attemptSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, required: true },
    event: String,
    channel: { type: String, required: true },
    to: String, // address/phone (masked in API output)
    recipientName: String,
    subject: String,
    body: String,
    status: {
      type: String,
      enum: ["queued", "sent", "failed", "skipped"],
      default: "queued",
    },
    provider: String,
    providerMessageId: String,
    error: String,
    attempts: { type: Number, default: 0 },
    nextRetryAt: Date,
    dedupeKey: String,
    sentAt: Date,
  },
  { timestamps: true },
);
attemptSchema.index({ organization: 1, createdAt: -1 });
attemptSchema.index({ status: 1, nextRetryAt: 1 });
attemptSchema.index(
  { organization: 1, channel: 1, to: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } },
);

export const DeliveryAttempt = model("DeliveryAttempt", attemptSchema);
