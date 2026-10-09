import { Schema, model } from "mongoose";

// Latest known position per vehicle (one small document, upserted only by newer fixes).
const posSchema = new Schema({
  organization: { type: Schema.Types.ObjectId, required: true },
  vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle", required: true },
  trip: { type: Schema.Types.ObjectId, ref: "Trip" },
  source: String,
  lat: Number,
  lng: Number,
  speedKmh: Number,
  heading: Number,
  accuracyM: Number,
  recordedAt: Date,
  receivedAt: Date,
});
posSchema.index({ organization: 1, vehicle: 1 }, { unique: true });

export const VehiclePosition = model("VehiclePosition", posSchema);
