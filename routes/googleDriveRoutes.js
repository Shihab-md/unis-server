import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";

import {
  getAuthUrl,
  callback,
  status,
  disconnect,
  uploadProof,
  upload,
} from "../controllers/googleDriveController.js";

const router = express.Router();

router.get("/auth-url", authMiddleware, getAuthUrl);
router.get("/callback", callback);
router.get("/status", authMiddleware, status);
router.delete("/disconnect", authMiddleware, disconnect);

router.post("/upload-proof", authMiddleware, upload.single("file"), uploadProof);

export default router;