import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";
import {
  createHelpDeskQuery,
  getHelpDeskQuery,
  getHelpDeskUnreadCount,
  listHelpDeskQueries,
  replyHelpDeskQuery,
  updateHelpDeskStatus,
} from "../controllers/helpDeskController.js";
import { requirePermission } from "../middleware/permissionMiddleware.js";
import { PERMISSIONS } from "../config/permissionCatalog.js";

const router = express.Router();

router.get("/", authMiddleware, requirePermission(PERMISSIONS.HELP_DESK_VIEW), listHelpDeskQueries);
router.get("/unread-count", authMiddleware, requirePermission(PERMISSIONS.HELP_DESK_VIEW), getHelpDeskUnreadCount);
router.post("/", authMiddleware, requirePermission(PERMISSIONS.HELP_DESK_CREATE), createHelpDeskQuery);
router.get("/:id", authMiddleware, requirePermission(PERMISSIONS.HELP_DESK_VIEW), getHelpDeskQuery);
router.post("/:id/reply", authMiddleware, requirePermission(PERMISSIONS.HELP_DESK_REPLY), replyHelpDeskQuery);
router.patch("/:id/status", authMiddleware, requirePermission(PERMISSIONS.HELP_DESK_STATUS_MANAGE), updateHelpDeskStatus);

export default router;
