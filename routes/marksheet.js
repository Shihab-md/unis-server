import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";
import { auditMutation } from "../middleware/auditMiddleware.js";
import {
  downloadCombinedOfficialMarksheetPdf,
  downloadStudentOfficialMarksheetPdf,
  getConsolidatedMarksheet,
  getMarksheetEntryStudents,
  getMarksheetExam,
  getMarksheetOptions,
  listConsolidatedStudents,
  listMarksheetExams,
  listMarksheetPdfFiles,
  printConsolidatedMarksheet,
  printMarksheetExam,
  requestMarksheetPdfGeneration,
  saveBulkMarksheet,
} from "../controllers/marksheetController.js";

const router = express.Router();

router.get("/options", authMiddleware, getMarksheetOptions);
router.get("/entry-students", authMiddleware, getMarksheetEntryStudents);
router.post(
  "/bulk-save",
  authMiddleware,
  auditMutation({ action: "MARKSHEET_BULK_SAVE", resourceType: "Marksheet" }),
  saveBulkMarksheet
);
router.get("/", authMiddleware, listMarksheetExams);
router.get("/consolidated-students", authMiddleware, listConsolidatedStudents);
router.get("/consolidated", authMiddleware, getConsolidatedMarksheet);
router.get("/print-consolidated", authMiddleware, printConsolidatedMarksheet);
router.get("/print/:id", authMiddleware, printMarksheetExam);
router.post(
  "/:id/pdf-request",
  authMiddleware,
  auditMutation({ action: "MARKSHEET_PDF_REQUEST", resourceType: "Marksheet" }),
  requestMarksheetPdfGeneration
);
router.get("/:id/pdf-files", authMiddleware, listMarksheetPdfFiles);
router.get("/:id/pdf-combined", authMiddleware, downloadCombinedOfficialMarksheetPdf);
router.get("/:id/pdf-student/:recordId", authMiddleware, downloadStudentOfficialMarksheetPdf);
router.get("/:id", authMiddleware, getMarksheetExam);

export default router;
