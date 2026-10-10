import { Schema, model } from "mongoose";

export const REQUEST_TYPES = [
  "new_route",
  "new_stop",
  "vehicle_replacement",
  "driver_replacement",
  "additional_trip",
  "schedule_change",
  "passenger_assignment",
  "special_requirement",
  "trip_cancellation",
];
export const REQUEST_STATUSES = [
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "in_progress",
  "resolved",
  "cancelled",
];

const historySchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: "User" },
    from: String,
    to: String,
    note: String,
  },
  { _id: false },
);

const requestSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    number: { type: String, required: true },
    type: { type: String, enum: REQUEST_TYPES, required: true },
    requester: { type: Schema.Types.ObjectId, ref: "User", required: true },
    branch: String,
    effectiveDate: Date,
    related: {
      trip: { type: Schema.Types.ObjectId, ref: "Trip" },
      route: { type: Schema.Types.ObjectId, ref: "Route" },
      vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle" },
      passenger: { type: Schema.Types.ObjectId, ref: "Passenger" },
    },
    description: { type: String, required: true },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
    status: { type: String, enum: REQUEST_STATUSES, default: "submitted" },
    reviewer: { type: Schema.Types.ObjectId, ref: "User" },
    payload: { type: Schema.Types.Mixed, default: {} }, // validated per type; what gets applied on approval
    resolutionNotes: String,
    appliedChange: Schema.Types.Mixed, // summary of what approval actually changed
    applyError: String,
    history: [historySchema],
  },
  { timestamps: true },
);
requestSchema.index({ organization: 1, number: 1 }, { unique: true });
requestSchema.index({ organization: 1, status: 1, createdAt: -1 });
requestSchema.index({ organization: 1, requester: 1, createdAt: -1 });

export const TransportRequest = model("TransportRequest", requestSchema);
