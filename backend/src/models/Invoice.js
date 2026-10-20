import { Schema, model } from "mongoose";

const lineSchema = new Schema(
  {
    description: { type: String, required: true },
    kind: {
      type: String,
      enum: ["fee", "discount", "surcharge", "adjustment"],
      required: true,
    },
    amount: { type: Number, required: true, validate: Number.isInteger }, // signed: discounts are negative
    plan: { type: Schema.Types.ObjectId, ref: "FeePlan" },
    reason: String,
    addedBy: { type: Schema.Types.ObjectId, ref: "User" },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const invoiceSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    number: { type: String, required: true },
    passenger: {
      type: Schema.Types.ObjectId,
      ref: "Passenger",
      required: true,
    },
    billTo: { name: String, phone: String }, // snapshot, so later edits don't rewrite history
    period: { type: String, required: true },
    issueDate: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },
    lines: [lineSchema],
    total: { type: Number, default: 0 }, // sum of lines, never below 0
    paid: { type: Number, default: 0 }, // payments minus refunds (derived, recomputed)
    balance: { type: Number, default: 0 }, // total - paid; negative = credit
    status: {
      type: String,
      enum: ["issued", "partially_paid", "paid", "void"],
      default: "issued",
    },
    voidReason: String,
    voidedAt: Date,
    generatedKey: String, // `${passenger}:${period}`; cleared on void so a corrected invoice can be generated
    notes: String,
  },
  { timestamps: true },
);
invoiceSchema.index({ organization: 1, number: 1 }, { unique: true });
invoiceSchema.index({ organization: 1, status: 1, dueDate: 1 });
invoiceSchema.index({ organization: 1, passenger: 1, period: 1 });
invoiceSchema.index(
  { organization: 1, generatedKey: 1 },
  {
    unique: true,
    partialFilterExpression: { generatedKey: { $type: "string" } },
  },
);

export const Invoice = model("Invoice", invoiceSchema);
