import mongoose from "mongoose";
const { Schema } = mongoose;
const expense = new Schema({ description: { type: String, required: true, maxlength: 200 }, amountPaise: { type: Number, required: true, min: 1 } }, { _id: false });
const evidence = new Schema({
  uploadKey: { type: String, required: true }, driveFileId: { type: String, required: true },
  folderId: { type: String, required: true }, rootId: { type: String, required: true },
  environment: { type: String, enum: ["production", "staging", "development"], required: true },
  name: { type: String, required: true }, mimeType: { type: String, required: true },
  size: { type: Number, required: true }, sha256: { type: String, required: true }, uploadedAt: { type: Date, default: Date.now },
  removed: { type: Boolean, default: false },
});
const event = new Schema({
  action: { type: String, required: true }, actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  at: { type: Date, default: Date.now }, reason: { type: String, maxlength: 1000 },
  amountPaise: Number, payrollRunId: { type: Schema.Types.ObjectId, ref: "PayrollRun" },
}, { _id: false });
const schema = new Schema({
  claimVersion: Number,
  monthKey: String,
  description: { type: String, maxlength: 2000 },
  role: String,
  employeeId: String,
  supervisorId: String,
  requestKey: { type: String, required: true }, claimNumber: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  staffType: { type: String, enum: ["Employee", "Supervisor"], required: true },
  staffId: { type: Schema.Types.ObjectId, required: true }, name: { type: String, required: true }, staffCode: String,
  fromDateKey: String, toDateKey: String, fromPlace: String, toPlace: String, purpose: String, transport: String,
  expenses: { type: [expense], default: [] }, requestedAmountPaise: { type: Number, default: 0 },
  approvedAmountPaise: { type: Number, default: 0 }, settlementMonth: String,
  evidence: { type: [evidence], default: [] },
  status: { type: String, enum: ["Draft", "Submitted", "Returned", "Approved", "PayrollReserved", "Paid", "Rejected", "Cancelled"], default: "Draft" },
  revision: { type: Number, default: 0 }, submittedAt: Date, decidedAt: Date,
  decidedBy: { type: Schema.Types.ObjectId, ref: "User" }, decisionReason: String,
  payrollRunId: { type: Schema.Types.ObjectId, ref: "PayrollRun", default: null }, payrollMonth: String, paidAt: Date,
  history: { type: [event], default: [] },
}, { timestamps: true });
schema.index({ userId: 1, requestKey: 1 }, { unique: true });
schema.index({ userId: 1, createdAt: -1 });
schema.index({ status: 1, settlementMonth: 1, staffType: 1, staffId: 1 });
schema.index({ payrollRunId: 1 });
// Existing journey-based requests have no version 2 and are retained unchanged.
schema.index({ staffType: 1, staffId: 1, monthKey: 1 }, { unique: true,
  partialFilterExpression: { claimVersion: 2 }, name: "monthly_ta_staff_month_unique" });
schema.index({ monthKey: 1, status: 1 }, { partialFilterExpression: { claimVersion: 2 } });
schema.pre("validate", function () {
  if (this.claimVersion === 2) {
    if (!["Submitted", "Approved", "Rejected"].includes(this.status)) this.invalidate("status", "Invalid monthly TA status");
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(this.monthKey || "")) this.invalidate("monthKey", "Invalid monthly TA month");
    if (!this.description?.trim()) this.invalidate("description", "Description required");
  }
});
export default mongoose.model("TravelClaim", schema);
