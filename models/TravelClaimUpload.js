import mongoose from "mongoose";
const { Schema } = mongoose;
// An upload session is temporary evidence preparation, never a TA request.
// Retain expired metadata for reconciliation; no automatic Drive deletion.
const evidence = new Schema({
  uploadKey: String, driveFileId: String, folderId: String, rootId: String,
  environment: String, name: String, mimeType: String, size: Number, sha256: String,
  uploadedAt: { type: Date, default: Date.now }, removed: { type: Boolean, default: false },
});
const schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  staffType: { type: String, enum: ["Employee", "Supervisor"], required: true },
  staffId: { type: Schema.Types.ObjectId, required: true },
  requestKey: { type: String, required: true }, monthKey: { type: String, required: true },
  claimId: { type: Schema.Types.ObjectId, required: true },
  resubmit: { type: Boolean, default: false }, revision: { type: Number, default: 0 },
  evidence: { type: [evidence], default: [] }, expiresAt: { type: Date, required: true },
  submittedClaimId: { type: Schema.Types.ObjectId, ref: "TravelClaim" }, submissionHash: String,
}, { timestamps: true });
schema.index({ userId: 1, requestKey: 1 }, { unique: true });
schema.index({ userId: 1, expiresAt: 1 });
export default mongoose.model("TravelClaimUpload", schema);
