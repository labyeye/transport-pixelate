import { Schema, model } from "mongoose";

// What a passenger is charged. All money in this module is an INTEGER in minor units (paise).
const feePlanSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ["route", "stop", "flat"], required: true },
    route: { type: Schema.Types.ObjectId, ref: "Route" }, // required for route and stop plans
    stopName: String, // required for stop plans
    amount: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isInteger,
    },
    frequency: {
      type: String,
      enum: ["monthly", "term", "one_time"],
      default: "monthly",
    },
    active: { type: Boolean, default: true },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
feePlanSchema.index({ organization: 1, kind: 1, route: 1, active: 1 });

export const FeePlan = model("FeePlan", feePlanSchema);
