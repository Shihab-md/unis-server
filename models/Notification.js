import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, required: true, trim: true, maxlength: 80, index: true },
  title: { type: String, required: true, trim: true, maxlength: 140 },
  message: { type: String, required: true, trim: true, maxlength: 500 },
  resourceType: { type: String, default: null, trim: true, maxlength: 60 },
  resourceId: { type: String, default: null, trim: true, maxlength: 120 },
  webPath: { type: String, default: null, trim: true, maxlength: 300 },
  mobilePath: { type: String, default: null, trim: true, maxlength: 300 },
  readAt: { type: Date, default: null, index: true },
  createdAt: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) },
}, { versionKey: false });

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;
