import Notification from "../models/Notification.js";
import MobilePushToken from "../models/MobilePushToken.js";
import WebPushSubscription from "../models/WebPushSubscription.js";
import { createUserNotification, getWebPushReadiness } from "../services/notificationService.js";

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
};

export const listNotifications = async (req, res) => {
  try {
    const page = clamp(req.query.page, 1, 100000, 1);
    const limit = clamp(req.query.limit, 1, 50, 20);
    const unreadOnly = String(req.query.unreadOnly || "false").toLowerCase() === "true";
    const filter = { userId: req.user._id, ...(unreadOnly ? { readAt: null } : {}) };
    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ userId: req.user._id, readAt: null }),
    ]);
    return res.status(200).json({ success: true, notifications, page, limit, total, unreadCount, hasMore: page * limit < total });
  } catch (error) {
    console.error("[notifications] list:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to load notifications." });
  }
};

export const getUnreadCount = async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({ userId: req.user._id, readAt: null });
    return res.status(200).json({ success: true, unreadCount });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Unable to load notification count." });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: { readAt: new Date() } },
      { new: true }
    ).lean();
    if (!notification) return res.status(404).json({ success: false, error: "Notification not found." });
    return res.status(200).json({ success: true, notification });
  } catch (error) {
    if (String(error?.name || "") === "CastError") return res.status(400).json({ success: false, error: "Invalid notification id." });
    return res.status(500).json({ success: false, error: "Unable to update notification." });
  }
};

export const markAllNotificationsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany({ userId: req.user._id, readAt: null }, { $set: { readAt: new Date() } });
    return res.status(200).json({ success: true, updated: result.modifiedCount || 0 });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Unable to mark notifications as read." });
  }
};

export const registerMobilePushToken = async (req, res) => {
  try {
    const expoPushToken = String(req.body?.expoPushToken || "").trim();
    const platform = String(req.body?.platform || "").trim().toLowerCase();
    const deviceName = String(req.body?.deviceName || "").trim().slice(0, 160);
    if (!/^ExponentPushToken\[[^\]]+\]$|^ExpoPushToken\[[^\]]+\]$/.test(expoPushToken)) {
      return res.status(400).json({ success: false, error: "Invalid Expo push token." });
    }
    if (!["android", "ios"].includes(platform)) return res.status(400).json({ success: false, error: "Invalid mobile platform." });

    const token = await MobilePushToken.findOneAndUpdate(
      { expoPushToken },
      { $set: { userId: req.user._id, platform, deviceName, active: true, lastSeenAt: new Date(), updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { new: true, upsert: true }
    ).lean();
    return res.status(200).json({ success: true, registered: true, tokenId: token._id });
  } catch (error) {
    console.error("[notifications] mobile register:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to register mobile notifications." });
  }
};

export const unregisterMobilePushToken = async (req, res) => {
  try {
    const expoPushToken = String(req.body?.expoPushToken || "").trim();
    if (!expoPushToken) return res.status(400).json({ success: false, error: "Push token is required." });
    await MobilePushToken.updateOne({ expoPushToken, userId: req.user._id }, { $set: { active: false, updatedAt: new Date() } });
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Unable to unregister mobile notifications." });
  }
};

export const getWebPushPublicKey = async (req, res) => {
  const readiness = await getWebPushReadiness();
  return res.status(200).json({ success: true, configured: readiness.configured, publicKey: readiness.publicKey });
};

export const registerWebPushSubscription = async (req, res) => {
  try {
    const subscription = req.body?.subscription || req.body;
    const endpoint = String(subscription?.endpoint || "").trim();
    const p256dh = String(subscription?.keys?.p256dh || "").trim();
    const auth = String(subscription?.keys?.auth || "").trim();
    if (!endpoint.startsWith("https://") || !p256dh || !auth) {
      return res.status(400).json({ success: false, error: "Invalid Web Push subscription." });
    }
    const row = await WebPushSubscription.findOneAndUpdate(
      { endpoint },
      { $set: { userId: req.user._id, keys: { p256dh, auth }, userAgent: String(req.headers["user-agent"] || "").slice(0, 500), active: true, lastSeenAt: new Date(), updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { new: true, upsert: true }
    ).lean();
    return res.status(200).json({ success: true, registered: true, subscriptionId: row._id });
  } catch (error) {
    console.error("[notifications] web subscribe:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to register browser notifications." });
  }
};

export const unregisterWebPushSubscription = async (req, res) => {
  try {
    const endpoint = String(req.body?.endpoint || "").trim();
    if (!endpoint) return res.status(400).json({ success: false, error: "Push endpoint is required." });
    await WebPushSubscription.updateOne({ endpoint, userId: req.user._id }, { $set: { active: false, updatedAt: new Date() } });
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Unable to unregister browser notifications." });
  }
};

export const sendSelfTestNotification = async (req, res) => {
  try {
    const notification = await createUserNotification({
      userId: req.user._id,
      type: "system.test",
      title: "UNIS notifications are ready",
      message: "This is a test notification for your current UNIS account.",
      resourceType: "System",
      webPath: "/dashboard/notifications",
      mobilePath: "/(app)/notifications",
    });
    return res.status(200).json({ success: true, notificationId: notification?._id || null });
  } catch (error) {
    console.error("[notifications] test:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to send test notification." });
  }
};
