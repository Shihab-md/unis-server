import mongoose from "mongoose";

const mobilePushTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  expoPushToken: { type: String, required: true, unique: true, index: true, maxlength: 300 },
  platform: { type: String, enum: ["android", "ios"], required: true },
  deviceName: { type: String, default: "", maxlength: 160 },
  active: { type: Boolean, default: true, index: true },
  lastSeenAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { versionKey: false });

mobilePushTokenSchema.index({ userId: 1, active: 1, updatedAt: -1 });

const MobilePushToken = mongoose.model("MobilePushToken", mobilePushTokenSchema);
export default MobilePushToken;
