import mongoose from "mongoose";
import { Schema } from "mongoose";

const marksheetPaperSchema = new Schema(
  {
    subjectNo: { type: Number, required: true },
    subjectCode: { type: String, trim: true },
    titleOfPaper: { type: String, required: true, trim: true },
    maxMarks: { type: Number, required: true, default: 0 },
    passMarks: { type: Number, required: true, default: 0 },
    obtainedMarks: { type: Number, default: null },
    result: { type: String, enum: ["P", "F", ""], default: "" },
  },
  { _id: false }
);


const studentMarksheetPdfSchema = new Schema(
  {
    driveFileId: { type: String, trim: true, default: "" },
    fileName: { type: String, trim: true, default: "" },
    fileSize: { type: Number, default: 0, min: 0 },
    templateVersion: { type: Number, default: null },
    generatedAt: { type: Date, default: null },
  },
  { _id: false }
);

const marksheetStudentSchema = new Schema({
  marksheetExamId: { type: Schema.Types.ObjectId, ref: "MarksheetExam", required: true, index: true },
  schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
  studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
  academicId: { type: Schema.Types.ObjectId, ref: "Academic", required: true, index: true },
  acYear: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true, index: true },
  courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
  studyingYear: { type: Number, required: true, index: true },
  examType: { type: String, enum: ["Quarterly", "Half Yearly", "Annual"], required: true, index: true },
  papers: [marksheetPaperSchema],
  totalMaxMarks: { type: Number, default: 0 },
  totalPassMarks: { type: Number, default: 0 },
  totalObtainedMarks: { type: Number, default: 0 },
  percentage: { type: Number, default: 0 },
  attendancePercentage: { type: Number, min: 0, max: 100, default: null },
  conduct: { type: String, trim: true, default: "" },
  grade: { type: String, trim: true, default: "" },
  result: { type: String, enum: ["Pass", "Fail", ""], default: "" },
  status: { type: String, enum: ["Draft", "Finalized"], default: "Draft", index: true },
  remarks: { type: String, trim: true },

  // Private Google Drive metadata for the future official individual PDF.
  // Controllers must never expose driveFileId to the browser.
  marksheetPdf: { type: studentMarksheetPdfSchema, default: undefined },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  finalizedBy: { type: Schema.Types.ObjectId, ref: "User" },
  finalizedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

marksheetStudentSchema.index({ marksheetExamId: 1, studentId: 1 }, { unique: true });
marksheetStudentSchema.index(
  { studentId: 1, courseId: 1, acYear: 1, studyingYear: 1, examType: 1 },
  { unique: true }
);

const MarksheetStudent = mongoose.model("MarksheetStudent", marksheetStudentSchema);
export default MarksheetStudent;
