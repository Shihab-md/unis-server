import mongoose from "mongoose";
import { Schema } from "mongoose";

const auditLogSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
  role: { type: String, index: true },
  action: { type: String, required: true, index: true },
  resourceType: { type: String, required: true, index: true },
  resourceId: { type: String, index: true },
  schoolId: { type: Schema.Types.ObjectId, ref: "School", index: true },
  method: { type: String },
  path: { type: String },
  statusCode: { type: Number },
  success: { type: Boolean, index: true },
  message: { type: String },
  createdAt: { type: Date, default: Date.now, index: true },
});

auditLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
auditLogSchema.index({ schoolId: 1, createdAt: -1 });

const AuditLog = mongoose.model("AuditLog", auditLogSchema);
export default AuditLog;
