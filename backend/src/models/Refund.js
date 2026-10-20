import { Schema, model } from "mongoose";

// Refunds are separate records so payment history is never rewritten.
const refundSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, required: true },
    payment: { type: Schema.Types.ObjectId, ref: "Payment", required: true },
    invoice: { type: Schema.Types.ObjectId, ref: "Invoice", required: true },
    amount: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger,
    },
    reason: { type: String, required: true },
    method: String,
    reference: String,
    by: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
refundSchema.index({ organization: 1, payment: 1 });

export const Refund = model("Refund", refundSchema);
