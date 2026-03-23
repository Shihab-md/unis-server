import express from "express";
import {
  addInspectionReport,
  getInspectionReportById,
  getInspectionReports,
  getMyInspectionReports,
  uploadInspectionReportFiles,
} from "../controllers/InspectionReportController.js";

import authMiddleware from "../middleware/authMiddlware.js";

const router = express.Router();

router.post("/add", authMiddleware, uploadInspectionReportFiles, addInspectionReport);
router.get("/", authMiddleware, getInspectionReports);
router.get("/my", authMiddleware, getMyInspectionReports);
router.get("/:id", authMiddleware, getInspectionReportById);

export default router;