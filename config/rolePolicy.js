export const ROLES = Object.freeze({
  SUPERADMIN: "superadmin",
  HQ_ADMIN: "hqadmin",
  ACCOUNTANT: "accountant",
  HQ_USER: "hquser",
  HQ_STAFF: "hqstaff",
  SUPERVISOR: "supervisor",
  ADMIN: "admin",
  EMPLOYEE: "employee",
  TEACHER: "teacher",
  USTHADH: "usthadh",
  STUDENT: "student",
  PARENT: "parent",
  WARDEN: "warden",
  STAFF: "staff",
  GUEST: "guest",
});

// Roles accepted by the current User schema. Guest remains compatibility-only for
// older installations and is intentionally not offered for new User creation.
export const USER_ROLE_KEYS = Object.freeze([
  ROLES.SUPERADMIN,
  ROLES.HQ_ADMIN,
  ROLES.ACCOUNTANT,
  ROLES.HQ_USER,
  ROLES.HQ_STAFF,
  ROLES.SUPERVISOR,
  ROLES.ADMIN,
  ROLES.EMPLOYEE,
  ROLES.TEACHER,
  ROLES.USTHADH,
  ROLES.STUDENT,
  ROLES.PARENT,
  ROLES.WARDEN,
  ROLES.STAFF,
]);

// HQ roles introduced/refined in Phase 4. These roles have global data-read scope.
// Mutation capability is still permission-gated and, where needed, constrained by
// action-specific middleware/controllers.
export const GLOBAL_HQ_READ_ROLES = Object.freeze([
  ROLES.SUPERADMIN,
  ROLES.HQ_ADMIN,
  ROLES.ACCOUNTANT,
  ROLES.HQ_USER,
]);
export const GLOBAL_HQ_READ_ROLE_SET = new Set(GLOBAL_HQ_READ_ROLES);

// Only SuperAdmin and HQ Admin have general HQ operational mutation scope.
export const GLOBAL_HQ_MANAGE_ROLES = Object.freeze([
  ROLES.SUPERADMIN,
  ROLES.HQ_ADMIN,
]);
export const GLOBAL_HQ_MANAGE_ROLE_SET = new Set(GLOBAL_HQ_MANAGE_ROLES);

// Accounts is intentionally excluded from the read-only HQ User role.
export const HQ_ACCOUNTS_ROLES = Object.freeze([
  ROLES.SUPERADMIN,
  ROLES.HQ_ADMIN,
  ROLES.ACCOUNTANT,
]);
export const HQ_ACCOUNTS_ROLE_SET = new Set(HQ_ACCOUNTS_ROLES);

// These roles are Employee-backed HQ staff while the legacy HQ Niswan remains.
// Phase 5 will remove that fake-HQ-Niswan dependency; Phase 4 does not.
export const HQ_EMPLOYEE_ROLES = Object.freeze([
  ROLES.HQ_ADMIN,
  ROLES.ACCOUNTANT,
  ROLES.HQ_USER,
  ROLES.HQ_STAFF,
]);
export const HQ_EMPLOYEE_ROLE_SET = new Set(HQ_EMPLOYEE_ROLES);

export const normalizeRole = (role) => String(role || "").trim().toLowerCase();
export const isGlobalHqReadRole = (role) => GLOBAL_HQ_READ_ROLE_SET.has(normalizeRole(role));
export const isGlobalHqManageRole = (role) => GLOBAL_HQ_MANAGE_ROLE_SET.has(normalizeRole(role));
export const isHqAccountsRole = (role) => HQ_ACCOUNTS_ROLE_SET.has(normalizeRole(role));
export const isHqEmployeeRole = (role) => HQ_EMPLOYEE_ROLE_SET.has(normalizeRole(role));
