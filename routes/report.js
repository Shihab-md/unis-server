import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";

import {
  getReportsHome,
  getReportMeta,
  exportReportsHome,
  getNiswanReport,
  exportNiswanReport,
} from "../controllers/reportController.js";

const router = express.Router();

// Meta for Filters Drawer (scoped by role)
router.get("/meta", authMiddleware, getReportMeta);

// Reports Home (KPIs + trends + previews)
router.get("/home", authMiddleware, getReportsHome);

// Export (single endpoint) - supports ?format=csv|xlsx
router.get("/home/export", authMiddleware, exportReportsHome);

// Niswan report (JSON)
router.get("/niswan", authMiddleware, getNiswanReport);

// Niswan report export (CSV/XLSX) - ?format=csv|xlsx
router.get("/niswan/export", authMiddleware, exportNiswanReport);

export default router;
