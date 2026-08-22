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
  sendSelfTestNotification,
} from "../controllers/notificationController.js";

const router = express.Router();

// All notification endpoints are self-scoped from req.user. Clients cannot request
// another user's notification feed or register a token on another user's behalf.
router.get("/", authMiddleware, listNotifications);
router.get("/unread-count", authMiddleware, getUnreadCount);
router.patch("/read-all", authMiddleware, markAllNotificationsRead);
router.patch("/:id/read", authMiddleware, markNotificationRead);

router.post("/mobile/register", authMiddleware, registerMobilePushToken);
router.delete("/mobile/unregister", authMiddleware, unregisterMobilePushToken);

router.get("/web/public-key", authMiddleware, getWebPushPublicKey);
router.post("/web/subscribe", authMiddleware, registerWebPushSubscription);
router.delete("/web/unsubscribe", authMiddleware, unregisterWebPushSubscription);

router.post("/test", authMiddleware, sendSelfTestNotification);

export default router;
