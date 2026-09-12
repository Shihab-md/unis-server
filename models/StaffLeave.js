import mongoose from "mongoose";
import { Schema } from "mongoose";

const staffLeaveSchema = new Schema({
  staffType: { type: String, enum: ["Employee", "Supervisor"], required: true, index: true },
  staffId: { type: Schema.Types.ObjectId, required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  schoolId: { type: Schema.Types.ObjectId, ref: "School", index: true },
  organizationType: { type: String, enum: ["HQ", "NISWAN"], required: true, index: true },
  leaveType: { type: String, required: true, trim: true, maxlength: 100 },
  isPaid: { type: Boolean, default: true },
  fromDateKey: { type: String, required: true, index: true },
  toDateKey: { type: String, required: true, index: true },
  dayType: { type: String, enum: ["Full Day", "Half Day"], default: "Full Day" },
  reason: { type: String, required: true, trim: true, maxlength: 1000 },
  remarks: { type: String, trim: true, maxlength: 1000 },
  status: {
    type: String,
    enum: ["Pending", "Approved", "Rejected", "Cancelled"],
    default: "Pending",
    index: true,
  },
  requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
  decidedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

staffLeaveSchema.index({ staffType: 1, staffId: 1, fromDateKey: 1, toDateKey: 1 });
staffLeaveSchema.index({ organizationType: 1, schoolId: 1, status: 1, fromDateKey: 1 });

const StaffLeave = mongoose.model("StaffLeave", staffLeaveSchema);
export default StaffLeave;
