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
import { requirePermission } from "../middleware/permissionMiddleware.js";
import { PERMISSIONS } from "../config/permissionCatalog.js";

const router = express.Router();

// All notification feed endpoints are self-scoped from req.user.
router.get("/", authMiddleware, requirePermission(PERMISSIONS.NOTIFICATIONS_VIEW), listNotifications);
router.get("/unread-count", authMiddleware, requirePermission(PERMISSIONS.NOTIFICATIONS_VIEW), getUnreadCount);
router.get("/sent", authMiddleware, requirePermission(PERMISSIONS.NOTIFICATIONS_SENT_HISTORY_VIEW), listBroadcastNotifications);
router.post("/send", authMiddleware, requirePermission(PERMISSIONS.NOTIFICATIONS_SEND), sendBroadcastNotification);

router.patch("/read-all", authMiddleware, requirePermission(PERMISSIONS.NOTIFICATIONS_VIEW), markAllNotificationsRead);
router.patch("/:id/read", authMiddleware, requirePermission(PERMISSIONS.NOTIFICATIONS_VIEW), markNotificationRead);

router.post("/mobile/register", authMiddleware, requirePermission(PERMISSIONS.NOTIFICATIONS_VIEW), registerMobilePushToken);
router.delete("/mobile/unregister", authMiddleware, requirePermission(PERMISSIONS.NOTIFICATIONS_VIEW), unregisterMobilePushToken);

router.get("/web/public-key", authMiddleware, requirePermission(PERMISSIONS.NOTIFICATIONS_VIEW), getWebPushPublicKey);
router.post("/web/subscribe", authMiddleware, requirePermission(PERMISSIONS.NOTIFICATIONS_VIEW), registerWebPushSubscription);
router.delete("/web/unsubscribe", authMiddleware, requirePermission(PERMISSIONS.NOTIFICATIONS_VIEW), unregisterWebPushSubscription);

export default router;