import { Schema, model } from "mongoose";

// Append-only history. units is signed (debit < 0), in 1/creditsConfig.UNIT credit.
const schema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["topup", "bonus", "debit", "refund", "adjust", "skipped"],
      required: true,
    },
    units: { type: Number, required: true },
    bucket: { type: String, enum: ["main", "bonus"] },
    event: { type: String }, // channel for message rows (whatsapp / sms)
    phone: { type: String }, // masked
    wamid: { type: String, index: true, sparse: true },
    status: { type: String }, // debit: reserved | sent | refunded ; skipped
    refId: { type: String, unique: true, sparse: true }, // payment id / subscription id: makes grants idempotent
    note: { type: String },
  },
  { timestamps: true },
);
schema.index({ organization: 1, createdAt: -1 });

export const CreditLedger = model("CreditLedger", schema);
