import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";
import { auditMutation } from "../middleware/auditMiddleware.js";
import { requireMasterManageRole, requireMasterReadRole } from "../middleware/authorizationMiddleware.js";
import {
  addGrade,
  deleteGrade,
  getGrade,
  getGrades,
  getGradesFromCache,
  updateGrade,
} from "../controllers/gradeController.js";

const router = express.Router();

router.get("/", authMiddleware, requireMasterReadRole, getGrades);
router.post(
  "/add",
  authMiddleware,
  requireMasterManageRole,
  auditMutation({ action: "GRADE_CREATE", resourceType: "Grade" }),
  addGrade
);
router.get("/fromCache", authMiddleware, getGradesFromCache);
router.get("/:id", authMiddleware, requireMasterReadRole, getGrade);
router.put(
  "/:id",
  authMiddleware,
  requireMasterManageRole,
  auditMutation({ action: "GRADE_UPDATE", resourceType: "Grade" }),
  updateGrade
);
router.delete(
  "/:id",
  authMiddleware,
  requireMasterManageRole,
  auditMutation({ action: "GRADE_DELETE", resourceType: "Grade" }),
  deleteGrade
);

export default router;
