import RolePermission from "../models/RolePermission.js";
import {
  PERMISSION_CATALOG,
  PERMISSION_KEY_SET,
  ROLE_DEFINITIONS,
  ROLE_KEY_SET,
  validatePermissionDependencies,
} from "../config/permissionCatalog.js";
import {
  ensureRolePermissionRecords,
  getRolePermissionSnapshot,
  normalizeRole,
  sanitizePermissions,
} from "../services/permissionService.js";

const deny = (res, message = "Only SuperAdmin can manage role permissions.") =>
  res.status(403).json({ success: false, error: message });

const ensureSuperadmin = (req, res) => {
  if (normalizeRole(req.user?.role) !== "superadmin") {
    deny(res);
    return false;
  }
  return true;
};

export const listRolePermissions = async (req, res) => {
  try {
    if (!ensureSuperadmin(req, res)) return;

    // Bootstrap missing database rows once. Existing rows are never overwritten.
    await ensureRolePermissionRecords();

    const roles = [];
    for (const roleDef of ROLE_DEFINITIONS) {
      const snapshot = await getRolePermissionSnapshot(roleDef.key);
      roles.push({
        ...roleDef,
        ...snapshot,
      });
    }

    return res.status(200).json({
      success: true,
      catalog: PERMISSION_CATALOG,
      roles,
      note: "Role permission assignments are stored in MongoDB. Data scope (All / Assigned Niswans / Own Niswan / Self) is enforced separately by the server.",
      assignmentSource: "database",
    });
  } catch (error) {
    console.log("[role-permissions] list:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to load role permissions." });
  }
};

export const updateRolePermissions = async (req, res) => {
  try {
    if (!ensureSuperadmin(req, res)) return;

    const role = normalizeRole(req.params?.role);
    if (!ROLE_KEY_SET.has(role)) {
      return res.status(400).json({ success: false, error: "Unknown role." });
    }
    if (role === "superadmin") {
      return res.status(400).json({ success: false, error: "SuperAdmin permissions are locked and cannot be changed." });
    }

    if (!Array.isArray(req.body?.permissions)) {
      return res.status(400).json({ success: false, error: "permissions must be an array." });
    }

    const requestedPermissions = req.body.permissions.map((value) => String(value || "").trim());
    const unknownPermissions = [...new Set(requestedPermissions.filter((key) => key && !PERMISSION_KEY_SET.has(key)))];
    if (unknownPermissions.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Unknown permission: ${unknownPermissions[0]}. Refresh the permission screen and try again.`,
      });
    }

    const permissions = sanitizePermissions(requestedPermissions);

    const lockedPermissions = PERMISSION_CATALOG.filter(
      (item) => permissions.includes(item.key) && item.editable === false
    );
    if (lockedPermissions.length > 0) {
      return res.status(400).json({
        success: false,
        error: `${lockedPermissions[0].label} is locked and cannot be assigned from this screen.`,
      });
    }

    const unavailablePermissions = PERMISSION_CATALOG.filter(
      (item) =>
        permissions.includes(item.key) &&
        Array.isArray(item.allowedRoles) &&
        !item.allowedRoles.includes(role)
    );
    if (unavailablePermissions.length > 0) {
      return res.status(400).json({
        success: false,
        error: `${unavailablePermissions[0].label} is not available for the ${role} role's current server scope.`,
      });
    }

    const dependencyErrors = validatePermissionDependencies(permissions);
    if (dependencyErrors.length > 0) {
      return res.status(400).json({ success: false, error: dependencyErrors[0], errors: dependencyErrors });
    }

    const expectedRevision = Number(req.body?.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return res.status(400).json({ success: false, error: "expectedRevision must be a positive integer." });
    }

    // Apply any pending permission-catalog migration before accepting a write.
    // If a stale screen/API client loaded the role before this server release, the
    // migration increments revision and the normal optimistic-lock check below
    // safely returns 409 instead of allowing the stale payload to erase new keys.
    await getRolePermissionSnapshot(role);

    const current = await RolePermission.findOne({ role }).select("_id revision").lean();
    if (!current?._id) {
      return res.status(409).json({
        success: false,
        error: "Role permission configuration is not initialized yet. Refresh the screen and try again.",
      });
    }

    const currentRevision = Number(current.revision || 0);
    if (expectedRevision !== currentRevision) {
      return res.status(409).json({
        success: false,
        error: "Role permissions changed since this screen was loaded. Refresh and try again.",
        currentRevision,
      });
    }

    const now = new Date();
    const saved = await RolePermission.findOneAndUpdate(
      { _id: current._id, revision: currentRevision },
      {
        $set: { permissions, updatedBy: req.user?._id || null, updatedAt: now },
        $inc: { revision: 1 },
      },
      { new: true }
    );

    if (!saved) {
      return res.status(409).json({
        success: false,
        error: "Role permissions changed concurrently. Refresh and try again.",
      });
    }

    const snapshot = await getRolePermissionSnapshot(role);
    return res.status(200).json({
      success: true,
      message: "Role permissions saved successfully.",
      role: snapshot,
      resourceId: saved?._id || null,
    });
  } catch (error) {
    console.log("[role-permissions] update:", error?.message || error);
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, error: "Role permissions were updated concurrently. Refresh and try again." });
    }
    return res.status(500).json({ success: false, error: "Unable to update role permissions." });
  }
};

// Backward-compatible safety response for a 9_13_43 browser that still shows the
// old Reset Defaults button while the server is being rolled out. The operation is
// intentionally non-destructive because MongoDB is now the single source of truth.
export const deprecatedResetRolePermissions = async (req, res) => {
  if (!ensureSuperadmin(req, res)) return;
  return res.status(410).json({
    success: false,
    error: "Reset Defaults has been removed. Role permissions are stored in the database. Use Discard Changes for unsaved screen changes.",
  });
};
