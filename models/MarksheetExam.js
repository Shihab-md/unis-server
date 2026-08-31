import mongoose from "mongoose";
import { Schema } from "mongoose";

const marksheetPdfSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["Pending", "Generating", "Generated", "Failed"],
      default: "Pending",
      index: true,
    },
    templateVersion: { type: Number, default: null },
    combinedDriveFileId: { type: String, trim: true, default: "" },
    combinedFileName: { type: String, trim: true, default: "" },
    combinedFileSize: { type: Number, default: 0, min: 0 },
    folderPath: { type: String, trim: true, default: "" },
    individualGeneratedCount: { type: Number, default: 0, min: 0 },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    requestedAt: { type: Date, default: null },
    generatedAt: { type: Date, default: null },
    lastError: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const marksheetExamSchema = new Schema({
  schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
  acYear: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true, index: true },
  courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
  studyingYear: { type: Number, required: true, index: true },
  examType: { type: String, enum: ["Quarterly", "Half Yearly", "Annual"], required: true, index: true },
  status: { type: String, enum: ["Draft", "Finalized"], default: "Draft", index: true },
  totalStudents: { type: Number, default: 0 },

  // Official finalized marksheet artifact lifecycle. This is deliberately separate
  // from academic finalization so PDF/Drive failures never unlock or roll back marks.
  // Draft exams keep this field unset. Finalized exams start at Pending.
  marksheetPdf: { type: marksheetPdfSchema, default: undefined },

  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  finalizedBy: { type: Schema.Types.ObjectId, ref: "User" },
  finalizedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

marksheetExamSchema.index(
  { schoolId: 1, acYear: 1, courseId: 1, studyingYear: 1, examType: 1 },
  { unique: true }
);

const MarksheetExam = mongoose.model("MarksheetExam", marksheetExamSchema);
export default MarksheetExam;
