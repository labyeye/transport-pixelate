import { Schema, model } from "mongoose";

// Per-organization overrides of the built-in event rules and channel switches.
const settingSchema = new Schema({
  organization: { type: Schema.Types.ObjectId, required: true, unique: true },
  channels: {
    type: Map,
    of: new Schema({ enabled: Boolean }, { _id: false }),
    default: {},
  }, // email/sms/whatsapp/push
  events: {
    type: Map,
    of: new Schema(
      { enabled: Boolean, channels: [String], roles: [String] },
      { _id: false },
    ),
    default: {},
  },
});

export const NotificationSetting = model("NotificationSetting", settingSchema);
