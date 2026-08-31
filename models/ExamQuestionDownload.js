import mongoose from "mongoose";
const { Schema } = mongoose;

const examQuestionDownloadSchema = new Schema(
  {
    questionPaperId: { type: Schema.Types.ObjectId, ref: "ExamQuestionPaper", required: true, index: true },
    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    downloadedAt: { type: Date, default: Date.now, index: true },
    userAgent: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

examQuestionDownloadSchema.index({ questionPaperId: 1, schoolId: 1, downloadedAt: -1 });
examQuestionDownloadSchema.index({ questionPaperId: 1, downloadedAt: -1 });

export default mongoose.model("ExamQuestionDownload", examQuestionDownloadSchema);
