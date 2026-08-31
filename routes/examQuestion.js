import express from "express";
import multer from "multer";
import authMiddleware from "../middleware/authMiddlware.js";
import { auditMutation } from "../middleware/auditMiddleware.js";
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

router.get("/options", authMiddleware, getExamQuestionOptions);
router.get("/", authMiddleware, listExamQuestions);
router.post(
  "/",
  authMiddleware,
  uploadQuestionPdf,
  auditMutation({ action: "EXAM_QUESTION_CREATE", resourceType: "ExamQuestionPaper" }),
  createExamQuestion
);
router.get("/:id/downloads", authMiddleware, getExamQuestionDownloads);
router.get("/:id/file", authMiddleware, getExamQuestionFile);
router.get("/:id", authMiddleware, getExamQuestion);
router.put(
  "/:id",
  authMiddleware,
  uploadQuestionPdf,
  auditMutation({ action: "EXAM_QUESTION_UPDATE", resourceType: "ExamQuestionPaper" }),
  updateExamQuestion
);
router.delete(
  "/:id",
  authMiddleware,
  auditMutation({ action: "EXAM_QUESTION_DELETE", resourceType: "ExamQuestionPaper" }),
  deleteExamQuestion
);

export default router;
