import { Schema, model } from "mongoose";

export const EVENT_TYPES = [
  "trip_created",
  "driver_assigned",
  "vehicle_assigned",
  "trip_started",
  "stop_reached",
  "passenger_boarded",
  "passenger_dropped",
  "passenger_missing",
  "delay_reported",
  "breakdown_reported",
  "incident_reported",
  "emergency_reported",
  "note",
  "trip_completed",
  "trip_cancelled",
  "trip_aborted",
  "correction",
];

// Append-only. A mistake is fixed by adding a "correction" event that points at the original;
// the original document is never modified or deleted.
const eventSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, required: true },
    trip: { type: Schema.Types.ObjectId, ref: "Trip", required: true },
    type: { type: String, enum: EVENT_TYPES, required: true },
    at: { type: Date, required: true }, // when it happened (may come from an offline device)
    receivedAt: { type: Date, default: Date.now }, // when the server saw it
    actor: { type: Schema.Types.ObjectId, ref: "User" },
    source: {
      type: String,
      enum: ["web", "mobile", "system", "device"],
      default: "web",
    },
    stopSequence: Number,
    passenger: { type: Schema.Types.ObjectId, ref: "Passenger" },
    location: { lat: Number, lng: Number },
    notes: String,
    corrects: { type: Schema.Types.ObjectId, ref: "TripEvent" }, // set on correction events
    replaces: { type: Schema.Types.ObjectId, ref: "TripEvent" }, // set on the replacement event
    clientId: String, // idempotency key for offline replay
  },
  { timestamps: false },
);
eventSchema.index({ organization: 1, trip: 1, at: 1 });
eventSchema.index({ organization: 1, trip: 1, passenger: 1 });
eventSchema.index({ organization: 1, corrects: 1 }, { sparse: true });
eventSchema.index(
  { organization: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: "string" } } },
);

export const TripEvent = model("TripEvent", eventSchema);
