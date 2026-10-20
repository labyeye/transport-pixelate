import { Schema, model } from "mongoose";

// A Razorpay order created by our server for exactly one invoice and amount.
const intentSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, required: true },
    invoice: { type: Schema.Types.ObjectId, ref: "Invoice", required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    orderId: { type: String, required: true, unique: true },
    status: { type: String, enum: ["created", "paid"], default: "created" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const PaymentIntent = model("PaymentIntent", intentSchema);
