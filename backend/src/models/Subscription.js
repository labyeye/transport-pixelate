import { Schema, model } from "mongoose";
// One per organization. Money is integer paise, like the rest of billing.
const subscriptionSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      unique: true,
    },
    tier: { type: String, enum: ["basic", "pro"], default: "pro" },
    vehicleLimit: { type: Number, required: true, min: 1 },
    billingCycle: {
      type: String,
      enum: ["monthly", "yearly"],
      default: "monthly",
    },
    isTrial: { type: Boolean, default: false },
    trialEndDate: Date,
    startDate: Date,
    renewalDate: Date, // paid access runs to here (+ grace)
    status: { type: String, enum: ["active", "cancelled"], default: "active" },
    paymentStatus: {
      type: String,
      enum: ["none", "pending", "completed"],
      default: "none",
    },
    ratePerVehicle: Number, // paise / vehicle / month actually charged
    subtotal: Number,
    gstAmount: Number,
    amountPaid: { type: Number, default: 0 },
    offerCode: String,
    bonusMonths: { type: Number, default: 0 },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    // The order awaiting payment; verify/webhook activate from this, never from client-sent values.
    pending: {
      orderId: { type: String, index: true },
      tier: String,
      vehicles: Number,
      billingCycle: String,
      offerCode: String,
      bonusMonths: Number,
      amount: Number,
      subtotal: Number,
      gstAmount: Number,
      rate: Number,
    },
  },
  { timestamps: true },
);
export const Subscription = model("Subscription", subscriptionSchema);
