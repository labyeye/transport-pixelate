import { Schema, model } from "mongoose";

const fuelSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle", required: true },
    trip: { type: Schema.Types.ObjectId, ref: "Trip" },
    filledAt: { type: Date, required: true },
    fuelType: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0.01 }, // litres (or kg for CNG)
    pricePerUnit: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    odometer: { type: Number, required: true, min: 0 },
    fullTank: { type: Boolean, default: false }, // needed to measure (not estimate) efficiency
    station: String,
    recordedBy: { type: Schema.Types.ObjectId, ref: "User" },
    clientRef: String, // idempotency key against double submit
  },
  { timestamps: true },
);
fuelSchema.index({ organization: 1, vehicle: 1, filledAt: -1 });
fuelSchema.index(
  { organization: 1, clientRef: 1 },
  { unique: true, partialFilterExpression: { clientRef: { $type: "string" } } },
);

export const FuelLog = model("FuelLog", fuelSchema);
