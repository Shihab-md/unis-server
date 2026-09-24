import mongoose from "mongoose";
import { getGoogleDriveRootFolderName } from "../utils/runtimeEnvironment.js";
const { Schema } = mongoose;

export const DEMO_TUTORIAL_VIEW_ROLES = [
  "hquser",
  "supervisor",
  "admin",
  "employee",
  "teacher",
  "usthadh",
  "student",
  "parent",
  "warden",
  "staff",
  "guest",
];

const demoTutorialSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160, index: true },
    description: { type: String, default: "", trim: true, maxlength: 3000 },
    visibleRoles: [
      {
        type: String,
        enum: DEMO_TUTORIAL_VIEW_ROLES,
        index: true,
      },
    ],

    fileKind: { type: String, enum: ["PDF", "VIDEO"], required: true, index: true },
    originalFileName: { type: String, required: true, trim: true },
    driveFileName: { type: String, required: true, trim: true },
    driveFileId: { type: String, required: true, trim: true, unique: true },
    driveFolderPath: { type: String, default: () => `${getGoogleDriveRootFolderName()}/Demo-Tutorial`, trim: true },
    mimeType: { type: String, required: true, trim: true },
    fileSize: { type: Number, default: 0, min: 0 },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

demoTutorialSchema.index({ visibleRoles: 1, createdAt: -1 });
demoTutorialSchema.index({ title: "text", description: "text" });

export default mongoose.model("DemoTutorial", demoTutorialSchema);
