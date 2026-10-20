import { Schema, model } from "mongoose";

const scheduleSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    route: { type: Schema.Types.ObjectId, ref: "Route", required: true },
    tripType: {
      type: String,
      enum: ["morning", "afternoon", "outbound", "return", "custom"],
      default: "custom",
    },
    daysOfWeek: { type: [Number], required: true }, // 0=Sun..6=Sat
    startDate: { type: String, required: true }, // YYYY-MM-DD
    endDate: String,
    departureTime: { type: String, required: true }, // HH:mm, org timezone
    durationMin: { type: Number, required: true, min: 1 },
    vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle", default: null },
    driver: { type: Schema.Types.ObjectId, ref: "Driver", default: null },
    attendant: { type: Schema.Types.ObjectId, ref: "Driver", default: null },
    active: { type: Boolean, default: true },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const TripSchedule = model("TripSchedule", scheduleSchema);
