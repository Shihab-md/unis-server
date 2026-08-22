import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";
import {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  registerMobilePushToken,
  unregisterMobilePushToken,
  getWebPushPublicKey,
  registerWebPushSubscription,
  unregisterWebPushSubscription,
  sendBroadcastNotification,
  listBroadcastNotifications,
} from "../controllers/notificationController.js";

const router = express.Router();

// All notification feed endpoints are self-scoped from req.user.
router.get("/", authMiddleware, listNotifications);
router.get("/unread-count", authMiddleware, getUnreadCount);
router.get("/sent", authMiddleware, listBroadcastNotifications);
router.post("/send", authMiddleware, sendBroadcastNotification);

router.patch("/read-all", authMiddleware, markAllNotificationsRead);
router.patch("/:id/read", authMiddleware, markNotificationRead);

router.post("/mobile/register", authMiddleware, registerMobilePushToken);
router.delete("/mobile/unregister", authMiddleware, unregisterMobilePushToken);

router.get("/web/public-key", authMiddleware, getWebPushPublicKey);
router.post("/web/subscribe", authMiddleware, registerWebPushSubscription);
router.delete("/web/unsubscribe", authMiddleware, unregisterWebPushSubscription);

export default router;