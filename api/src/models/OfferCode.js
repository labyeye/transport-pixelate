import { Schema, model } from "mongoose";
// Created directly in the database for now (no super-admin surface in this product).
const offerSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    discountType: {
      type: String,
      enum: ["bonus_months", "flat_rate", "percent_off"],
      required: true,
    },
    bonusMonths: { type: Number, min: 0, default: 0 },
    flatRate: { type: Number, min: 1 }, // paise / vehicle / month
    percentOff: { type: Number, min: 1, max: 100 },
    maxUses: { type: Number, default: 200 },
    usedCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    expiresAt: Date,
  },
  { timestamps: true },
);
export const OfferCode = model("OfferCode", offerSchema);
