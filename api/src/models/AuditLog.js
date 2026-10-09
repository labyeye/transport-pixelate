import { Schema, model } from "mongoose";
const auditSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, index: true },
    actor: { type: Schema.Types.ObjectId, ref: "User" },
    action: { type: String, required: true },
    entity: String,
    entityId: String,
    meta: Schema.Types.Mixed,
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.index({ organization: 1, createdAt: -1 });
export const AuditLog = model("AuditLog", auditSchema);
export async function audit(req, action, entity, entityId, meta) {
  try {
    await AuditLog.create({
      organization: req.user?.organization,
      actor: req.user?._id,
      action,
      entity,
      entityId: entityId ? String(entityId) : undefined,
      meta,
      ip: req.ip,
    });
  } catch {
    /* audit failures must never break the operation */
  }
}
