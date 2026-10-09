import { Schema, model } from "mongoose";

export const DRIVER_STATUSES = ["active", "on_duty", "off_duty", "on_leave", "suspended", "inactive"] as const;

const driverSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    staffRole: { type: String, enum: ["driver", "attendant", "dispatcher", "other"], default: "driver" },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    address: String,
    emergencyContact: { name: String, phone: String },
    licence: {
      number: { type: String, uppercase: true, trim: true },
      class: String,
      expiryDate: Date,
    },
    joiningDate: Date,
    employmentType: { type: String, enum: ["employee", "contract"], default: "employee" },
    status: { type: String, enum: DRIVER_STATUSES, default: "active" },
    branch: String,
    assignedVehicle: { type: Schema.Types.ObjectId, ref: "Vehicle", default: null },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

driverSchema.index({ organization: 1, status: 1 });
driverSchema.index({ organization: 1, phone: 1 });
driverSchema.index(
  { organization: 1, "licence.number": 1 },
  { unique: true, partialFilterExpression: { "licence.number": { $type: "string" }, archivedAt: null } },
);

export const Driver = model("Driver", driverSchema);
