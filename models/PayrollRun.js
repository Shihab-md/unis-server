import mongoose from "mongoose";
import { Schema } from "mongoose";

const payrollItemSchema = new Schema(
  {
    staffType: { type: String, enum: ["Employee", "Supervisor"], required: true },
    staffId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    staffCode: { type: String },
    name: { type: String, required: true },
    role: { type: String },
    monthlySalary: { type: Number, default: 0 },
    travellingAllowance: { type: Number, default: 0 },
    grossSalary: { type: Number, default: 0 },
    workingDays: { type: Number, required: true },
    attendanceRecordedDays: { type: Number, default: 0 },
    absentUnits: { type: Number, default: 0 },
    halfDayUnits: { type: Number, default: 0 },
    unpaidLeaveUnits: { type: Number, default: 0 },
    payableDays: { type: Number, default: 0 },
    attendanceDeduction: { type: Number, default: 0 },
    manualAllowance: { type: Number, default: 0 },
    manualDeduction: { type: Number, default: 0 },
    netSalary: { type: Number, default: 0 },
    remarks: { type: String, trim: true, maxlength: 1000 },
  },
  { _id: true }
);

const payrollRunSchema = new Schema({
  monthKey: { type: String, required: true, index: true }, // YYYY-MM
  organizationType: { type: String, enum: ["HQ", "NISWAN"], required: true, index: true },
  schoolId: { type: Schema.Types.ObjectId, ref: "School", index: true },
  workingDays: { type: Number, required: true, min: 1, max: 31 },
  status: {
    type: String,
    enum: ["Draft", "Reviewed", "Finalized", "Paid"],
    default: "Draft",
    index: true,
  },
  items: { type: [payrollItemSchema], default: [] },
  generatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
  finalizedBy: { type: Schema.Types.ObjectId, ref: "User" },
  finalizedAt: { type: Date },
  paidBy: { type: Schema.Types.ObjectId, ref: "User" },
  paidAt: { type: Date },
  paymentMethod: { type: String, trim: true },
  paymentReference: { type: String, trim: true },
  remarks: { type: String, trim: true, maxlength: 1000 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

payrollRunSchema.index(
  { monthKey: 1, organizationType: 1, schoolId: 1 },
  { unique: true }
);

const PayrollRun = mongoose.model("PayrollRun", payrollRunSchema);
export default PayrollRun;
