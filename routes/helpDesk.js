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

const router = express.Router();

router.get("/", authMiddleware, listHelpDeskQueries);
router.get("/unread-count", authMiddleware, getHelpDeskUnreadCount);
router.post("/", authMiddleware, createHelpDeskQuery);
router.get("/:id", authMiddleware, getHelpDeskQuery);
router.post("/:id/reply", authMiddleware, replyHelpDeskQuery);
router.patch("/:id/status", authMiddleware, updateHelpDeskStatus);

export default router;
