export const PERMISSIONS = Object.freeze({
  ROLE_PERMISSIONS_MANAGE: "system.role_permissions.manage",

  MARKSHEET_VIEW: "marksheet.view",
  MARKSHEET_ENTER: "marksheet.enter",
  MARKSHEET_FINALIZE: "marksheet.finalize",
  MARKSHEET_ANNUAL: "marksheet.annual",
  MARKSHEET_CONSOLIDATED_VIEW: "marksheet.consolidated.view",
  MARKSHEET_PDF: "marksheet.pdf",
});

const MARKSHEET_SCOPE_ROLES = Object.freeze(["superadmin", "hquser", "supervisor", "admin"]);

export const PERMISSION_CATALOG = Object.freeze([
  {
    key: PERMISSIONS.MARKSHEET_VIEW,
    category: "Exams / Results",
    label: "View Marksheets",
    description: "View saved marksheets and load permitted Niswans/exams.",
    requires: [],
    editable: true,
    allowedRoles: MARKSHEET_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.MARKSHEET_ENTER,
    category: "Exams / Results",
    label: "Enter Draft Marks",
    description: "Enter or edit Draft marksheets within the user's existing Niswan scope.",
    requires: [PERMISSIONS.MARKSHEET_VIEW],
    editable: true,
    allowedRoles: MARKSHEET_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.MARKSHEET_FINALIZE,
    category: "Exams / Results",
    label: "Finalize Marksheets",
    description: "Finalize Draft marksheets. Finalized marksheets are locked.",
    requires: [PERMISSIONS.MARKSHEET_VIEW, PERMISSIONS.MARKSHEET_ENTER],
    editable: true,
    allowedRoles: MARKSHEET_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.MARKSHEET_ANNUAL,
    category: "Exams / Results",
    label: "Annual Exam Access",
    description: "Allow Annual exam marksheet access in addition to Quarterly and Half Yearly.",
    requires: [PERMISSIONS.MARKSHEET_VIEW],
    editable: true,
    allowedRoles: MARKSHEET_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.MARKSHEET_CONSOLIDATED_VIEW,
    category: "Exams / Results",
    label: "View Consolidated Marksheet",
    description: "View and print consolidated marksheets.",
    requires: [PERMISSIONS.MARKSHEET_VIEW],
    editable: true,
    allowedRoles: MARKSHEET_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.MARKSHEET_PDF,
    category: "Exams / Results",
    label: "Official Marksheet PDF",
    description: "Generate, regenerate and download official marksheet PDFs.",
    requires: [PERMISSIONS.MARKSHEET_VIEW],
    editable: true,
    allowedRoles: MARKSHEET_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.ROLE_PERMISSIONS_MANAGE,
    category: "System Security",
    label: "Manage Role Permissions",
    description: "Manage permissions assigned to roles. Permanently locked to SuperAdmin.",
    requires: [],
    editable: false,
    superadminOnly: true,
    allowedRoles: ["superadmin"],
  },
]);

export const PERMISSION_KEYS = Object.freeze(PERMISSION_CATALOG.map((item) => item.key));
export const PERMISSION_KEY_SET = new Set(PERMISSION_KEYS);

// Keep roles source-controlled. Adding a new application role is a deliberate release;
// permissions for that role can then be administered without further code changes.
export const ROLE_DEFINITIONS = Object.freeze([
  { key: "superadmin", label: "SuperAdmin", editable: false },
  { key: "hquser", label: "HQ User", editable: true },
  { key: "supervisor", label: "Supervisor / Muavin", editable: true },
  { key: "admin", label: "Niswan Admin", editable: true },
  { key: "employee", label: "Employee (Legacy)", editable: true },
  { key: "teacher", label: "Teacher", editable: true },
  { key: "usthadh", label: "Usthadh", editable: true },
  { key: "warden", label: "Warden", editable: true },
  { key: "staff", label: "Staff", editable: true },
  { key: "student", label: "Student", editable: true },
  { key: "parent", label: "Parent", editable: true },
  // Compatibility only: some older installations may still contain Guest users.
  { key: "guest", label: "Guest (Legacy)", editable: true },
]);

export const ROLE_KEY_SET = new Set(ROLE_DEFINITIONS.map((item) => item.key));

const DEFAULT_ROLE_PERMISSIONS_RAW = Object.freeze({
  superadmin: PERMISSION_KEYS,

  // Preserve current production marksheet behavior. The only intentional access
  // expansion in this release is Supervisor draft marks entry for assigned Niswans.
  hquser: [],
  supervisor: [
    PERMISSIONS.MARKSHEET_VIEW,
    PERMISSIONS.MARKSHEET_ENTER,
  ],
  admin: [
    PERMISSIONS.MARKSHEET_VIEW,
    PERMISSIONS.MARKSHEET_ENTER,
    PERMISSIONS.MARKSHEET_FINALIZE,
    PERMISSIONS.MARKSHEET_PDF,
  ],
  employee: [],
  teacher: [],
  usthadh: [],
  warden: [],
  staff: [],
  student: [],
  parent: [],
  guest: [],
});

export const getDefaultRolePermissions = (role) => {
  const normalizedRole = String(role || "").trim().toLowerCase();
  const values = DEFAULT_ROLE_PERMISSIONS_RAW[normalizedRole] || [];
  return [...new Set(values.filter((key) => PERMISSION_KEY_SET.has(key)))];
};

export const getPermissionDefinition = (key) =>
  PERMISSION_CATALOG.find((item) => item.key === String(key || "")) || null;

export const isPermissionAllowedForRole = (key, role) => {
  const definition = getPermissionDefinition(key);
  if (!definition) return false;
  const normalizedRole = String(role || "").trim().toLowerCase();
  return !Array.isArray(definition.allowedRoles) || definition.allowedRoles.includes(normalizedRole);
};

export const validatePermissionDependencies = (permissions = []) => {
  const selected = new Set(Array.isArray(permissions) ? permissions : []);
  const errors = [];

  for (const item of PERMISSION_CATALOG) {
    if (!selected.has(item.key)) continue;
    for (const required of item.requires || []) {
      if (!selected.has(required)) {
        errors.push(`${item.label} requires ${getPermissionDefinition(required)?.label || required}.`);
      }
    }
  }

  return errors;
};
