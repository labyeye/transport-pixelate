import { Schema, model } from "mongoose";

// High-volume history. Kept apart from Vehicle so frequent writes never touch vehicle records.
const pingSchema = new Schema({
  organization: { type: Schema.Types.ObjectId, required: true },
  vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle", required: true },
  trip: { type: Schema.Types.ObjectId, ref: "Trip" },
  device: { type: Schema.Types.ObjectId, ref: "GpsDevice" },
  source: { type: String, enum: ["device", "mobile"], required: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  speedKmh: Number,
  heading: Number,
  accuracyM: Number,
  recordedAt: { type: Date, required: true }, // when the fix was taken (device clock)
  receivedAt: { type: Date, default: Date.now }, // when the server got it
});
pingSchema.index({ organization: 1, vehicle: 1, recordedAt: -1 });
pingSchema.index({ organization: 1, receivedAt: 1 }); // retention purge
// Duplicate protection: the same device/driver cannot submit the same fix time twice for a vehicle.
pingSchema.index(
  { vehicle: 1, source: 1, device: 1, recordedAt: 1 },
  { unique: true },
);

export const LocationPing = model("LocationPing", pingSchema);
