import { Schema, model } from "mongoose";

export const VEHICLE_STATUSES = ["available", "assigned", "on_trip", "maintenance", "out_of_service", "inactive"] as const;

const docSub = new Schema(
  {
    number: String,
    issueDate: Date,
    expiryDate: Date,
    verified: { type: Boolean, default: false },
  },
  { _id: false },
);

const vehicleSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    registrationNumber: { type: String, required: true, uppercase: true, trim: true },
    fleetNumber: { type: String, trim: true },
    category: { type: String, default: "bus" }, // configurable per org: bus, van, car, truck...
    make: String,
    model: String,
    year: Number,
    capacity: { type: Number, min: 1 },
    fuelType: { type: String, enum: ["diesel", "petrol", "cng", "electric", "hybrid", "other"], default: "diesel" },
    tankCapacity: Number,
    odometer: { type: Number, default: 0, min: 0 },
    ownership: { type: String, enum: ["owned", "leased", "contracted"], default: "owned" },
    status: { type: String, enum: VEHICLE_STATUSES, default: "available" },
    branch: String,
    assignedDriver: { type: Schema.Types.ObjectId, ref: "Driver", default: null },
    assignedRoute: { type: Schema.Types.ObjectId, ref: "Route", default: null },
    gpsDevice: { provider: String, deviceId: String },
    documents: {
      insurance: docSub,
      registration: docSub,
      fitness: docSub,
      permit: docSub,
      pollution: docSub,
    },
    notes: String,
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Registration numbers are unique per organization among non-archived vehicles.
vehicleSchema.index(
  { organization: 1, registrationNumber: 1 },
  { unique: true, partialFilterExpression: { archivedAt: null } },
);
vehicleSchema.index({ organization: 1, status: 1 });
vehicleSchema.index({ organization: 1, assignedDriver: 1 });

export const Vehicle = model("Vehicle", vehicleSchema);
