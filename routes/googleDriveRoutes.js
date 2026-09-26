import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";
import { requireHQ } from "../middleware/authorizationMiddleware.js";
import { auditMutation } from "../middleware/auditMiddleware.js";
import { requirePermission } from "../middleware/permissionMiddleware.js";
import { PERMISSIONS } from "../config/permissionCatalog.js";

import {
  getAuthUrl,
  callback,
  status,
  disconnect,
  uploadProof,
  upload,
} from "../controllers/googleDriveController.js";

const router = express.Router();

router.get("/auth-url", authMiddleware, requireHQ, getAuthUrl);
router.get("/callback", callback);
router.get("/status", authMiddleware, requireHQ, status);
router.delete("/disconnect", authMiddleware, auditMutation({ action: "GOOGLE_DRIVE_DISCONNECT", resourceType: "Integration" }), requireHQ, disconnect);

router.post(
  "/upload-proof",
  authMiddleware,
  requirePermission(PERMISSIONS.ACCOUNTS_PAYMENT_BATCH_SUBMIT, "You do not have permission to upload payment-batch proof."),
  upload.single("file"),
  uploadProof
);

export default router;