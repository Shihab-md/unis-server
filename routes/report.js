import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";
import { requireReportsRole } from "../middleware/authorizationMiddleware.js";
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
export default router;
