import mongoose from "mongoose";

const webPushSubscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  endpoint: { type: String, required: true, unique: true, index: true, maxlength: 2000 },
  keys: {
    p256dh: { type: String, required: true, maxlength: 500 },
    auth: { type: String, required: true, maxlength: 500 },
  },
  userAgent: { type: String, default: "", maxlength: 500 },
  active: { type: Boolean, default: true, index: true },
  lastSeenAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { versionKey: false });

webPushSubscriptionSchema.index({ userId: 1, active: 1, updatedAt: -1 });

const WebPushSubscription = mongoose.model("WebPushSubscription", webPushSubscriptionSchema);
export default WebPushSubscription;
