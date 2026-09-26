import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";
import { auditMutation } from "../middleware/auditMiddleware.js";
import { requireMasterManageRole, requireMasterReadRole } from "../middleware/authorizationMiddleware.js";
import { requirePermission } from "../middleware/permissionMiddleware.js";
import { PERMISSIONS } from "../config/permissionCatalog.js";
import {
  addGrade,
  deleteGrade,
  getGrade,
  getGrades,
  getGradesFromCache,
  updateGrade,
} from "../controllers/gradeController.js";

const router = express.Router();

router.get("/", authMiddleware, requirePermission(PERMISSIONS.MASTER_GRADE_VIEW, "You do not have permission to view Grades."), requireMasterReadRole, getGrades);
router.post(
  "/add",
  authMiddleware,
  requirePermission(PERMISSIONS.MASTER_GRADE_CREATE, "You do not have permission to create Grades."),
  requireMasterManageRole,
  auditMutation({ action: "GRADE_CREATE", resourceType: "Grade" }),
  addGrade
);
router.get("/fromCache", authMiddleware, getGradesFromCache);
router.get("/:id", authMiddleware, requirePermission(PERMISSIONS.MASTER_GRADE_VIEW, "You do not have permission to view Grades."), requireMasterReadRole, getGrade);
router.put(
  "/:id",
  authMiddleware,
  requirePermission(PERMISSIONS.MASTER_GRADE_EDIT, "You do not have permission to edit Grades."),
  requireMasterManageRole,
  auditMutation({ action: "GRADE_UPDATE", resourceType: "Grade" }),
  updateGrade
);
router.delete(
  "/:id",
  authMiddleware,
  requirePermission(PERMISSIONS.MASTER_GRADE_DELETE, "You do not have permission to delete Grades."),
  requireMasterManageRole,
  auditMutation({ action: "GRADE_DELETE", resourceType: "Grade" }),
  deleteGrade
);

export default router;
