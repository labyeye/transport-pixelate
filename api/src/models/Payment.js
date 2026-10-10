import { Schema, model } from "mongoose";

const paymentSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    number: { type: String, required: true }, // receipt number
    invoice: { type: Schema.Types.ObjectId, ref: "Invoice", required: true },
    passenger: {
      type: Schema.Types.ObjectId,
      ref: "Passenger",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger,
    },
    method: {
      type: String,
      enum: ["cash", "upi", "card", "bank", "cheque", "razorpay"],
      required: true,
    },
    reference: String, // cheque no., UPI ref, bank txn id
    receivedAt: { type: Date, required: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User" },
    source: { type: String, enum: ["manual", "razorpay"], default: "manual" },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    clientRef: String,
    refundedAmount: { type: Number, default: 0 },
    reconciled: {
      at: Date,
      by: { type: Schema.Types.ObjectId, ref: "User" },
      reference: String,
    },
  },
  { timestamps: true },
);
paymentSchema.index({ organization: 1, number: 1 }, { unique: true });
paymentSchema.index({ organization: 1, invoice: 1 });
paymentSchema.index({ organization: 1, receivedAt: -1 });
// A provider payment can be recorded once, no matter how many times verify/webhook fire.
paymentSchema.index(
  { razorpayPaymentId: 1 },
  {
    unique: true,
    partialFilterExpression: { razorpayPaymentId: { $type: "string" } },
  },
);
paymentSchema.index(
  { organization: 1, clientRef: 1 },
  { unique: true, partialFilterExpression: { clientRef: { $type: "string" } } },
);

export const Payment = model("Payment", paymentSchema);
