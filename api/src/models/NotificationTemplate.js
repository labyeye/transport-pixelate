import { Schema, model } from "mongoose";

const templateSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, required: true },
    event: { type: String, required: true },
    channel: { type: String, required: true }, // in_app | email | sms | whatsapp | push
    subject: String,
    body: { type: String, required: true },
  },
  { timestamps: true },
);
templateSchema.index(
  { organization: 1, event: 1, channel: 1 },
  { unique: true },
);

export const NotificationTemplate = model(
  "NotificationTemplate",
  templateSchema,
);
