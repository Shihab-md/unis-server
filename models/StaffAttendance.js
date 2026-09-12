import mongoose from "mongoose";
import { Schema } from "mongoose";

const correctionSchema = new Schema(
  {
    fromStatus: { type: String },
    toStatus: { type: String },
    reason: { type: String, trim: true },
    changedBy: { type: Schema.Types.ObjectId, ref: "User" },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const staffAttendanceSchema = new Schema({
  staffType: { type: String, enum: ["Employee", "Supervisor"], required: true, index: true },
  staffId: { type: Schema.Types.ObjectId, required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  schoolId: { type: Schema.Types.ObjectId, ref: "School", index: true },
  organizationType: { type: String, enum: ["HQ", "NISWAN"], required: true, index: true },
  dateKey: { type: String, required: true, index: true },
  status: {
    type: String,
    enum: ["Present", "Absent", "Leave", "Late", "Half Day", "Holiday", "Weekly Off"],
    required: true,
  },
  inTime: { type: String, trim: true },
  outTime: { type: String, trim: true },
  remarks: { type: String, trim: true, maxlength: 500 },
  isFinalized: { type: Boolean, default: false, index: true },
  markedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  finalizedBy: { type: Schema.Types.ObjectId, ref: "User" },
  finalizedAt: { type: Date },
  corrections: { type: [correctionSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

staffAttendanceSchema.index({ staffType: 1, staffId: 1, dateKey: 1 }, { unique: true });
staffAttendanceSchema.index({ organizationType: 1, schoolId: 1, dateKey: 1 });

const StaffAttendance = mongoose.model("StaffAttendance", staffAttendanceSchema);
export default StaffAttendance;
