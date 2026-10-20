import { Schema, model } from "mongoose";

// A hardware tracker (or integration) that is allowed to submit locations for one vehicle.
const deviceSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    provider: { type: String, required: true, default: "generic" }, // adapter key, see providers/index.js
    publicId: { type: String, required: true, unique: true }, // sent with every request
    externalId: String, // e.g. IMEI, informational
    keyHash: { type: String, required: true, select: false }, // sha256 of the secret; the secret is shown once
    keyPrefix: String,
    vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle", required: true },
    active: { type: Boolean, default: true },
    lastSeenAt: Date, // last accepted submission (server time)
    lastFixAt: Date, // newest device-reported timestamp
  },
  { timestamps: true },
);

export const GpsDevice = model("GpsDevice", deviceSchema);
