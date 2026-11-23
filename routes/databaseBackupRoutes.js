import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";
import { requireSuperAdmin } from "../middleware/authorizationMiddleware.js";
import { auditMutation } from "../middleware/auditMiddleware.js";
import { databaseBackupStatus, databaseBackupNow } from "../controllers/databaseBackupController.js";

const router = express.Router();
router.use(authMiddleware, requireSuperAdmin);
router.get("/status", databaseBackupStatus);
router.post("/now", auditMutation({ action: "DATABASE_BACKUP_NOW", resourceType: "DatabaseBackup" }), databaseBackupNow);
export default router;
