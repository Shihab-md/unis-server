import mongoose from "mongoose";
import { Schema } from "mongoose";

const ihsBulkCertificateSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, index: true },

    templateId: { type: Schema.Types.ObjectId, ref: "Template", required: true },
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },

    rollNumberText: { type: String, required: true, trim: true, index: true },
    studentNameText: { type: String, required: true, trim: true },
    guardianNameText: { type: String, required: true, trim: true },
    schoolNameText: { type: String, trim: true, default: "" },

    ihsTypeText: { type: String, required: true, trim: true },

    issueDate: { type: Date, required: true },

    certificate: { type: String, required: true },

    certificateDriveFileId: { type: String, default: "" },
    certificateDriveViewUrl: { type: String, default: "" },
    certificateDriveDownloadUrl: { type: String, default: "" },
    certificateDrivePreviewUrl: { type: String, default: "" },
    certificateFileName: { type: String, default: "" },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
  }
);

ihsBulkCertificateSchema.index(
  { templateId: 1, rollNumberText: 1 },
  { unique: true }
);

const IhsBulkCertificate = mongoose.model(
  "IhsBulkCertificate",
  ihsBulkCertificateSchema
);

export default IhsBulkCertificate;