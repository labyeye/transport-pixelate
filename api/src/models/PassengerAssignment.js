import { Schema, model } from "mongoose";

// Which route a passenger rides and where they get on / off.
const assignmentSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    passenger: {
      type: Schema.Types.ObjectId,
      ref: "Passenger",
      required: true,
    },
    route: { type: Schema.Types.ObjectId, ref: "Route", required: true },
    pickupStop: { type: String, required: true }, // stop name on the route
    dropStop: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
assignmentSchema.index({ organization: 1, route: 1, active: 1 });
assignmentSchema.index(
  { organization: 1, passenger: 1, route: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);

export const PassengerAssignment = model(
  "PassengerAssignment",
  assignmentSchema,
);
