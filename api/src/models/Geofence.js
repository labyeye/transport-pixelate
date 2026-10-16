import { Schema, model } from "mongoose";
// Circular zone (school gate, depot, restricted area). Alerts fire when a vehicle crosses the boundary.
// ponytail: circles only, applies to every vehicle. Polygons / per-vehicle scope when a customer needs them.
const geofenceSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    center: {
      lat: { type: Number, required: true, min: -90, max: 90 },
      lng: { type: Number, required: true, min: -180, max: 180 },
    },
    radiusM: { type: Number, required: true, min: 20, max: 50000 },
    alertOn: {
      type: String,
      enum: ["enter", "exit", "both"],
      default: "both",
    },
    active: { type: Boolean, default: true },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
geofenceSchema.index({ organization: 1, archivedAt: 1 });
export const Geofence = model("Geofence", geofenceSchema);
