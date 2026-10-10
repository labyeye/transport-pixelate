import { Schema, model } from "mongoose";

// Passenger-specific discount or surcharge (sibling discount, scholarship, special service...).
const chargeSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    passenger: {
      type: Schema.Types.ObjectId,
      ref: "Passenger",
      required: true,
    },
    label: { type: String, required: true, trim: true },
    type: { type: String, enum: ["discount", "surcharge"], required: true },
    mode: { type: String, enum: ["fixed", "percent"], required: true },
    value: { type: Number, required: true, min: 0 }, // minor units for fixed, 0-100 for percent
    fromPeriod: String, // inclusive, same format as invoice period (e.g. 2030-04)
    toPeriod: String,
    reason: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
chargeSchema.index({ organization: 1, passenger: 1, active: 1 });

export const PassengerCharge = model("PassengerCharge", chargeSchema);
