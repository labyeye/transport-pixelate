import { Schema, model } from "mongoose";

export const OWNER_TYPES = [
  "vehicle",
  "driver",
  "organization",
  "expense",
  "maintenance",
  "fuel",
  "request",
];
export const DOC_TYPES = [
  "registration",
  "insurance",
  "fitness",
  "permit",
  "pollution", // vehicle
  "licence",
  "identity", // driver
  "receipt",
  "invoice",
  "attachment",
  "other",
];

const documentSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    ownerType: { type: String, enum: OWNER_TYPES, required: true },
    owner: { type: Schema.Types.ObjectId }, // absent for organization-level documents
    type: { type: String, enum: DOC_TYPES, required: true },
    title: String,
    number: { type: String, trim: true },
    issueDate: Date,
    expiryDate: Date,
    notes: String,
    verification: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
    },
    verifiedBy: { type: Schema.Types.ObjectId, ref: "User" },
    verifiedAt: Date,
    verificationNote: String,
    file: {
      storageKey: { type: String, required: true, select: false }, // never sent to clients
      originalName: String,
      mimeType: String, // detected from content, not trusted from the client
      size: Number,
      sha256: String,
    },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
documentSchema.index({
  organization: 1,
  ownerType: 1,
  owner: 1,
  archivedAt: 1,
});
documentSchema.index({ organization: 1, expiryDate: 1, archivedAt: 1 });
documentSchema.index({ organization: 1, verification: 1 });

export const Document = model("Document", documentSchema);
