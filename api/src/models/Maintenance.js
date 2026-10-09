import { Schema, model } from "mongoose";

export const MAINT_STATUSES = [
  "reported",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
];
export const MAINT_TYPES = [
  "preventive",
  "breakdown",
  "scheduled_service",
  "repair",
  "inspection",
];

const maintenanceSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    number: { type: String, required: true },
    vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle", required: true },
    type: { type: String, enum: MAINT_TYPES, required: true },
    issue: { type: String, required: true, trim: true },
    description: String,
    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
    status: { type: String, enum: MAINT_STATUSES, default: "reported" },
    reportedAt: { type: Date, default: Date.now },
    reportedBy: { type: Schema.Types.ObjectId, ref: "User" },
    scheduledDate: Date,
    startedAt: Date,
    serviceDate: Date, // actual completion date
    odometer: { type: Number, min: 0 },
    workshop: String,
    cost: { type: Number, min: 0 },
    parts: [
      {
        _id: false,
        name: { type: String, required: true },
        quantity: { type: Number, min: 0, default: 1 },
        cost: { type: Number, min: 0, default: 0 },
      },
    ],
    nextServiceDate: Date,
    nextServiceOdometer: { type: Number, min: 0 },
    notes: String,
    trip: { type: Schema.Types.ObjectId, ref: "Trip" }, // trip during which a breakdown happened
  },
  { timestamps: true },
);
maintenanceSchema.index({ organization: 1, number: 1 }, { unique: true });
maintenanceSchema.index({ organization: 1, vehicle: 1, status: 1 });
maintenanceSchema.index({ organization: 1, status: 1, scheduledDate: 1 });

export const Maintenance = model("Maintenance", maintenanceSchema);
