export const PERMISSION_CATALOG_VERSION = 3;

export const PERMISSIONS = Object.freeze({
  ROLE_PERMISSIONS_MANAGE: "system.role_permissions.manage",

  NISWAN_VIEW: "niswan.view",
  NISWAN_CREATE: "niswan.create",
  NISWAN_EDIT: "niswan.edit",
  NISWAN_DELETE: "niswan.delete",

  SUPERVISOR_LIST: "supervisor.list",
  SUPERVISOR_VIEW: "supervisor.view",
  SUPERVISOR_CREATE: "supervisor.create",
  SUPERVISOR_EDIT: "supervisor.edit",
  SUPERVISOR_DELETE: "supervisor.delete",

  EMPLOYEE_VIEW: "employee.view",
  EMPLOYEE_CREATE: "employee.create",
  EMPLOYEE_EDIT: "employee.edit",
  EMPLOYEE_DELETE: "employee.delete",

  STUDENT_VIEW: "student.view",
  STUDENT_CREATE: "student.create",
  STUDENT_EDIT: "student.edit",
  STUDENT_DELETE: "student.delete",
  STUDENT_PROMOTE: "student.promote",

  STUDENT_ATTENDANCE_VIEW: "attendance.student.view",
  STUDENT_ATTENDANCE_ENTER: "attendance.student.enter",
  STUDENT_ATTENDANCE_FINALIZE: "attendance.student.finalize",

  STAFF_ATTENDANCE_SELF_VIEW: "attendance.staff.self.view",
  STAFF_ATTENDANCE_VIEW: "attendance.staff.view",
  STAFF_ATTENDANCE_ENTER: "attendance.staff.enter",
  STAFF_ATTENDANCE_FINALIZE: "attendance.staff.finalize",

  STUDENT_LEAVE_VIEW: "leave.student.view",
  STUDENT_LEAVE_MANAGE: "leave.student.manage",
  STAFF_LEAVE_SELF_VIEW: "leave.staff.self.view",
  STAFF_LEAVE_SELF_APPLY: "leave.staff.self.apply",
  STAFF_LEAVE_APPROVE: "leave.staff.approve",

  STUDENT_ATTENDANCE_REPORT_VIEW: "attendance.student.report.view",
  STAFF_ATTENDANCE_REPORT_VIEW: "attendance.staff.report.view",

  MARKSHEET_VIEW: "marksheet.view",
  MARKSHEET_ENTER: "marksheet.enter",
  MARKSHEET_FINALIZE: "marksheet.finalize",
  MARKSHEET_ANNUAL: "marksheet.annual",
  MARKSHEET_CONSOLIDATED_VIEW: "marksheet.consolidated.view",
  MARKSHEET_PDF: "marksheet.pdf",
});

// `allowedRoles` is a server-scope safety boundary, not a role-permission default.
// SuperAdmin can assign a permission from the UI only to roles whose existing
// controller/scope implementation can enforce that action safely. The actual
// role -> permission assignment is stored only in MongoDB.
const NISWAN_READ_SCOPE_ROLES = Object.freeze([
  "superadmin",
  "hquser",
  "supervisor",
  "admin",
  "guest",
]);
const NISWAN_MANAGE_SCOPE_ROLES = Object.freeze(["superadmin", "hquser"]);

const SUPERVISOR_LIST_SCOPE_ROLES = Object.freeze([
  "superadmin",
  "hquser",
  "supervisor",
  "guest",
]);
const SUPERVISOR_DETAIL_SCOPE_ROLES = Object.freeze(["superadmin", "hquser", "guest"]);
const SUPERVISOR_MANAGE_SCOPE_ROLES = Object.freeze(["superadmin", "hquser"]);

const EMPLOYEE_READ_SCOPE_ROLES = Object.freeze([
  "superadmin",
  "hquser",
  "supervisor",
  "admin",
  "guest",
]);
const EMPLOYEE_CREATE_UPDATE_SCOPE_ROLES = Object.freeze([
  "superadmin",
  "hquser",
  "supervisor",
  "admin",
]);
const EMPLOYEE_DELETE_SCOPE_ROLES = Object.freeze(["superadmin", "supervisor", "admin"]);

const STUDENT_READ_SCOPE_ROLES = Object.freeze([
  "superadmin",
  "hquser",
  "supervisor",
  "admin",
  "guest",
]);
const STUDENT_MANAGE_SCOPE_ROLES = Object.freeze(["superadmin", "hquser", "admin"]);

// Phase 2.2 keeps the existing Attendance/Leave data-scope rules intact.
// These arrays only define which existing role scopes are technically capable
// of enforcing each permission; they are not role-permission assignments.
const STUDENT_ATTENDANCE_SCOPE_ROLES = Object.freeze([
  "superadmin",
  "admin",
  "teacher",
  "usthadh",
]);
const STAFF_ATTENDANCE_MANAGE_SCOPE_ROLES = Object.freeze(["superadmin", "hquser", "admin"]);
const STAFF_SELF_SCOPE_ROLES = Object.freeze([
  "hquser",
  "supervisor",
  "admin",
  "employee",
  "teacher",
  "usthadh",
  "warden",
  "staff",
]);
const STAFF_LEAVE_APPROVE_SCOPE_ROLES = Object.freeze(["superadmin", "hquser", "admin"]);

const MARKSHEET_SCOPE_ROLES = Object.freeze([
  "superadmin",
  "hquser",
  "supervisor",
  "admin",
  "employee",
  "teacher",
  "usthadh",
  "warden",
  "staff",
]);

export const PERMISSION_CATALOG = Object.freeze([
  {
    key: PERMISSIONS.NISWAN_VIEW,
    category: "Niswans",
    label: "View Niswans",
    description: "Open the Niswan list/details within the user's existing server-controlled scope.",
    requires: [],
    editable: true,
    allowedRoles: NISWAN_READ_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.NISWAN_CREATE,
    category: "Niswans",
    label: "Create Niswans",
    description: "Create a new Niswan. Available only to roles with the existing global Niswan-management scope.",
    requires: [PERMISSIONS.NISWAN_VIEW],
    editable: true,
    allowedRoles: NISWAN_MANAGE_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.NISWAN_EDIT,
    category: "Niswans",
    label: "Edit Niswans",
    description: "Edit Niswan details within the existing global Niswan-management scope.",
    requires: [PERMISSIONS.NISWAN_VIEW],
    editable: true,
    allowedRoles: NISWAN_MANAGE_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.NISWAN_DELETE,
    category: "Niswans",
    label: "Delete Niswans",
    description: "Delete Niswans using the existing server business rules.",
    requires: [PERMISSIONS.NISWAN_VIEW],
    editable: true,
    allowedRoles: NISWAN_MANAGE_SCOPE_ROLES,
  },

  {
    key: PERMISSIONS.SUPERVISOR_LIST,
    category: "Supervisors / Muavins",
    label: "View Muavin Directory",
    description: "Open the Muavin directory using the current server visibility rules.",
    requires: [],
    editable: true,
    allowedRoles: SUPERVISOR_LIST_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.SUPERVISOR_VIEW,
    category: "Supervisors / Muavins",
    label: "View Muavin Details",
    description: "Open an individual Muavin detail record.",
    requires: [PERMISSIONS.SUPERVISOR_LIST],
    editable: true,
    allowedRoles: SUPERVISOR_DETAIL_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.SUPERVISOR_CREATE,
    category: "Supervisors / Muavins",
    label: "Create Muavins",
    description: "Create a new Muavin using the existing HQ management rules.",
    requires: [PERMISSIONS.SUPERVISOR_LIST],
    editable: true,
    allowedRoles: SUPERVISOR_MANAGE_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.SUPERVISOR_EDIT,
    category: "Supervisors / Muavins",
    label: "Edit Muavins",
    description: "Edit a Muavin record using the existing HQ management rules.",
    requires: [PERMISSIONS.SUPERVISOR_LIST, PERMISSIONS.SUPERVISOR_VIEW],
    editable: true,
    allowedRoles: SUPERVISOR_MANAGE_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.SUPERVISOR_DELETE,
    category: "Supervisors / Muavins",
    label: "Delete Muavins",
    description: "Delete a Muavin record using the existing HQ management rules.",
    requires: [PERMISSIONS.SUPERVISOR_LIST, PERMISSIONS.SUPERVISOR_VIEW],
    editable: true,
    allowedRoles: SUPERVISOR_MANAGE_SCOPE_ROLES,
  },

  {
    key: PERMISSIONS.EMPLOYEE_VIEW,
    category: "Employees",
    label: "View Employees",
    description: "View Employee records within the user's existing HQ, assigned-Niswan, own-Niswan or legacy read scope.",
    requires: [],
    editable: true,
    allowedRoles: EMPLOYEE_READ_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.EMPLOYEE_CREATE,
    category: "Employees",
    label: "Create Employees",
    description: "Create Employees. Existing target-role and Niswan-scope restrictions still apply.",
    requires: [PERMISSIONS.EMPLOYEE_VIEW],
    editable: true,
    allowedRoles: EMPLOYEE_CREATE_UPDATE_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.EMPLOYEE_EDIT,
    category: "Employees",
    label: "Edit Employees",
    description: "Edit Employee records. Existing target-role, self-edit and Niswan-scope restrictions still apply.",
    requires: [PERMISSIONS.EMPLOYEE_VIEW],
    editable: true,
    allowedRoles: EMPLOYEE_CREATE_UPDATE_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.EMPLOYEE_DELETE,
    category: "Employees",
    label: "Delete Employees",
    description: "Delete Employee records. Existing self-delete, target-role and Niswan-scope restrictions still apply.",
    requires: [PERMISSIONS.EMPLOYEE_VIEW],
    editable: true,
    allowedRoles: EMPLOYEE_DELETE_SCOPE_ROLES,
  },

  {
    key: PERMISSIONS.STUDENT_VIEW,
    category: "Students",
    label: "View Students",
    description: "View Student records within the user's existing server-controlled scope.",
    requires: [],
    editable: true,
    allowedRoles: STUDENT_READ_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.STUDENT_CREATE,
    category: "Students",
    label: "Create Students",
    description: "Create Students where the existing Student workflow and Niswan rules allow it.",
    requires: [PERMISSIONS.STUDENT_VIEW],
    editable: true,
    allowedRoles: STUDENT_MANAGE_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.STUDENT_EDIT,
    category: "Students",
    label: "Edit Students",
    description: "Edit Student records within the existing Niswan and field-lock rules.",
    requires: [PERMISSIONS.STUDENT_VIEW],
    editable: true,
    allowedRoles: STUDENT_MANAGE_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.STUDENT_DELETE,
    category: "Students",
    label: "Delete Students",
    description: "Delete Student records within the existing Niswan scope.",
    requires: [PERMISSIONS.STUDENT_VIEW],
    editable: true,
    allowedRoles: STUDENT_MANAGE_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.STUDENT_PROMOTE,
    category: "Students",
    label: "Promote / Complete Students",
    description: "Use the existing single/bulk Student promotion workflow within the user's permitted Niswan scope.",
    requires: [PERMISSIONS.STUDENT_VIEW],
    editable: true,
    allowedRoles: STUDENT_MANAGE_SCOPE_ROLES,
  },

  {
    key: PERMISSIONS.STUDENT_ATTENDANCE_VIEW,
    category: "Student Attendance",
    label: "View Student Attendance",
    description: "View daily and monthly Student attendance within the existing Niswan Attendance scope.",
    requires: [],
    editable: true,
    allowedRoles: STUDENT_ATTENDANCE_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.STUDENT_ATTENDANCE_ENTER,
    category: "Student Attendance",
    label: "Enter Student Attendance",
    description: "Create or edit non-finalized Student attendance within the existing Niswan Attendance scope.",
    requires: [PERMISSIONS.STUDENT_ATTENDANCE_VIEW],
    editable: true,
    allowedRoles: STUDENT_ATTENDANCE_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.STUDENT_ATTENDANCE_FINALIZE,
    category: "Student Attendance",
    label: "Finalize Student Attendance",
    description: "Finalize a Student attendance sheet. Finalized attendance remains locked by the existing business rules.",
    requires: [PERMISSIONS.STUDENT_ATTENDANCE_VIEW, PERMISSIONS.STUDENT_ATTENDANCE_ENTER],
    editable: true,
    allowedRoles: STUDENT_ATTENDANCE_SCOPE_ROLES,
  },

  {
    key: PERMISSIONS.STAFF_ATTENDANCE_SELF_VIEW,
    category: "Staff Attendance",
    label: "View Own Staff Attendance",
    description: "View only the logged-in staff member's own monthly attendance when the login is linked to a staff record.",
    requires: [],
    editable: true,
    allowedRoles: STAFF_SELF_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.STAFF_ATTENDANCE_VIEW,
    category: "Staff Attendance",
    label: "View Staff Attendance",
    description: "View staff attendance rosters within the existing HQ or Niswan attendance-management scope.",
    requires: [],
    editable: true,
    allowedRoles: STAFF_ATTENDANCE_MANAGE_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.STAFF_ATTENDANCE_ENTER,
    category: "Staff Attendance",
    label: "Enter Staff Attendance",
    description: "Create or edit non-finalized Staff attendance within the existing HQ or Niswan scope.",
    requires: [PERMISSIONS.STAFF_ATTENDANCE_VIEW],
    editable: true,
    allowedRoles: STAFF_ATTENDANCE_MANAGE_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.STAFF_ATTENDANCE_FINALIZE,
    category: "Staff Attendance",
    label: "Finalize Staff Attendance",
    description: "Finalize a Staff attendance sheet. Finalized attendance remains locked by the existing business rules.",
    requires: [PERMISSIONS.STAFF_ATTENDANCE_VIEW, PERMISSIONS.STAFF_ATTENDANCE_ENTER],
    editable: true,
    allowedRoles: STAFF_ATTENDANCE_MANAGE_SCOPE_ROLES,
  },

  {
    key: PERMISSIONS.STUDENT_LEAVE_VIEW,
    category: "Student Leave",
    label: "View Student Leave",
    description: "View Student leave records within the existing Student Attendance Niswan scope.",
    requires: [],
    editable: true,
    allowedRoles: STUDENT_ATTENDANCE_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.STUDENT_LEAVE_MANAGE,
    category: "Student Leave",
    label: "Manage Student Leave",
    description: "Record and update Student leave using the existing approval/finalized-attendance rules.",
    requires: [PERMISSIONS.STUDENT_LEAVE_VIEW, PERMISSIONS.STUDENT_ATTENDANCE_VIEW],
    editable: true,
    allowedRoles: STUDENT_ATTENDANCE_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.STAFF_LEAVE_SELF_VIEW,
    category: "Staff Leave",
    label: "View Own Leave",
    description: "View only the logged-in staff member's own leave history when linked to a staff record.",
    requires: [],
    editable: true,
    allowedRoles: STAFF_SELF_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.STAFF_LEAVE_SELF_APPLY,
    category: "Staff Leave",
    label: "Apply / Cancel Own Leave",
    description: "Apply for own staff leave and cancel the user's own Pending or Approved leave using the existing leave rules.",
    requires: [PERMISSIONS.STAFF_LEAVE_SELF_VIEW],
    editable: true,
    allowedRoles: STAFF_SELF_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.STAFF_LEAVE_APPROVE,
    category: "Staff Leave",
    label: "Approve / Reject Staff Leave",
    description: "Review Staff leave within the existing HQ/Niswan approval scope. Self-approval and Admin escalation rules remain enforced.",
    requires: [],
    editable: true,
    allowedRoles: STAFF_LEAVE_APPROVE_SCOPE_ROLES,
  },

  {
    key: PERMISSIONS.STUDENT_ATTENDANCE_REPORT_VIEW,
    category: "Attendance Reports",
    label: "View Student Attendance Reports",
    description: "View monthly Student attendance reports within the existing Niswan Attendance scope.",
    requires: [],
    editable: true,
    allowedRoles: STUDENT_ATTENDANCE_SCOPE_ROLES,
  },
  {
    key: PERMISSIONS.STAFF_ATTENDANCE_REPORT_VIEW,
    category: "Attendance Reports",
    label: "View Staff Attendance Reports",
    description: "View monthly Staff attendance reports within the existing HQ or Niswan Attendance scope.",
    requires: [],
    editable: true,
    allowedRoles: STAFF_ATTENDANCE_MANAGE_SCOPE_ROLES,
  },

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

// Application roles remain source-controlled because adding a new role affects
// authentication, data scope and many business modules. Once a role exists,
// assignable business permissions are managed from the SuperAdmin screen.
export const ROLE_DEFINITIONS = Object.freeze([
  { key: "superadmin", label: "SuperAdmin", editable: false, scopeLabel: "All UNIS data and system scope" },
  { key: "hquser", label: "HQ User", editable: true, scopeLabel: "Current global HQ scope" },
  { key: "supervisor", label: "Supervisor / Muavin", editable: true, scopeLabel: "Assigned Niswans only" },
  { key: "admin", label: "Niswan Admin", editable: true, scopeLabel: "Own Niswan only" },
  { key: "employee", label: "Employee (Legacy)", editable: true, scopeLabel: "Own Niswan only" },
  { key: "teacher", label: "Teacher", editable: true, scopeLabel: "Own Niswan only" },
  { key: "usthadh", label: "Usthadh", editable: true, scopeLabel: "Own Niswan only" },
  { key: "warden", label: "Warden", editable: true, scopeLabel: "Own Niswan only" },
  { key: "staff", label: "Staff", editable: true, scopeLabel: "Own Niswan only" },
  { key: "student", label: "Student", editable: true, scopeLabel: "Self / linked student scope" },
  { key: "parent", label: "Parent", editable: true, scopeLabel: "Self / linked student scope" },
  // Compatibility only: some older installations may still contain Guest users.
  { key: "guest", label: "Guest (Legacy)", editable: true, scopeLabel: "Legacy read-only scope" },
]);

export const ROLE_KEY_SET = new Set(ROLE_DEFINITIONS.map((item) => item.key));

const PHASE_2_1_PERMISSIONS_BY_ROLE = Object.freeze({
  hquser: [
    PERMISSIONS.NISWAN_VIEW,
    PERMISSIONS.NISWAN_CREATE,
    PERMISSIONS.NISWAN_EDIT,
    PERMISSIONS.NISWAN_DELETE,
    PERMISSIONS.SUPERVISOR_LIST,
    PERMISSIONS.SUPERVISOR_VIEW,
    PERMISSIONS.SUPERVISOR_CREATE,
    PERMISSIONS.SUPERVISOR_EDIT,
    PERMISSIONS.SUPERVISOR_DELETE,
    PERMISSIONS.EMPLOYEE_VIEW,
    PERMISSIONS.EMPLOYEE_CREATE,
    PERMISSIONS.EMPLOYEE_EDIT,
    PERMISSIONS.STUDENT_VIEW,
    PERMISSIONS.STUDENT_CREATE,
    PERMISSIONS.STUDENT_EDIT,
    PERMISSIONS.STUDENT_DELETE,
    PERMISSIONS.STUDENT_PROMOTE,
  ],
  supervisor: [
    PERMISSIONS.NISWAN_VIEW,
    PERMISSIONS.SUPERVISOR_LIST,
    PERMISSIONS.EMPLOYEE_VIEW,
    PERMISSIONS.EMPLOYEE_CREATE,
    PERMISSIONS.EMPLOYEE_EDIT,
    PERMISSIONS.EMPLOYEE_DELETE,
    PERMISSIONS.STUDENT_VIEW,
  ],
  admin: [
    PERMISSIONS.NISWAN_VIEW,
    PERMISSIONS.EMPLOYEE_VIEW,
    PERMISSIONS.EMPLOYEE_CREATE,
    PERMISSIONS.EMPLOYEE_EDIT,
    PERMISSIONS.EMPLOYEE_DELETE,
    PERMISSIONS.STUDENT_VIEW,
    PERMISSIONS.STUDENT_CREATE,
    PERMISSIONS.STUDENT_EDIT,
    PERMISSIONS.STUDENT_DELETE,
    PERMISSIONS.STUDENT_PROMOTE,
  ],
  employee: [],
  teacher: [],
  usthadh: [],
  warden: [],
  staff: [],
  student: [],
  parent: [],
  guest: [
    PERMISSIONS.NISWAN_VIEW,
    PERMISSIONS.SUPERVISOR_LIST,
    PERMISSIONS.SUPERVISOR_VIEW,
    PERMISSIONS.EMPLOYEE_VIEW,
    PERMISSIONS.STUDENT_VIEW,
  ],
});

const PHASE_2_2_PERMISSIONS_BY_ROLE = Object.freeze({
  hquser: [
    PERMISSIONS.STAFF_ATTENDANCE_SELF_VIEW,
    PERMISSIONS.STAFF_ATTENDANCE_VIEW,
    PERMISSIONS.STAFF_ATTENDANCE_ENTER,
    PERMISSIONS.STAFF_ATTENDANCE_FINALIZE,
    PERMISSIONS.STAFF_LEAVE_SELF_VIEW,
    PERMISSIONS.STAFF_LEAVE_SELF_APPLY,
    PERMISSIONS.STAFF_LEAVE_APPROVE,
    PERMISSIONS.STAFF_ATTENDANCE_REPORT_VIEW,
  ],
  supervisor: [
    PERMISSIONS.STAFF_ATTENDANCE_SELF_VIEW,
    PERMISSIONS.STAFF_LEAVE_SELF_VIEW,
    PERMISSIONS.STAFF_LEAVE_SELF_APPLY,
  ],
  admin: [
    PERMISSIONS.STUDENT_ATTENDANCE_VIEW,
    PERMISSIONS.STUDENT_ATTENDANCE_ENTER,
    PERMISSIONS.STUDENT_ATTENDANCE_FINALIZE,
    PERMISSIONS.STAFF_ATTENDANCE_SELF_VIEW,
    PERMISSIONS.STAFF_ATTENDANCE_VIEW,
    PERMISSIONS.STAFF_ATTENDANCE_ENTER,
    PERMISSIONS.STAFF_ATTENDANCE_FINALIZE,
    PERMISSIONS.STUDENT_LEAVE_VIEW,
    PERMISSIONS.STUDENT_LEAVE_MANAGE,
    PERMISSIONS.STAFF_LEAVE_SELF_VIEW,
    PERMISSIONS.STAFF_LEAVE_SELF_APPLY,
    PERMISSIONS.STAFF_LEAVE_APPROVE,
    PERMISSIONS.STUDENT_ATTENDANCE_REPORT_VIEW,
    PERMISSIONS.STAFF_ATTENDANCE_REPORT_VIEW,
  ],
  employee: [
    PERMISSIONS.STAFF_ATTENDANCE_SELF_VIEW,
    PERMISSIONS.STAFF_LEAVE_SELF_VIEW,
    PERMISSIONS.STAFF_LEAVE_SELF_APPLY,
  ],
  teacher: [
    PERMISSIONS.STUDENT_ATTENDANCE_VIEW,
    PERMISSIONS.STUDENT_ATTENDANCE_ENTER,
    PERMISSIONS.STUDENT_ATTENDANCE_FINALIZE,
    PERMISSIONS.STAFF_ATTENDANCE_SELF_VIEW,
    PERMISSIONS.STUDENT_LEAVE_VIEW,
    PERMISSIONS.STUDENT_LEAVE_MANAGE,
    PERMISSIONS.STAFF_LEAVE_SELF_VIEW,
    PERMISSIONS.STAFF_LEAVE_SELF_APPLY,
    PERMISSIONS.STUDENT_ATTENDANCE_REPORT_VIEW,
  ],
  usthadh: [
    PERMISSIONS.STUDENT_ATTENDANCE_VIEW,
    PERMISSIONS.STUDENT_ATTENDANCE_ENTER,
    PERMISSIONS.STUDENT_ATTENDANCE_FINALIZE,
    PERMISSIONS.STAFF_ATTENDANCE_SELF_VIEW,
    PERMISSIONS.STUDENT_LEAVE_VIEW,
    PERMISSIONS.STUDENT_LEAVE_MANAGE,
    PERMISSIONS.STAFF_LEAVE_SELF_VIEW,
    PERMISSIONS.STAFF_LEAVE_SELF_APPLY,
    PERMISSIONS.STUDENT_ATTENDANCE_REPORT_VIEW,
  ],
  warden: [
    PERMISSIONS.STAFF_ATTENDANCE_SELF_VIEW,
    PERMISSIONS.STAFF_LEAVE_SELF_VIEW,
    PERMISSIONS.STAFF_LEAVE_SELF_APPLY,
  ],
  staff: [
    PERMISSIONS.STAFF_ATTENDANCE_SELF_VIEW,
    PERMISSIONS.STAFF_LEAVE_SELF_VIEW,
    PERMISSIONS.STAFF_LEAVE_SELF_APPLY,
  ],
  student: [],
  parent: [],
  guest: [],
});

// Fresh installations/roles get the complete current baseline once. After the
// MongoDB row exists, source deployments never re-apply this seed.
const INITIAL_ROLE_PERMISSION_SEED = Object.freeze({
  hquser: [...PHASE_2_1_PERMISSIONS_BY_ROLE.hquser, ...PHASE_2_2_PERMISSIONS_BY_ROLE.hquser],
  supervisor: [
    ...PHASE_2_1_PERMISSIONS_BY_ROLE.supervisor,
    ...PHASE_2_2_PERMISSIONS_BY_ROLE.supervisor,
    PERMISSIONS.MARKSHEET_VIEW,
    PERMISSIONS.MARKSHEET_ENTER,
    PERMISSIONS.MARKSHEET_ANNUAL,
  ],
  admin: [
    ...PHASE_2_1_PERMISSIONS_BY_ROLE.admin,
    ...PHASE_2_2_PERMISSIONS_BY_ROLE.admin,
    PERMISSIONS.MARKSHEET_VIEW,
    PERMISSIONS.MARKSHEET_ENTER,
    PERMISSIONS.MARKSHEET_FINALIZE,
    PERMISSIONS.MARKSHEET_PDF,
  ],
  employee: [...PHASE_2_1_PERMISSIONS_BY_ROLE.employee, ...PHASE_2_2_PERMISSIONS_BY_ROLE.employee],
  teacher: [...PHASE_2_1_PERMISSIONS_BY_ROLE.teacher, ...PHASE_2_2_PERMISSIONS_BY_ROLE.teacher],
  usthadh: [...PHASE_2_1_PERMISSIONS_BY_ROLE.usthadh, ...PHASE_2_2_PERMISSIONS_BY_ROLE.usthadh],
  warden: [...PHASE_2_1_PERMISSIONS_BY_ROLE.warden, ...PHASE_2_2_PERMISSIONS_BY_ROLE.warden],
  staff: [...PHASE_2_1_PERMISSIONS_BY_ROLE.staff, ...PHASE_2_2_PERMISSIONS_BY_ROLE.staff],
  student: [...PHASE_2_1_PERMISSIONS_BY_ROLE.student, ...PHASE_2_2_PERMISSIONS_BY_ROLE.student],
  parent: [...PHASE_2_1_PERMISSIONS_BY_ROLE.parent, ...PHASE_2_2_PERMISSIONS_BY_ROLE.parent],
  guest: [...PHASE_2_1_PERMISSIONS_BY_ROLE.guest, ...PHASE_2_2_PERMISSIONS_BY_ROLE.guest],
});

// Versioned permission-catalog migrations are used only when a release introduces
// NEW permission keys. They preserve the behavior that already existed before the
// permission key was introduced. A migration never resets or changes previously
// configurable permissions. After it runs, MongoDB remains the only assignment
// source and subsequent UI changes are never overwritten by deployments.
export const ROLE_PERMISSION_MIGRATIONS = Object.freeze([
  {
    version: 2,
    label: "Phase 2.1 core operational permissions",
    permissionsByRole: PHASE_2_1_PERMISSIONS_BY_ROLE,
  },
  {
    version: 3,
    label: "Phase 2.2 Attendance and Leave permissions",
    permissionsByRole: PHASE_2_2_PERMISSIONS_BY_ROLE,
  },
]);

export const getInitialRolePermissionsForBootstrap = (role) => {
  const normalizedRole = String(role || "").trim().toLowerCase();
  const values = INITIAL_ROLE_PERMISSION_SEED[normalizedRole] || [];
  return [...new Set(values.filter((key) => PERMISSION_KEY_SET.has(key)))];
};

export const getRolePermissionMigrationsAfter = (catalogVersion = 1) => {
  const current = Number(catalogVersion || 1);
  return ROLE_PERMISSION_MIGRATIONS.filter((migration) => migration.version > current).sort(
    (a, b) => a.version - b.version
  );
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
