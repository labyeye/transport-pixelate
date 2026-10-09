import { Schema, model } from "mongoose";

export const TRIP_STATUSES = [
  "draft",
  "scheduled",
  "assigned",
  "ready",
  "in_progress",
  "delayed",
  "completed",
  "cancelled",
  "aborted",
];
// Statuses in which a trip holds its vehicle/driver/attendant and can conflict with others.
export const ACTIVE_STATUSES = [
  "scheduled",
  "assigned",
  "ready",
  "in_progress",
  "delayed",
];

const snapshotStop = new Schema(
  {
    name: String,
    address: String,
    location: { lat: Number, lng: Number },
    sequence: Number,
    plannedArrival: String,
    plannedDeparture: String,
    allowsPickup: Boolean,
    allowsDropoff: Boolean,
  },
  { _id: false },
);

const historySchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: "User" },
    action: String, // created | status | updated | replaced | rescheduled
    from: String,
    to: String,
    note: String,
  },
  { _id: false },
);

const tripSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    tripNumber: { type: String, required: true },
    tripType: {
      type: String,
      enum: ["morning", "afternoon", "outbound", "return", "custom"],
      default: "custom",
    },
    route: { type: Schema.Types.ObjectId, ref: "Route", required: true },
    // The route as it was when the trip was created; later route edits never change this.
    routeSnapshot: {
      version: Number,
      name: String,
      code: String,
      plannedDistanceKm: Number,
      stops: [snapshotStop],
    },
    scheduledDate: { type: String, required: true }, // YYYY-MM-DD in the organization's timezone
    scheduledDeparture: { type: Date, required: true },
    expectedArrival: { type: Date, required: true },
    vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle", default: null },
    driver: { type: Schema.Types.ObjectId, ref: "Driver", default: null },
    attendant: { type: Schema.Types.ObjectId, ref: "Driver", default: null },
    status: { type: String, enum: TRIP_STATUSES, default: "scheduled" },
    actualStart: Date,
    actualEnd: Date,
    actualDistanceKm: Number,
    delayReason: String,
    cancellationReason: String,
    notes: String,
    schedule: {
      type: Schema.Types.ObjectId,
      ref: "TripSchedule",
      default: null,
    },
    generatedKey: String, // `${scheduleId}:${date}` makes generation idempotent
    history: [historySchema],
  },
  { timestamps: true },
);

tripSchema.index({ organization: 1, tripNumber: 1 }, { unique: true });
tripSchema.index({ organization: 1, scheduledDate: 1, status: 1 });
tripSchema.index({ organization: 1, vehicle: 1, scheduledDeparture: 1 });
tripSchema.index({ organization: 1, driver: 1, scheduledDeparture: 1 });
tripSchema.index(
  { organization: 1, generatedKey: 1 },
  {
    unique: true,
    partialFilterExpression: { generatedKey: { $type: "string" } },
  },
);

export const Trip = model("Trip", tripSchema);
