import { Schema, model } from "mongoose";
const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ["school", "employee", "institution", "contractor", "other"],
      default: "school",
    },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    gstNumber: { type: String, trim: true, uppercase: true },
    currency: { type: String, default: "INR" },
    timezone: { type: String, default: "Asia/Kolkata" },
    // Optional modules: the rest of the system works with all of these off.
    modules: {
      fuelExpenses: { type: Boolean, default: true },
      passengerManifest: { type: Boolean, default: true },
      billing: { type: Boolean, default: false },
      parentAccess: { type: Boolean, default: false },
    },
    docReminderDays: { type: [Number], default: [30, 15, 7] },
    gpsRetentionDays: { type: Number, default: 90 },
    speedLimitKmh: { type: Number, min: 10, max: 200, default: null }, // null = overspeed alerts off
    status: { type: String, enum: ["active", "suspended"], default: "active" },
  },
  { timestamps: true },
);
export const Organization = model("Organization", organizationSchema);
