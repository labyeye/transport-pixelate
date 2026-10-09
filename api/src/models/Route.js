import { Schema, model } from "mongoose";

const stopSchema = new Schema({
  name: { type: String, required: true, trim: true },
  address: { type: String, trim: true },
  location: {
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
  },
  sequence: { type: Number, required: true },
  plannedArrival: String, // "HH:mm"
  plannedDeparture: String,
  dwellMinutes: { type: Number, min: 0, default: 0 },
  allowsPickup: { type: Boolean, default: true },
  allowsDropoff: { type: Boolean, default: true },
  active: { type: Boolean, default: true },
});

const routeSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    description: String,
    category: { type: String, default: "regular" },
    branch: String,
    stops: [stopSchema],
    // Distance/duration are entered manually until a routing provider is configured.
    plannedDistanceKm: { type: Number, min: 0 },
    estimatedDurationMin: { type: Number, min: 0 },
    metricsSource: {
      type: String,
      enum: ["manual", "provider"],
      default: "manual",
    },
    assignedVehicle: {
      type: Schema.Types.ObjectId,
      ref: "Vehicle",
      default: null,
    },
    assignedDriver: {
      type: Schema.Types.ObjectId,
      ref: "Driver",
      default: null,
    },
    active: { type: Boolean, default: false },
    operatingDays: { type: [Number], default: [1, 2, 3, 4, 5] }, // 0=Sun..6=Sat
    startTime: String,
    endTime: String,
    // Bumped on every stop/schedule change so trips can snapshot a specific version.
    version: { type: Number, default: 1 },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

routeSchema.index(
  { organization: 1, code: 1 },
  { unique: true, partialFilterExpression: { archivedAt: null } },
);
routeSchema.index({ organization: 1, active: 1 });

export const Route = model("Route", routeSchema);
