import express from "express";
import {
  addInspectionReport,
  getInspectionReportById,
  getInspectionReports,
  getMyInspectionReports,
  uploadInspectionReportFiles,
} from "../controllers/InspectionReportController.js";
import authMiddleware from "../middleware/authMiddlware.js";
import { requireInspectionCreateRole, requireInspectionReadRole, requireInspectionSchoolBodyAccess } from "../middleware/authorizationMiddleware.js";
import { notifyOnSuccess } from "../middleware/notificationMiddleware.js";
import { requirePermission } from "../middleware/permissionMiddleware.js";
import { PERMISSIONS } from "../config/permissionCatalog.js";

const router = express.Router();

router.post(
  "/add",
  authMiddleware,
  requirePermission(PERMISSIONS.INSPECTION_CREATE, "You do not have permission to submit Inspection Reports."),
  requireInspectionCreateRole,
  uploadInspectionReportFiles,
  requireInspectionSchoolBodyAccess,
  notifyOnSuccess({
    type: "INSPECTION_REPORT_CREATED",
    title: "Inspection report submitted",
    message: "Inspection report submitted successfully.",
    resourceType: "inspection",
    resourceId: (_req, payload) => payload?.data?._id,
    webPath: (_req, payload) => payload?.data?._id ? `/dashboard/inspection-report/${payload.data._id}` : "/dashboard/inspection-reports",
    mobilePath: (_req, payload) => payload?.data?._id ? `/(app)/inspection/${payload.data._id}` : "/(app)/inspection",
  }),
  addInspectionReport
);
router.get("/", authMiddleware, requirePermission(PERMISSIONS.INSPECTION_VIEW, "You do not have permission to view Inspection Reports."), requireInspectionReadRole, getInspectionReports);
router.get("/my", authMiddleware, requirePermission(PERMISSIONS.INSPECTION_VIEW, "You do not have permission to view Inspection Reports."), requireInspectionReadRole, getMyInspectionReports);
router.get("/:id", authMiddleware, requirePermission(PERMISSIONS.INSPECTION_VIEW, "You do not have permission to view Inspection Reports."), requireInspectionReadRole, getInspectionReportById);

export default router;
