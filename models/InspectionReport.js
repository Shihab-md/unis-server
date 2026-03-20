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
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 250,
    },
    reportDate: {
      type: Date,
      required: true,
      index: true,
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      default: null,
      index: true,
    },
    schoolName: {
      type: String,
      trim: true,
      default: "",
    },
    supervisorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    supervisorName: {
      type: String,
      trim: true,
      default: "",
    },
    niswan: {
      type: String,
      trim: true,
      default: "",
    },
    acYear: {
      type: String,
      trim: true,
      required: true,
      index: true,
    },
    contentHtml: {
      type: String,
      required: true,
    },
    contentText: {
      type: String,
      default: "",
    },
    attachments: {
      type: [attachmentSchema],
      default: [],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

inspectionReportSchema.index({
  title: "text",
  supervisorName: "text",
  schoolName: "text",
  niswan: "text",
  acYear: "text",
  contentText: "text",
});

const InspectionReport =
  mongoose.models.InspectionReport ||
  mongoose.model("InspectionReport", inspectionReportSchema);

export default InspectionReport;