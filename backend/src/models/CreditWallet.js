import { Schema, model } from "mongoose";

// One wallet per organization. An organization WITHOUT a wallet (or metered:false) is not metered: WhatsApp / SMS stay free as before.
// balance/bonusBalance are integers in 1/creditsConfig.UNIT credit.
const schema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      unique: true,
    },
    metered: { type: Boolean, default: true },
    balance: { type: Number, default: 0 },
    bonusBalance: { type: Number, default: 0 },
    bonusExpiresAt: { type: Date },
    alerted: { type: String, enum: [null, "low", "zero"], default: null },
    dayKey: { type: String },
    dayCount: { type: Number, default: 0 },
    dailyCap: { type: Number },
  },
  { timestamps: true },
);

export const CreditWallet = model("CreditWallet", schema);
