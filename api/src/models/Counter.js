import { Schema, model } from "mongoose";

// Per-organization sequence generator (trip numbers etc.).
const counterSchema = new Schema({
  organization: { type: Schema.Types.ObjectId, required: true },
  key: { type: String, required: true },
  seq: { type: Number, default: 0 },
});
counterSchema.index({ organization: 1, key: 1 }, { unique: true });
export const Counter = model("Counter", counterSchema);

export async function nextSeq(organization, key) {
  const c = await Counter.findOneAndUpdate(
    { organization, key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return c.seq;
}
