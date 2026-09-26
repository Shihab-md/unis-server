import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";
import { requireReportsRole } from "../middleware/authorizationMiddleware.js";
import { requirePermission } from "../middleware/permissionMiddleware.js";
import { PERMISSIONS } from "../config/permissionCatalog.js";
import {
  getStudentDetailReport,
  exportStudentDetailReport,
  getEmployeeDetailReport,
  exportEmployeeDetailReport,
  getSupervisorDetailReport,
  exportSupervisorDetailReport,
} from "../controllers/detailedReportController.js";
import {
  getReportsHome,
  getReportMeta,
  exportReportsHome,
  getNiswanReport,
  exportNiswanReport,
} from "../controllers/reportController.js";

const router = express.Router();
router.get("/meta", authMiddleware, requirePermission(PERMISSIONS.REPORTS_VIEW), requireReportsRole, getReportMeta);
router.get("/home", authMiddleware, requirePermission(PERMISSIONS.REPORTS_VIEW), requireReportsRole, getReportsHome);
router.get("/home/export", authMiddleware, requirePermission(PERMISSIONS.REPORTS_EXPORT), requireReportsRole, exportReportsHome);
router.get("/niswan", authMiddleware, requirePermission(PERMISSIONS.REPORTS_VIEW), requireReportsRole, getNiswanReport);
router.get("/niswan/export", authMiddleware, requirePermission(PERMISSIONS.REPORTS_EXPORT), requireReportsRole, exportNiswanReport);
router.get("/students", authMiddleware, requirePermission(PERMISSIONS.REPORTS_VIEW), requireReportsRole, getStudentDetailReport);
router.get("/students/export", authMiddleware, requirePermission(PERMISSIONS.REPORTS_EXPORT), requireReportsRole, exportStudentDetailReport);
router.get("/employees", authMiddleware, requirePermission(PERMISSIONS.REPORTS_VIEW), requireReportsRole, getEmployeeDetailReport);
router.get("/employees/export", authMiddleware, requirePermission(PERMISSIONS.REPORTS_EXPORT), requireReportsRole, exportEmployeeDetailReport);
router.get("/supervisors", authMiddleware, requirePermission(PERMISSIONS.REPORTS_VIEW), requireReportsRole, getSupervisorDetailReport);
router.get("/supervisors/export", authMiddleware, requirePermission(PERMISSIONS.REPORTS_EXPORT), requireReportsRole, exportSupervisorDetailReport);
export default router;
