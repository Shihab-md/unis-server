import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";
import { auditMutation } from "../middleware/auditMiddleware.js";
import {
  listRolePermissions,
  resetRolePermissions,
  updateRolePermissions,
} from "../controllers/rolePermissionController.js";

const router = express.Router();

router.get("/", authMiddleware, listRolePermissions);
router.put(
  "/:role",
  authMiddleware,
  auditMutation({ action: "ROLE_PERMISSIONS_UPDATE", resourceType: "RolePermission", resourceIdParam: "role" }),
  updateRolePermissions
);
router.delete(
  "/:role",
  authMiddleware,
  auditMutation({ action: "ROLE_PERMISSIONS_RESET", resourceType: "RolePermission", resourceIdParam: "role" }),
  resetRolePermissions
);

export default router;
