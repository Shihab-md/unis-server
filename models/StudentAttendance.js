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

const studentAttendanceSchema = new Schema({
  studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
  schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
  academicYearId: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true, index: true },
  courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
  dateKey: { type: String, required: true, index: true }, // YYYY-MM-DD; avoids timezone drift
  status: {
    type: String,
    enum: ["Present", "Absent", "Leave", "Late", "Half Day", "Holiday", "Weekly Off"],
    required: true,
  },
  remarks: { type: String, trim: true, maxlength: 500 },
  isFinalized: { type: Boolean, default: false, index: true },
  markedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  finalizedBy: { type: Schema.Types.ObjectId, ref: "User" },
  finalizedAt: { type: Date },
  corrections: { type: [correctionSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

studentAttendanceSchema.index({ studentId: 1, dateKey: 1 }, { unique: true });
studentAttendanceSchema.index({ schoolId: 1, dateKey: 1, courseId: 1 });
studentAttendanceSchema.index({ academicYearId: 1, courseId: 1, dateKey: 1 });

const StudentAttendance = mongoose.model("StudentAttendance", studentAttendanceSchema);
export default StudentAttendance;
