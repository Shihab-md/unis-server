import RolePermission from "../models/RolePermission.js";
import {
  PERMISSION_KEYS,
  PERMISSION_KEY_SET,
  ROLE_KEY_SET,
  getDefaultRolePermissions,
  getPermissionDefinition,
  isPermissionAllowedForRole,
} from "../config/permissionCatalog.js";

export const normalizeRole = (role) => String(role || "").trim().toLowerCase();

export const sanitizePermissions = (permissions = []) => {
  const values = Array.isArray(permissions) ? permissions : [];
  return [...new Set(values.map((value) => String(value || "").trim()).filter((key) => PERMISSION_KEY_SET.has(key)))].sort();
};

export const sanitizePermissionsForRole = (role, permissions = []) => {
  const normalizedRole = normalizeRole(role);
  const selected = new Set(
    sanitizePermissions(permissions).filter((key) => isPermissionAllowedForRole(key, normalizedRole))
  );

  // Fail closed if a persisted document was manually edited or came from an older
  // release with an invalid dependency combination. UI/API writes already validate
  // dependencies, but authorization should not depend on storage being perfect.
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of [...selected]) {
      const definition = getPermissionDefinition(key);
      const requirements = definition?.requires || [];
      if (requirements.some((required) => !selected.has(required))) {
        selected.delete(key);
        changed = true;
      }
    }
  }

  return [...selected].sort();
};

export const getRolePermissions = async (role) => {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === "superadmin") return [...PERMISSION_KEYS];
  if (!ROLE_KEY_SET.has(normalizedRole)) return [];

  const custom = await RolePermission.findOne({ role: normalizedRole })
    .select("permissions")
    .lean();

  return custom?._id
    ? sanitizePermissionsForRole(normalizedRole, custom.permissions)
    : sanitizePermissionsForRole(normalizedRole, getDefaultRolePermissions(normalizedRole));
};

export const getRolePermissionSnapshot = async (role) => {
  const normalizedRole = normalizeRole(role);
  const custom = await RolePermission.findOne({ role: normalizedRole })
    .select("role permissions revision updatedAt updatedBy")
    .lean();

  if (normalizedRole === "superadmin") {
    return {
      role: normalizedRole,
      permissions: [...PERMISSION_KEYS],
      source: "locked",
      revision: Number(custom?.revision || 0),
      updatedAt: custom?.updatedAt || null,
    };
  }

  return {
    role: normalizedRole,
    permissions: custom?._id
      ? sanitizePermissionsForRole(normalizedRole, custom.permissions)
      : sanitizePermissionsForRole(normalizedRole, getDefaultRolePermissions(normalizedRole)),
    source: custom?._id ? "custom" : "default",
    revision: Number(custom?.revision || 0),
    updatedAt: custom?.updatedAt || null,
  };
};

export const hasRolePermission = async (role, permission) => {
  const permissions = await getRolePermissions(role);
  return permissions.includes(String(permission || ""));
};

export const getRequestPermissions = async (req) => {
  if (Array.isArray(req?.resolvedPermissions)) return req.resolvedPermissions;
  const permissions = await getRolePermissions(req?.user?.role);
  if (req) req.resolvedPermissions = permissions;
  return permissions;
};
