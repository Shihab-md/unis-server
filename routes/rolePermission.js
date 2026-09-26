import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";
import { auditMutation } from "../middleware/auditMiddleware.js";
import {
  deprecatedResetRolePermissions,
  listRolePermissions,
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
// Kept for one rollout cycle only so an older frontend cannot delete the database
// configuration during a staggered deployment.
router.delete("/:role", authMiddleware, deprecatedResetRolePermissions);

export default router;
