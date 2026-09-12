import mongoose from "mongoose";
import { Schema } from "mongoose";

const studentLeaveSchema = new Schema({
  studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
  schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
  fromDateKey: { type: String, required: true, index: true },
  toDateKey: { type: String, required: true, index: true },
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

studentLeaveSchema.index({ studentId: 1, fromDateKey: 1, toDateKey: 1 });
studentLeaveSchema.index({ schoolId: 1, status: 1, fromDateKey: 1 });

const StudentLeave = mongoose.model("StudentLeave", studentLeaveSchema);
export default StudentLeave;
