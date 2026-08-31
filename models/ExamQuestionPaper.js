import mongoose from "mongoose";
const { Schema } = mongoose;

const examQuestionPaperSchema = new Schema(
  {
    academicYearId: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true, index: true },
    acYear: { type: String, required: true, trim: true },
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    courseCode: { type: String, default: "", trim: true },
    courseName: { type: String, required: true, trim: true },
    studyingYear: { type: Number, required: true, min: 1, max: 20, index: true },
    examType: { type: String, enum: ["Quarterly", "Half Yearly", "Annual"], required: true, index: true },

    subjectNo: { type: Number, required: true, min: 1, max: 10 },
    subjectCode: { type: String, required: true, trim: true },
    subjectName: { type: String, required: true, trim: true },
    title: { type: String, default: "", trim: true },

    examDate: { type: String, required: true, trim: true }, // YYYY-MM-DD (IST)
    examStartTime: { type: String, required: true, trim: true }, // HH:mm (IST)
    availableFrom: { type: Date, required: true, index: true },
    availableUntil: { type: Date, default: null, index: true },
    timeZone: { type: String, default: "Asia/Kolkata" },

    targetType: { type: String, enum: ["ALL", "SELECTED"], required: true, default: "ALL", index: true },
    targetSchoolIds: [{ type: Schema.Types.ObjectId, ref: "School", index: true }],

    driveFileId: { type: String, required: true, trim: true },
    driveFileName: { type: String, required: true, trim: true },
    originalFileName: { type: String, required: true, trim: true },
    fileSize: { type: Number, default: 0 },
    mimeType: { type: String, default: "application/pdf" },
    driveFolderPath: { type: String, default: "", trim: true },

    instructions: { type: String, default: "", trim: true },
    publicationStatus: { type: String, enum: ["Draft", "Published", "Closed"], default: "Draft", index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

examQuestionPaperSchema.index({ academicYearId: 1, courseId: 1, studyingYear: 1, examType: 1, subjectNo: 1 });
examQuestionPaperSchema.index({ publicationStatus: 1, availableFrom: 1, availableUntil: 1 });
examQuestionPaperSchema.index({ targetType: 1, targetSchoolIds: 1 });

export default mongoose.model("ExamQuestionPaper", examQuestionPaperSchema);
