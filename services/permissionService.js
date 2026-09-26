import RolePermission from "../models/RolePermission.js";
import {
  PERMISSION_KEYS,
  PERMISSION_KEY_SET,
  ROLE_DEFINITIONS,
  ROLE_KEY_SET,
  getInitialRolePermissionsForBootstrap,
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

  // Fail closed if persisted data was manually edited or came from an older release
  // with an invalid dependency combination. API/UI writes validate dependencies too.
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

const findRolePermissionRecord = (role) =>
  RolePermission.findOne({ role })
    .select("role permissions revision updatedAt updatedBy createdAt")
    .lean();

// Creates the database source-of-truth row only when a role has never been
// configured. $setOnInsert guarantees that a later deployment never overwrites
// permissions already saved by SuperAdmin.
export const ensureRolePermissionRecord = async (role) => {
  const normalizedRole = normalizeRole(role);
  if (!ROLE_KEY_SET.has(normalizedRole) || normalizedRole === "superadmin") return null;

  const existing = await findRolePermissionRecord(normalizedRole);
  if (existing?._id) return existing;

  const now = new Date();
  const initialPermissions = sanitizePermissionsForRole(
    normalizedRole,
    getInitialRolePermissionsForBootstrap(normalizedRole)
  );

  try {
    return await RolePermission.findOneAndUpdate(
      { role: normalizedRole },
      {
        $setOnInsert: {
          role: normalizedRole,
          permissions: initialPermissions,
          revision: 1,
          updatedBy: null,
          createdAt: now,
          updatedAt: now,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    )
      .select("role permissions revision updatedAt updatedBy createdAt")
      .lean();
  } catch (error) {
    // Two serverless invocations can race to create the same unique role row.
    // If another invocation won, use the row it created; never overwrite it.
    if (error?.code === 11000) return findRolePermissionRecord(normalizedRole);
    throw error;
  }
};

export const ensureRolePermissionRecords = async () => {
  const editableRoles = ROLE_DEFINITIONS.filter((item) => item.key !== "superadmin").map((item) => item.key);
  await Promise.all(editableRoles.map((role) => ensureRolePermissionRecord(role)));
};

export const getRolePermissions = async (role) => {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === "superadmin") return [...PERMISSION_KEYS];
  if (!ROLE_KEY_SET.has(normalizedRole)) return [];

  const record = await ensureRolePermissionRecord(normalizedRole);
  if (!record?._id) return [];

  return sanitizePermissionsForRole(normalizedRole, record.permissions);
};

export const getRolePermissionSnapshot = async (role) => {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === "superadmin") {
    return {
      role: normalizedRole,
      permissions: [...PERMISSION_KEYS],
      storage: "locked",
      revision: 0,
      updatedAt: null,
    };
  }

  const record = await ensureRolePermissionRecord(normalizedRole);
  return {
    role: normalizedRole,
    permissions: record?._id ? sanitizePermissionsForRole(normalizedRole, record.permissions) : [],
    storage: "database",
    revision: Number(record?.revision || 0),
    updatedAt: record?.updatedAt || null,
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
