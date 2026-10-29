import { Schema, model } from "mongoose";

const schema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    user: { type: Schema.Types.ObjectId, ref: "User" },
    packId: { type: String, required: true },
    credits: { type: Number, required: true },
    price: { type: Number, required: true }, // rupees, before GST
    gst: { type: Number, required: true }, // rupees
    total: { type: Number, required: true }, // rupees, what Razorpay charged
    orderId: { type: String, required: true, unique: true },
    paymentId: { type: String },
    status: { type: String, enum: ["created", "paid"], default: "created" },
    invoiceNumber: { type: String },
    paidAt: { type: Date },
  },
  { timestamps: true },
);

export const CreditTopup = model("CreditTopup", schema);
