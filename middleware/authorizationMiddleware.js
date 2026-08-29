import Employee from "../models/Employee.js";
import Supervisor from "../models/Supervisor.js";
import School from "../models/School.js";
import Student from "../models/Student.js";
import Certificate from "../models/Certificate.js";
import Template from "../models/Template.js";
import Academic from "../models/Academic.js";
import FeeInvoice from "../models/FeeInvoice.js";

const normalizeRole = (role) => String(role || "").trim().toLowerCase();
const HQ_ROLES = new Set(["superadmin", "hquser"]);
const STUDENT_READ_ROLES = new Set(["superadmin", "hquser", "admin", "guest"]);
const STUDENT_MANAGE_ROLES = new Set(["superadmin", "hquser", "admin"]);

const deny = (res, message = "You are not authorized to access this resource.") =>
  res.status(403).json({ success: false, error: message });

const isActiveValue = (value) => String(value || "").trim().toLowerCase() === "active";

export const getAccessContext = async (user) => {
  const role = normalizeRole(user?.role);
  const userId = user?._id;

  if (!userId) return { role, userId: null, isHQ: false, isActive: false, schoolIds: [] };
  if (HQ_ROLES.has(role)) {
    return { role, userId, isHQ: true, isActive: true, canReadAllStudents: true, schoolIds: [] };
  }

  // Guest is an existing production read-only role. The web application lets Guest
  // select any active Niswan and browse Student data. Preserve that behavior without
  // granting any Student mutation permission.
  if (role === "guest") {
    return {
      role,
      userId,
      isHQ: false,
      isActive: true,
      canReadAllStudents: true,
      schoolIds: [],
    };
  }

  if (["admin", "teacher", "employee", "usthadh", "warden", "staff"].includes(role)) {
    const employee = await Employee.findOne({ userId }).select("_id schoolId active").lean();
    const isActive = Boolean(employee?._id) && isActiveValue(employee?.active);
    return {
      role,
      userId,
      isHQ: false,
      isActive,
      employeeId: employee?._id || null,
      schoolIds: isActive && employee?.schoolId ? [String(employee.schoolId)] : [],
    };
  }

  if (role === "supervisor") {
    const supervisor = await Supervisor.findOne({ userId }).select("_id active").lean();
    const isActive = Boolean(supervisor?._id) && isActiveValue(supervisor?.active);
    if (!isActive) {
      return { role, userId, isHQ: false, isActive: false, schoolIds: [], supervisorId: supervisor?._id || null };
    }
    const schools = await School.find({ supervisorId: { $in: [supervisor._id, userId] } }).select("_id").lean();
    return {
      role,
      userId,
      isHQ: false,
      isActive: true,
      supervisorId: supervisor._id,
      schoolIds: schools.map((school) => String(school._id)),
    };
  }

  if (["student", "parent"].includes(role)) {
    const student = await Student.findOne({ userId }).select("_id schoolId active").lean();
    const isActive = Boolean(student?._id) && isActiveValue(student?.active);
    return {
      role,
      userId,
      isHQ: false,
      isActive,
      studentId: student?._id || null,
      schoolIds: isActive && student?.schoolId ? [String(student.schoolId)] : [],
    };
  }

  return { role, userId, isHQ: false, isActive: false, schoolIds: [] };
};

const getRequestAccess = async (req) => {
  if (!req.accessContext) req.accessContext = await getAccessContext(req.user);
  return req.accessContext;
};

export const requireStudentReadRole = async (req, res, next) => {
  try {
    const role = normalizeRole(req.user?.role);
    if (!STUDENT_READ_ROLES.has(role)) {
      return deny(res, "Student data is not available for this role.");
    }

    const access = await getRequestAccess(req);
    if (role === "admin" && !access.isActive) {
      return deny(res, "Your Niswan Admin account is inactive or is not linked to an active employee record.");
    }
    return next();
  } catch (error) {
    console.log("[authorization] requireStudentReadRole:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};

export const requireStudentManageRole = async (req, res, next) => {
  try {
    const role = normalizeRole(req.user?.role);
    if (!STUDENT_MANAGE_ROLES.has(role)) {
      return deny(res, "Student management is available only to HQ and Niswan Admin users.");
    }

    const access = await getRequestAccess(req);
    if (role === "admin" && !access.isActive) {
      return deny(res, "Your Niswan Admin account is inactive or is not linked to an active employee record.");
    }
    return next();
  } catch (error) {
    console.log("[authorization] requireStudentManageRole:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};

export const requireHQ = (req, res, next) => {
  if (!HQ_ROLES.has(normalizeRole(req.user?.role))) {
    return deny(res, "This global operation is available only to HQ users.");
  }
  return next();
};

// Global read is intentionally available to HQ and the existing read-only Guest role.
export const requireGlobalStudentRead = async (req, res, next) => {
  try {
    const access = await getRequestAccess(req);
    if (!access.canReadAllStudents) {
      return deny(res, "Use the Niswan-scoped Student endpoint for this account.");
    }
    return next();
  } catch (error) {
    console.log("[authorization] requireGlobalStudentRead:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};

export const requireSchoolParamReadAccess = (paramName = "schoolId") => async (req, res, next) => {
  try {
    const access = await getRequestAccess(req);
    if (access.isHQ || access.canReadAllStudents) return next();

    const requestedSchoolId = String(req.params?.[paramName] || "");
    if (!requestedSchoolId || !access.schoolIds.includes(requestedSchoolId)) {
      return deny(res, "The requested Niswan is outside your authorized scope.");
    }
    return next();
  } catch (error) {
    console.log("[authorization] requireSchoolParamReadAccess:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};

export const requireSchoolParamAccess = (paramName = "schoolId") => async (req, res, next) => {
  try {
    const access = await getRequestAccess(req);
    if (access.isHQ) return next();

    const requestedSchoolId = String(req.params?.[paramName] || "");
    if (!requestedSchoolId || !access.schoolIds.includes(requestedSchoolId)) {
      return deny(res, "The requested Niswan is outside your authorized scope.");
    }
    return next();
  } catch (error) {
    console.log("[authorization] requireSchoolParamAccess:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};

// Must run after multer for multipart/form-data so req.body is available.
export const requireBodySchoolAccess = (fieldName = "schoolId") => async (req, res, next) => {
  try {
    const access = await getRequestAccess(req);
    if (access.isHQ) return next();

    const requestedSchoolId = String(req.body?.[fieldName] || "");
    if (!requestedSchoolId || !access.schoolIds.includes(requestedSchoolId)) {
      return deny(res, "You can add or update students only in your own Niswan.");
    }
    return next();
  } catch (error) {
    console.log("[authorization] requireBodySchoolAccess:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};

const loadStudentForAccess = async (req, res, paramName) => {
  const studentId = String(req.params?.[paramName] || "");
  const student = await Student.findById(studentId).select("_id schoolId userId").lean();
  if (!student) {
    res.status(404).json({ success: false, error: "Student data not found." });
    return null;
  }
  return student;
};

export const requireStudentReadAccess = (paramName = "id") => async (req, res, next) => {
  try {
    const access = await getRequestAccess(req);
    const student = await loadStudentForAccess(req, res, paramName);
    if (!student) return;

    if (!access.isHQ && !access.canReadAllStudents && !access.schoolIds.includes(String(student.schoolId))) {
      return deny(res, "This student is outside your authorized Niswan scope.");
    }

    req.authorizedStudent = student;
    return next();
  } catch (error) {
    if (String(error?.name || "") === "CastError") {
      return res.status(400).json({ success: false, error: "Invalid student id." });
    }
    console.log("[authorization] requireStudentReadAccess:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};

export const requireStudentAccess = (paramName = "id") => async (req, res, next) => {
  try {
    const access = await getRequestAccess(req);
    const student = await loadStudentForAccess(req, res, paramName);
    if (!student) return;

    // Mutation access is never widened for Guest. HQ can mutate globally; Admin is limited
    // to the active Employee->schoolId scope resolved above.
    if (!access.isHQ && !access.schoolIds.includes(String(student.schoolId))) {
      return deny(res, "This student is outside your authorized Niswan scope.");
    }

    req.authorizedStudent = student;
    return next();
  } catch (error) {
    if (String(error?.name || "") === "CastError") {
      return res.status(400).json({ success: false, error: "Invalid student id." });
    }
    console.log("[authorization] requireStudentAccess:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};

// -----------------------------------------------------------------------------
// Employee authorization (V0.4)
// Preserves the current production web role model while enforcing scope server-side.
// -----------------------------------------------------------------------------
const EMPLOYEE_READ_ROLES = new Set(["superadmin", "hquser", "supervisor", "admin", "guest"]);
const EMPLOYEE_CREATE_ROLES = new Set(["superadmin", "hquser", "supervisor", "admin"]);
const EMPLOYEE_UPDATE_ROLES = new Set(["superadmin", "hquser", "supervisor", "admin"]);
const EMPLOYEE_DELETE_ROLES = new Set(["superadmin", "supervisor", "admin"]);

const CREATE_TARGET_ROLES = {
  superadmin: new Set(["superadmin", "hquser", "admin", "teacher", "usthadh", "warden"]),
  hquser: new Set(["admin", "teacher"]),
  supervisor: new Set(["admin"]),
  admin: new Set(["usthadh", "warden"]),
};

const requireActiveEmployeeActor = (access, role, res) => {
  if (["admin"].includes(role) && !access.isActive) {
    deny(res, "Your Niswan Admin account is inactive or is not linked to an active employee record.");
    return false;
  }
  if (role === "supervisor" && !access.isActive) {
    deny(res, "Your Muavin account is inactive or is not linked to an active supervisor record.");
    return false;
  }
  return true;
};

export const requireEmployeeReadRole = async (req, res, next) => {
  try {
    const role = normalizeRole(req.user?.role);
    if (!EMPLOYEE_READ_ROLES.has(role)) return deny(res, "Employee data is not available for this role.");
    const access = await getRequestAccess(req);
    if (!requireActiveEmployeeActor(access, role, res)) return;
    return next();
  } catch (error) {
    console.log("[authorization] requireEmployeeReadRole:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};

export const requireEmployeeCreateRole = async (req, res, next) => {
  try {
    const role = normalizeRole(req.user?.role);
    if (!EMPLOYEE_CREATE_ROLES.has(role)) return deny(res, "Employee creation is not available for this role.");
    const access = await getRequestAccess(req);
    if (!requireActiveEmployeeActor(access, role, res)) return;
    return next();
  } catch (error) {
    console.log("[authorization] requireEmployeeCreateRole:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};

export const requireEmployeeUpdateRole = async (req, res, next) => {
  try {
    const role = normalizeRole(req.user?.role);
    if (!EMPLOYEE_UPDATE_ROLES.has(role)) return deny(res, "Employee update is not available for this role.");
    const access = await getRequestAccess(req);
    if (!requireActiveEmployeeActor(access, role, res)) return;
    return next();
  } catch (error) {
    console.log("[authorization] requireEmployeeUpdateRole:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};

export const requireEmployeeDeleteRole = async (req, res, next) => {
  try {
    const role = normalizeRole(req.user?.role);
    if (!EMPLOYEE_DELETE_ROLES.has(role)) return deny(res, "Employee delete is not available for this role.");
    const access = await getRequestAccess(req);
    if (!requireActiveEmployeeActor(access, role, res)) return;
    return next();
  } catch (error) {
    console.log("[authorization] requireEmployeeDeleteRole:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};


export const requireSupervisorAdminList = async (req, res, next) => {
  try {
    const role = normalizeRole(req.user?.role);
    if (role !== "supervisor") return deny(res, "This Admin list is available only to Muavin users.");
    const access = await getRequestAccess(req);
    if (!access.isActive) return deny(res, "Your Muavin account is inactive or is not linked to an active supervisor record.");
    return next();
  } catch (error) {
    console.log("[authorization] requireSupervisorAdminList:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};

export const requireEmployeeHQFilter = (req, res, next) => {
  if (!HQ_ROLES.has(normalizeRole(req.user?.role))) {
    return deny(res, "Global Employee filters are available only to HQ users.");
  }
  return next();
};

export const requireEmployeeImport = (req, res, next) => {
  if (normalizeRole(req.user?.role) !== "superadmin") {
    return deny(res, "Employee import is available only to Super Admin.");
  }
  return next();
};

const loadEmployeeForAccess = async (req, res, paramName = "id") => {
  const employeeId = String(req.params?.[paramName] || "");
  const employee = await Employee.findById(employeeId)
    .select("_id schoolId userId employeeId active")
    .populate({ path: "userId", select: "_id role" })
    .lean();
  if (!employee) {
    res.status(404).json({ success: false, error: "Employee data not found." });
    return null;
  }
  return employee;
};

export const requireEmployeeReadAccess = (paramName = "id") => async (req, res, next) => {
  try {
    const access = await getRequestAccess(req);
    const role = normalizeRole(req.user?.role);
    const employee = await loadEmployeeForAccess(req, res, paramName);
    if (!employee) return;

    if (access.isHQ) {
      req.authorizedEmployee = employee;
      return next();
    }

    const employeeSchoolId = String(employee.schoolId || "");
    const targetRole = normalizeRole(employee.userId?.role);

    if (role === "supervisor") {
      if (!access.schoolIds.includes(employeeSchoolId) || targetRole !== "admin") {
        return deny(res, "This employee is outside your assigned Niswan/Admin scope.");
      }
    } else if (role === "admin") {
      if (!access.schoolIds.includes(employeeSchoolId)) {
        return deny(res, "This employee is outside your Niswan scope.");
      }
    } else if (role === "guest") {
      // Preserve the existing production Guest employeeView permission. Guest remains read-only.
      // This is intentionally compatibility-only; no Employee mutation middleware permits Guest.
    } else {
      return deny(res, "This employee is outside your authorized scope.");
    }

    req.authorizedEmployee = employee;
    return next();
  } catch (error) {
    if (String(error?.name || "") === "CastError") return res.status(400).json({ success: false, error: "Invalid employee id." });
    console.log("[authorization] requireEmployeeReadAccess:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};

export const requireEmployeeCreateAccess = async (req, res, next) => {
  try {
    const access = await getRequestAccess(req);
    const role = normalizeRole(req.user?.role);
    const requestedSchoolId = String(req.body?.schoolId || "");
    const targetRole = normalizeRole(req.body?.role);

    if (!requestedSchoolId || !targetRole) return res.status(400).json({ success: false, error: "Niswan and role are required." });
    const allowedTargets = CREATE_TARGET_ROLES[role];
    if (!allowedTargets?.has(targetRole)) return deny(res, `You cannot create an Employee with role '${targetRole}'.`);

    if (!access.isHQ && !access.schoolIds.includes(requestedSchoolId)) {
      return deny(res, "You can add Employees only inside your authorized Niswan scope.");
    }

    const school = await School.findById(requestedSchoolId).select("_id active").lean();
    if (!school?._id) return res.status(404).json({ success: false, error: "Niswan not found." });
    if (!isActiveValue(school.active)) return deny(res, "Employees cannot be added to an inactive Niswan.");

    return next();
  } catch (error) {
    if (String(error?.name || "") === "CastError") return res.status(400).json({ success: false, error: "Invalid Niswan id." });
    console.log("[authorization] requireEmployeeCreateAccess:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};

export const requireEmployeeUpdateAccess = (paramName = "id") => async (req, res, next) => {
  try {
    const access = await getRequestAccess(req);
    const role = normalizeRole(req.user?.role);
    const employee = await loadEmployeeForAccess(req, res, paramName);
    if (!employee) return;

    const employeeSchoolId = String(employee.schoolId || "");
    const requestedSchoolId = String(req.body?.schoolId || "");
    const oldRole = normalizeRole(employee.userId?.role);
    const newRole = normalizeRole(req.body?.role || oldRole);

    // Current production Web Edit keeps Niswan disabled for every role. Enforce that rule server-side.
    if (!requestedSchoolId || requestedSchoolId !== employeeSchoolId) {
      return deny(res, "Employee Niswan cannot be changed from the Employee Edit workflow.");
    }

    if (role === "superadmin") {
      const allowed = CREATE_TARGET_ROLES.superadmin;
      if (!allowed.has(newRole)) return deny(res, "Selected Employee role is not supported.");
    } else if (role === "hquser") {
      if (oldRole === "superadmin") return deny(res, "HQ User cannot edit a Super Admin Employee record.");
      if (newRole !== oldRole) return deny(res, "Only Super Admin can change an Employee role.");
    } else if (role === "supervisor") {
      if (!access.schoolIds.includes(employeeSchoolId) || oldRole !== "admin") return deny(res, "You can edit only assigned Niswan Admins.");
      if (newRole !== oldRole) return deny(res, "Muavin cannot change an Employee role.");
    } else if (role === "admin") {
      if (!access.schoolIds.includes(employeeSchoolId)) return deny(res, "This employee is outside your Niswan scope.");
      if (String(employee.userId?._id || "") === String(req.user?._id || "")) return deny(res, "Use My Profile to change your own account details.");
      if (newRole !== oldRole) return deny(res, "Niswan Admin cannot change an Employee role.");
    } else {
      return deny(res, "Employee update is not available for this role.");
    }

    // Keep the existing one-active-Admin-per-Niswan rule consistent when Super Admin changes roles/status.
    if (newRole === "admin" && String(req.body?.active || employee.active) === "Active") {
      const duplicate = await Employee.findOne({
        _id: { $ne: employee._id },
        schoolId: employee.schoolId,
        active: "Active",
      }).populate({ path: "userId", match: { role: "admin" }, select: "_id role" }).select("_id userId").lean();
      if (duplicate?.userId) return res.status(400).json({ success: false, error: "An active Admin already exists for this Niswan." });
    }

    req.authorizedEmployee = employee;
    return next();
  } catch (error) {
    if (String(error?.name || "") === "CastError") return res.status(400).json({ success: false, error: "Invalid employee id." });
    console.log("[authorization] requireEmployeeUpdateAccess:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};

export const requireEmployeeDeleteAccess = (paramName = "id") => async (req, res, next) => {
  try {
    const access = await getRequestAccess(req);
    const role = normalizeRole(req.user?.role);
    const employee = await loadEmployeeForAccess(req, res, paramName);
    if (!employee) return;

    const employeeSchoolId = String(employee.schoolId || "");
    const targetRole = normalizeRole(employee.userId?.role);

    if (role === "superadmin") {
      // preserve production global delete permission
    } else if (role === "supervisor") {
      if (!access.schoolIds.includes(employeeSchoolId) || targetRole !== "admin") return deny(res, "You can delete only assigned Niswan Admins.");
    } else if (role === "admin") {
      if (!access.schoolIds.includes(employeeSchoolId)) return deny(res, "This employee is outside your Niswan scope.");
      if (String(employee.userId?._id || "") === String(req.user?._id || "")) return deny(res, "You cannot delete your own Employee record.");
    } else {
      return deny(res, "Employee delete is not available for this role.");
    }

    req.authorizedEmployee = employee;
    return next();
  } catch (error) {
    if (String(error?.name || "") === "CastError") return res.status(400).json({ success: false, error: "Invalid employee id." });
    console.log("[authorization] requireEmployeeDeleteAccess:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};



// -----------------------------------------------------------------------------
// Master authorization (V0.6)
// Preserve the current Web authorization model while finally enforcing it server-side:
// - Super Admin / HQ User: list, view, add, edit, delete master records.
// - Guest: list and view only.
// - Other authenticated roles may still use the existing /fromCache endpoints because
//   Student/Employee/Certificate forms depend on those lookup lists.
// -----------------------------------------------------------------------------
const MASTER_READ_ROLES = new Set(["superadmin", "hquser", "guest"]);
const MASTER_MANAGE_ROLES = new Set(["superadmin", "hquser"]);

export const requireMasterReadRole = (req, res, next) => {
  const role = normalizeRole(req.user?.role);
  if (!MASTER_READ_ROLES.has(role)) {
    return deny(res, "Master maintenance is not available for this role.");
  }
  return next();
};

export const requireMasterManageRole = (req, res, next) => {
  const role = normalizeRole(req.user?.role);
  if (!MASTER_MANAGE_ROLES.has(role)) {
    return deny(res, "Master changes are available only to Super Admin and HQ users.");
  }
  return next();
};


// -----------------------------------------------------------------------------
// Certificate authorization (V0.5)
// Preserve the production Web permission model:
// - Super Admin / HQ User: list, view, create, reprint, duplicate-print.
// - Guest: list and view only.
// No Admin/Muavin certificate access is introduced in V0.5.
// -----------------------------------------------------------------------------
const CERTIFICATE_READ_ROLES = new Set(["superadmin", "hquser", "guest"]);
const CERTIFICATE_MANAGE_ROLES = new Set(["superadmin", "hquser"]);

export const requireCertificateReadRole = (req, res, next) => {
  const role = normalizeRole(req.user?.role);
  if (!CERTIFICATE_READ_ROLES.has(role)) {
    return deny(res, "Certificate data is not available for this role.");
  }
  return next();
};

export const requireCertificateManageRole = (req, res, next) => {
  const role = normalizeRole(req.user?.role);
  if (!CERTIFICATE_MANAGE_ROLES.has(role)) {
    return deny(res, "Certificate management is available only to HQ users.");
  }
  return next();
};

const loadCertificateForAccess = async (req, res, paramName = "id") => {
  const certificateId = String(req.params?.[paramName] || "");
  const certificate = await Certificate.findById(certificateId)
    .select("_id code schoolId studentId templateId courseId certificateDriveFileId")
    .lean();
  if (!certificate) {
    res.status(404).json({ success: false, error: "Certificate not found." });
    return null;
  }
  return certificate;
};

export const requireCertificateReadAccess = (paramName = "id") => async (req, res, next) => {
  try {
    const role = normalizeRole(req.user?.role);
    if (!CERTIFICATE_READ_ROLES.has(role)) {
      return deny(res, "Certificate data is not available for this role.");
    }
    const certificate = await loadCertificateForAccess(req, res, paramName);
    if (!certificate) return;
    req.authorizedCertificate = certificate;
    return next();
  } catch (error) {
    if (String(error?.name || "") === "CastError") {
      return res.status(400).json({ success: false, error: "Invalid certificate id." });
    }
    console.log("[authorization] requireCertificateReadAccess:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};

export const requireCertificateManageAccess = (paramName = "id") => async (req, res, next) => {
  try {
    const role = normalizeRole(req.user?.role);
    if (!CERTIFICATE_MANAGE_ROLES.has(role)) {
      return deny(res, "Certificate management is available only to HQ users.");
    }
    const certificate = await loadCertificateForAccess(req, res, paramName);
    if (!certificate) return;
    req.authorizedCertificate = certificate;
    return next();
  } catch (error) {
    if (String(error?.name || "") === "CastError") {
      return res.status(400).json({ success: false, error: "Invalid certificate id." });
    }
    console.log("[authorization] requireCertificateManageAccess:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};

// Runs after multer so multipart/form-data fields are available on req.body.
// This is a data-integrity check, even for HQ: the Student must actually belong to
// the submitted Niswan and the Template/School/Student ids must resolve before the
// expensive PDF/Drive generation starts.
export const requireCertificateCreateAccess = async (req, res, next) => {
  try {
    const role = normalizeRole(req.user?.role);
    if (!CERTIFICATE_MANAGE_ROLES.has(role)) {
      return deny(res, "Certificate creation is available only to HQ users.");
    }

    const templateId = String(req.body?.templateId || "");
    const schoolId = String(req.body?.schoolId || "");
    const studentId = String(req.body?.studentId || "");
    if (!templateId || !schoolId || !studentId) {
      return res.status(400).json({
        success: false,
        error: "Template, Niswan and Student are required.",
      });
    }

    const [template, school, student] = await Promise.all([
      Template.findById(templateId).select("_id courseId certificateFees").lean(),
      School.findById(schoolId).select("_id active").lean(),
      Student.findById(studentId).select("_id schoolId userId").lean(),
    ]);

    if (!template?._id) return res.status(404).json({ success: false, error: "Template not found." });
    if (!school?._id) return res.status(404).json({ success: false, error: "School not found." });
    if (!student?._id) return res.status(404).json({ success: false, error: "Student not found." });
    if (String(student.schoolId || "") !== String(school._id)) {
      return res.status(400).json({
        success: false,
        error: "Selected Student does not belong to the selected Niswan.",
      });
    }

    // Enforce on the server the same eligibility rule used by the production Web selector:
    // the matching course must be Completed. If Template Master certificate fee is > 0,
    // the CERTIFICATE fee invoice must be PAID. If fee is 0, invoice is not required.
    const completedAcademic = await Academic.findOne({
      studentId: student._id,
      $or: [
        { courseId1: template.courseId, status1: "Completed" },
        { courseId2: template.courseId, status2: "Completed" },
        { courseId3: template.courseId, status3: "Completed" },
        { courseId4: template.courseId, status4: "Completed" },
        { courseId5: template.courseId, status5: "Completed" },
      ],
    }).select("_id acYear").lean();

    if (!completedAcademic?._id) {
      return res.status(400).json({
        success: false,
        error: "Selected Student has not completed the Certificate course.",
      });
    }

    const rawTemplateCertificateFees = Number(template?.certificateFees);
    const templateCertificateFees =
      Number.isFinite(rawTemplateCertificateFees) && rawTemplateCertificateFees >= 0
        ? rawTemplateCertificateFees
        : 75;
    const isCertificateFree = templateCertificateFees <= 0;

    // Certificate fee 0 means free certificate.
    // Do not require a CERTIFICATE invoice and do not let old pending invoices block printing.
    if (!isCertificateFree) {
      const paidCertificateInvoice = await FeeInvoice.findOne({
        schoolId: school._id,
        studentId: student._id,
        courseId: template.courseId,
        source: "CERTIFICATE",
        status: "PAID",
      }).select("_id").lean();

      if (!paidCertificateInvoice?._id) {
        return res.status(400).json({
          success: false,
          error: "Certificate fee is pending for the selected Student.",
        });
      }
    }

    req.authorizedCertificateStudent = student;
    req.authorizedCertificateSchool = school;
    req.authorizedCertificateTemplate = template;
    return next();
  } catch (error) {
    if (String(error?.name || "") === "CastError") {
      return res.status(400).json({ success: false, error: "Invalid Certificate request id." });
    }
    console.log("[authorization] requireCertificateCreateAccess:", error?.message || error);
    return res.status(500).json({ success: false, error: "Authorization check failed." });
  }
};

// V0.10 — Inspection / Accounts / Reports boundaries.
const INSPECTION_READ_ROLES = new Set(["superadmin", "hquser", "supervisor"]);
const REPORT_ROLES = new Set(["superadmin", "hquser", "supervisor", "admin", "guest"]);
const ACCOUNT_ROLES = new Set(["superadmin", "hquser", "admin"]);

export const requireInspectionReadRole = async (req, res, next) => {
  try {
    const access = await getRequestAccess(req);
    if (!INSPECTION_READ_ROLES.has(access.role)) return deny(res, "Inspection reports are not available for this role.");
    if (access.role === "supervisor" && !access.isActive) return deny(res, "Inactive Muavin accounts cannot access inspection reports.");
    return next();
  } catch (error) {
    return res.status(500).json({ success: false, error: "Unable to verify Inspection access." });
  }
};

export const requireInspectionCreateRole = async (req, res, next) => {
  try {
    const access = await getRequestAccess(req);
    if (access.role !== "supervisor") return deny(res, "Only an active Muavin can submit an inspection report.");
    if (!access.isActive) return deny(res, "Inactive Muavin accounts cannot submit inspection reports.");
    return next();
  } catch (error) {
    return res.status(500).json({ success: false, error: "Unable to verify Inspection access." });
  }
};

export const requireReportsRole = async (req, res, next) => {
  try {
    const access = await getRequestAccess(req);
    if (!REPORT_ROLES.has(access.role)) return deny(res, "Reports are not available for this role.");
    if (["admin", "supervisor"].includes(access.role) && !access.isActive) {
      return deny(res, "Inactive accounts cannot access reports.");
    }
    return next();
  } catch (error) {
    return res.status(500).json({ success: false, error: "Unable to verify Reports access." });
  }
};

export const requireAccountsRole = async (req, res, next) => {
  try {
    const access = await getRequestAccess(req);
    if (!ACCOUNT_ROLES.has(access.role)) return deny(res, "Accounts are not available for this role.");
    if (access.role === "admin" && !access.isActive) return deny(res, "Inactive Admin accounts cannot access Accounts.");
    return next();
  } catch (error) {
    return res.status(500).json({ success: false, error: "Unable to verify Accounts access." });
  }
};

const verifyAccountSchoolValue = async (req, res, next, value, { allowAllForHQ = false } = {}) => {
  try {
    const access = await getRequestAccess(req);
    if (!ACCOUNT_ROLES.has(access.role)) return deny(res, "Accounts are not available for this role.");
    if (access.isHQ) {
      if (allowAllForHQ && String(value || "").toUpperCase() === "ALL") return next();
      return next();
    }
    if (!access.isActive) return deny(res, "Inactive Admin accounts cannot access Accounts.");
    const requested = String(value || "");
    if (!requested || !access.schoolIds.includes(requested)) {
      return deny(res, "You can access Accounts only for your own Niswan.");
    }
    return next();
  } catch (error) {
    return res.status(500).json({ success: false, error: "Unable to verify Niswan Accounts access." });
  }
};

export const requireAccountSchoolParamAccess = (paramName = "schoolId", options = {}) => (req, res, next) =>
  verifyAccountSchoolValue(req, res, next, req.params?.[paramName], options);

export const requireAccountSchoolBodyAccess = (fieldName = "schoolId") => (req, res, next) =>
  verifyAccountSchoolValue(req, res, next, req.body?.[fieldName]);

export const requireAccountSchoolQueryAccess = (fieldName = "schoolId", options = {}) => (req, res, next) =>
  verifyAccountSchoolValue(req, res, next, req.query?.[fieldName], options);

export const requireInspectionSchoolBodyAccess = async (req, res, next) => {
  try {
    const access = await getRequestAccess(req);
    if (access.role !== "supervisor" || !access.isActive) {
      return deny(res, "Only an active Muavin can submit an inspection report.");
    }
    const requested = String(req.body?.schoolId || "");
    if (!requested || !access.schoolIds.includes(requested)) {
      return deny(res, "You can submit an inspection report only for an assigned Niswan.");
    }
    return next();
  } catch (error) {
    console.log("[authorization] requireInspectionSchoolBodyAccess:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to verify Inspection Niswan access." });
  }
};

// -----------------------------------------------------------------------------
// Administration authorization (V0.11)
// -----------------------------------------------------------------------------
const SCHOOL_READ_ROLES_V011 = new Set(['superadmin', 'hquser', 'supervisor', 'admin', 'guest']);
const SUPERVISOR_LIST_ROLES_V011 = new Set(['superadmin', 'hquser', 'supervisor', 'guest']);
const SUPERVISOR_DETAIL_ROLES_V011 = new Set(['superadmin', 'hquser', 'guest']);

export const requireSuperAdmin = (req, res, next) => {
  if (normalizeRole(req.user?.role) !== 'superadmin') {
    return deny(res, 'This operation is available only to Super Admin.');
  }
  return next();
};

export const requireSchoolReadRole = async (req, res, next) => {
  try {
    const role = normalizeRole(req.user?.role);
    if (!SCHOOL_READ_ROLES_V011.has(role)) return deny(res, 'Niswan data is not available for this role.');
    const access = await getRequestAccess(req);
    if (['admin', 'supervisor'].includes(role) && !access.isActive) {
      return deny(res, 'Your account is inactive or is not linked to an active UNIS scope record.');
    }
    return next();
  } catch (error) {
    console.log('[authorization] requireSchoolReadRole:', error?.message || error);
    return res.status(500).json({ success: false, error: 'Authorization check failed.' });
  }
};

export const requireSchoolManageRole = (req, res, next) => {
  if (!HQ_ROLES.has(normalizeRole(req.user?.role))) {
    return deny(res, 'Niswan management is available only to HQ users.');
  }
  return next();
};

export const requireSchoolReadAccess = (paramName = 'id') => async (req, res, next) => {
  try {
    const role = normalizeRole(req.user?.role);
    const access = await getRequestAccess(req);
    if (access.isHQ || role === 'guest') return next();

    const id = String(req.params?.[paramName] || '');
    if (!id || !access.schoolIds.includes(id)) {
      return deny(res, 'This Niswan is outside your authorized scope.');
    }
    return next();
  } catch (error) {
    console.log('[authorization] requireSchoolReadAccess:', error?.message || error);
    return res.status(500).json({ success: false, error: 'Authorization check failed.' });
  }
};

export const requireSupervisorListRole = (req, res, next) => {
  const role = normalizeRole(req.user?.role);
  if (!SUPERVISOR_LIST_ROLES_V011.has(role)) {
    return deny(res, 'Muavin directory is not available for this role.');
  }
  return next();
};

export const requireSupervisorDetailRole = (req, res, next) => {
  const role = normalizeRole(req.user?.role);
  if (!SUPERVISOR_DETAIL_ROLES_V011.has(role)) {
    return deny(res, 'Muavin details are not available for this role.');
  }
  return next();
};

export const requireSupervisorManageRole = (req, res, next) => {
  if (!HQ_ROLES.has(normalizeRole(req.user?.role))) {
    return deny(res, 'Muavin management is available only to HQ users.');
  }
  return next();
};
