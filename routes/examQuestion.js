import express from "express";
import multer from "multer";
import authMiddleware from "../middleware/authMiddlware.js";
import { auditMutation } from "../middleware/auditMiddleware.js";
import { requirePermission } from "../middleware/permissionMiddleware.js";
import { PERMISSIONS } from "../config/permissionCatalog.js";
import {
  createExamQuestion,
  deleteExamQuestion,
  getExamQuestion,
  getExamQuestionDownloads,
  getExamQuestionFile,
  getExamQuestionOptions,
  listExamQuestions,
  updateExamQuestion,
} from "../controllers/examQuestionController.js";

const router = express.Router();

const questionUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const looksLikePdf = file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname || "");
    cb(looksLikePdf ? null : new Error("Only PDF question papers are allowed."), looksLikePdf);
  },
});

const uploadQuestionPdf = (req, res, next) => {
  questionUpload.single("file")(req, res, (error) => {
    if (!error) return next();
    const message = error?.code === "LIMIT_FILE_SIZE"
      ? "Question Paper PDF must be 15 MB or smaller."
      : error?.message || "Unable to upload Question Paper PDF.";
    return res.status(400).json({ success: false, error: message });
  });
};

router.get("/options", authMiddleware, requirePermission(PERMISSIONS.EXAM_QUESTION_VIEW, "You do not have permission to view Exam Question Papers."), getExamQuestionOptions);
router.get("/", authMiddleware, requirePermission(PERMISSIONS.EXAM_QUESTION_VIEW, "You do not have permission to view Exam Question Papers."), listExamQuestions);
router.post(
  "/",
  authMiddleware,
  requirePermission(PERMISSIONS.EXAM_QUESTION_CREATE, "You do not have permission to create Exam Question Papers."),
  uploadQuestionPdf,
  auditMutation({ action: "EXAM_QUESTION_CREATE", resourceType: "ExamQuestionPaper" }),
  createExamQuestion
);
router.get("/:id/downloads", authMiddleware, requirePermission(PERMISSIONS.EXAM_QUESTION_DOWNLOAD_TRACKING_VIEW, "You do not have permission to view Question Paper download tracking."), getExamQuestionDownloads);
router.get("/:id/file", authMiddleware, requirePermission(PERMISSIONS.EXAM_QUESTION_VIEW, "You do not have permission to view Exam Question Papers."), getExamQuestionFile);
router.get("/:id", authMiddleware, requirePermission(PERMISSIONS.EXAM_QUESTION_VIEW, "You do not have permission to view Exam Question Papers."), getExamQuestion);
router.put(
  "/:id",
  authMiddleware,
  requirePermission(PERMISSIONS.EXAM_QUESTION_EDIT, "You do not have permission to edit Exam Question Papers."),
  uploadQuestionPdf,
  auditMutation({ action: "EXAM_QUESTION_UPDATE", resourceType: "ExamQuestionPaper" }),
  updateExamQuestion
);
router.delete(
  "/:id",
  authMiddleware,
  requirePermission(PERMISSIONS.EXAM_QUESTION_DELETE, "You do not have permission to delete Exam Question Papers."),
  auditMutation({ action: "EXAM_QUESTION_DELETE", resourceType: "ExamQuestionPaper" }),
  deleteExamQuestion
);

export default router;
