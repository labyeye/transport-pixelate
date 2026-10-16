import { Schema, model } from "mongoose";
export const ALERT_TYPES = ["overspeed", "geofence_enter", "geofence_exit"];
const alertSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    type: { type: String, enum: ALERT_TYPES, required: true },
    vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle", required: true },
    trip: { type: Schema.Types.ObjectId, ref: "Trip" },
    at: { type: Date, required: true }, // fix time, not server time
    lat: Number,
    lng: Number,
    speedKmh: Number,
    limitKmh: Number,
    geofence: { type: Schema.Types.ObjectId, ref: "Geofence" },
    geofenceName: String,
    acknowledgedAt: Date,
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
alertSchema.index({ organization: 1, at: -1 });
alertSchema.index({ organization: 1, vehicle: 1, at: -1 });
export const Alert = model("Alert", alertSchema);
