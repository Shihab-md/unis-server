import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";
import { requireReportsRole } from "../middleware/authorizationMiddleware.js";
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
router.get("/meta", authMiddleware, requireReportsRole, getReportMeta);
router.get("/home", authMiddleware, requireReportsRole, getReportsHome);
router.get("/home/export", authMiddleware, requireReportsRole, exportReportsHome);
router.get("/niswan", authMiddleware, requireReportsRole, getNiswanReport);
router.get("/niswan/export", authMiddleware, requireReportsRole, exportNiswanReport);
router.get("/students", authMiddleware, requireReportsRole, getStudentDetailReport);
router.get("/students/export", authMiddleware, requireReportsRole, exportStudentDetailReport);
router.get("/employees", authMiddleware, requireReportsRole, getEmployeeDetailReport);
router.get("/employees/export", authMiddleware, requireReportsRole, exportEmployeeDetailReport);
router.get("/supervisors", authMiddleware, requireReportsRole, getSupervisorDetailReport);
router.get("/supervisors/export", authMiddleware, requireReportsRole, exportSupervisorDetailReport);
export default router;
