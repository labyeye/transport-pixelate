import { Schema, model } from "mongoose";

// A rider: student, employee, or anyone else the organization transports.
const passengerSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    kind: {
      type: String,
      enum: ["student", "employee", "other"],
      default: "student",
    },
    identifier: { type: String, trim: true }, // admission no / employee id
    grade: String,
    phone: String,
    guardian: { name: String, phone: String },
    notes: String,
    active: { type: Boolean, default: true },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
passengerSchema.index({ organization: 1, name: 1 });
passengerSchema.index(
  { organization: 1, identifier: 1 },
  {
    unique: true,
    partialFilterExpression: {
      identifier: { $type: "string" },
      archivedAt: null,
    },
  },
);

export const Passenger = model("Passenger", passengerSchema);
