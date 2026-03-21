import mongoose from "mongoose";

const attachmentSchema = new mongoose.Schema(
  {
    fileName: { type: String, trim: true, required: true },
    mimeType: { type: String, trim: true, required: true },
    size: { type: Number, default: 0 },
    driveFileId: { type: String, trim: true, required: true },
    driveViewUrl: { type: String, trim: true, required: true },
    driveDownloadUrl: { type: String, trim: true, required: true },
  },
  { _id: false }
);

const inspectionReportSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 250, },
    reportDate: { type: Date, required: true, index: true, },
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true, index: true, },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true, },
    contentHtml: { type: String, required: true, },
    contentText: { type: String, default: "", },
    attachments: { type: [attachmentSchema], default: [], },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true, },
  },
  { timestamps: true }
);

inspectionReportSchema.index({ title: "text", niswan: "text", contentText: "text", });

const InspectionReport =
  mongoose.models.InspectionReport ||
  mongoose.model("InspectionReport", inspectionReportSchema);

export default InspectionReport;