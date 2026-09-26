import RolePermission from "../models/RolePermission.js";
import {
  PERMISSION_CATALOG_VERSION,
  PERMISSION_KEYS,
  PERMISSION_KEY_SET,
  ROLE_DEFINITIONS,
  ROLE_KEY_SET,
  getInitialRolePermissionsForBootstrap,
  getPermissionDefinition,
  getRolePermissionMigrationsAfter,
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
    .select("role permissions revision catalogVersion updatedAt updatedBy createdAt")
    .lean();

const migrateRolePermissionRecord = async (record) => {
  if (!record?._id) return record;

  const role = normalizeRole(record.role);
  let current = record;
  let currentVersion = Number(current.catalogVersion || 1);

  for (const migration of getRolePermissionMigrationsAfter(currentVersion)) {
    // Validate new keys against the role's CURRENT saved permissions as well as
    // the migration additions. This matters when a newly introduced permission
    // depends on a capability from an older catalog version. Only the new keys
    // are added; previously removed permissions are never restored by migration.
    const requestedAdditions = sanitizePermissions(migration.permissionsByRole?.[role] || []).filter(
      (key) => isPermissionAllowedForRole(key, role)
    );
    const validCombined = new Set(
      sanitizePermissionsForRole(role, [...(current.permissions || []), ...requestedAdditions])
    );
    const additions = requestedAdditions.filter((key) => validCombined.has(key));

    const update = {
      $set: {
        catalogVersion: migration.version,
        updatedAt: new Date(),
      },
      $inc: { revision: 1 },
    };

    if (additions.length > 0) {
      update.$addToSet = { permissions: { $each: additions } };
    }

    const migrated = await RolePermission.findOneAndUpdate(
      {
        _id: current._id,
        $or: [
          { catalogVersion: { $exists: false } },
          { catalogVersion: null },
          { catalogVersion: { $lt: migration.version } },
        ],
      },
      update,
      { new: true }
    )
      .select("role permissions revision catalogVersion updatedAt updatedBy createdAt")
      .lean();

    // Another serverless invocation may have applied this migration first.
    current = migrated || (await findRolePermissionRecord(role));
    if (!current?._id) return null;
    currentVersion = Number(current.catalogVersion || 1);
  }

  return current;
};

// Creates the database source-of-truth row only when a role has never been
// configured. $setOnInsert guarantees that a later deployment never overwrites
// permissions already saved by SuperAdmin. Existing rows receive only versioned
// migrations for permission keys that did not exist in earlier releases.
export const ensureRolePermissionRecord = async (role) => {
  const normalizedRole = normalizeRole(role);
  if (!ROLE_KEY_SET.has(normalizedRole) || normalizedRole === "superadmin") return null;

  const existing = await findRolePermissionRecord(normalizedRole);
  if (existing?._id) return migrateRolePermissionRecord(existing);

  const now = new Date();
  const initialPermissions = sanitizePermissionsForRole(
    normalizedRole,
    getInitialRolePermissionsForBootstrap(normalizedRole)
  );

  try {
    const created = await RolePermission.findOneAndUpdate(
      { role: normalizedRole },
      {
        $setOnInsert: {
          role: normalizedRole,
          permissions: initialPermissions,
          revision: 1,
          catalogVersion: PERMISSION_CATALOG_VERSION,
          updatedBy: null,
          createdAt: now,
          updatedAt: now,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    )
      .select("role permissions revision catalogVersion updatedAt updatedBy createdAt")
      .lean();

    return migrateRolePermissionRecord(created);
  } catch (error) {
    // Two serverless invocations can race to create the same unique role row.
    // If another invocation won, use/migrate the row it created; never overwrite it.
    if (error?.code === 11000) {
      const winner = await findRolePermissionRecord(normalizedRole);
      return migrateRolePermissionRecord(winner);
    }
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
      catalogVersion: PERMISSION_CATALOG_VERSION,
      updatedAt: null,
    };
  }

  const record = await ensureRolePermissionRecord(normalizedRole);
  return {
    role: normalizedRole,
    permissions: record?._id ? sanitizePermissionsForRole(normalizedRole, record.permissions) : [],
    storage: "database",
    revision: Number(record?.revision || 0),
    catalogVersion: Number(record?.catalogVersion || PERMISSION_CATALOG_VERSION),
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
