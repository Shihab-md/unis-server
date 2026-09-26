import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";
import { requireHQOrHqAdmin } from "../middleware/authorizationMiddleware.js";
import {
  createTempSchoolMarksheets,
  getTempSchoolTemplateInfo,
} from "../controllers/tempSchoolMarksheetController.js";
import { requirePermission } from "../middleware/permissionMiddleware.js";
import { PERMISSIONS } from "../config/permissionCatalog.js";

const router = express.Router();

router.get(
  "/template-info",
  authMiddleware,
  requirePermission(
    PERMISSIONS.TEMP_SCHOOL_MARKSHEET_CREATE,
    "You do not have permission to create temporary school marksheets."
  ),
  requireHQOrHqAdmin,
  getTempSchoolTemplateInfo
);
router.post(
  "/create",
  authMiddleware,
  requirePermission(
    PERMISSIONS.TEMP_SCHOOL_MARKSHEET_CREATE,
    "You do not have permission to create temporary school marksheets."
  ),
  requireHQOrHqAdmin,
  createTempSchoolMarksheets
);

export default router;
