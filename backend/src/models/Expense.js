import { Schema, model } from "mongoose";

export const EXPENSE_CATEGORIES = [
  "toll",
  "parking",
  "repair",
  "insurance",
  "permit_fee",
  "fine",
  "tyres",
  "cleaning",
  "other",
];

const expenseSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle" },
    trip: { type: Schema.Types.ObjectId, ref: "Trip" },
    amount: { type: Number, required: true, min: 0.01 },
    date: { type: Date, required: true },
    vendor: String,
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "upi", "bank", "other"],
      default: "cash",
    },
    notes: String,
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
    reviewNote: String,
    clientRef: String,
  },
  { timestamps: true },
);
expenseSchema.index({ organization: 1, status: 1, date: -1 });
expenseSchema.index({ organization: 1, vehicle: 1, date: -1 });
expenseSchema.index(
  { organization: 1, clientRef: 1 },
  { unique: true, partialFilterExpression: { clientRef: { $type: "string" } } },
);

export const Expense = model("Expense", expenseSchema);
