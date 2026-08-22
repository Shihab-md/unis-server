import mongoose from "mongoose";

const notificationBroadcastSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    message: { type: String, required: true, trim: true, maxlength: 500 },

    targetRoles: [{ type: String, trim: true, index: true }],
    selectAllSchools: { type: Boolean, default: true },
    targetNiswans: [
      {
        schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", default: null },
        code: { type: String, trim: true, maxlength: 40, default: "" },
        nameEnglish: { type: String, trim: true, maxlength: 180, default: "" },
      },
    ],

    targetUserCount: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    createdByName: { type: String, trim: true, maxlength: 120, default: "" },
    createdByRole: { type: String, trim: true, maxlength: 40, default: "" },

    createdAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

notificationBroadcastSchema.index({ createdAt: -1 });
notificationBroadcastSchema.index({ createdBy: 1, createdAt: -1 });

const NotificationBroadcast = mongoose.model(
  "NotificationBroadcast",
  notificationBroadcastSchema
);

export default NotificationBroadcast;