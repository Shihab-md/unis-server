import mongoose from "mongoose";
import Employee from "../models/Employee.js";
import Supervisor from "../models/Supervisor.js";
import School from "../models/School.js";
import User from "../models/User.js";

export const HQ_SCHOOL_CODE = String(process.env.UNIS_HQ_SCHOOL_CODE || "UN-00-00001").trim();

export const normalizeRole = (value) => String(value || "").trim().toLowerCase();

const EMPLOYEE_STAFF_ROLES = new Set([
  "hquser",
  "admin",
  "employee",
  "teacher",
  "usthadh",
  "warden",
  "staff",
]);

export const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

export const getHqSchool = async () =>
  School.findOne({ code: HQ_SCHOOL_CODE }).select("_id code nameEnglish active").lean();

export const getActorStaff = async (user) => {
  const role = normalizeRole(user?.role);
  const userId = user?._id;
  if (!userId) return null;

  if (role === "supervisor") {
    const supervisor = await Supervisor.findOne({ userId })
      .populate({ path: "userId", select: "_id name email role" })
      .lean();

    if (!supervisor?._id) return null;
    return {
      staffType: "Supervisor",
      staffId: String(supervisor._id),
      userId: String(supervisor.userId?._id || userId),
      role,
      active: supervisor.active,
      schoolId: null,
      record: supervisor,
    };
  }

  if (EMPLOYEE_STAFF_ROLES.has(role)) {
    const employee = await Employee.findOne({ userId })
      .populate({ path: "userId", select: "_id name email role" })
      .populate({ path: "schoolId", select: "_id code nameEnglish active" })
      .lean();

    if (!employee?._id) return null;
    return {
      staffType: "Employee",
      staffId: String(employee._id),
      userId: String(employee.userId?._id || userId),
      role,
      active: employee.active,
      schoolId: employee.schoolId?._id ? String(employee.schoolId._id) : null,
      schoolCode: employee.schoolId?.code || "",
      record: employee,
    };
  }

  return null;
};

export const getAttendanceAccess = async (user) => {
  const role = normalizeRole(user?.role);
  const hqSchool = await getHqSchool();
  const actorStaff = await getActorStaff(user);

  const actorSchoolId = actorStaff?.schoolId || null;
  const actorSchoolCode = actorStaff?.schoolCode || "";
  const isHqAdmin = role === "admin" && actorSchoolCode === HQ_SCHOOL_CODE;

  const access = {
    role,
    userId: user?._id ? String(user._id) : null,
    actorStaff,
    hqSchool: hqSchool
      ? { _id: String(hqSchool._id), code: hqSchool.code, nameEnglish: hqSchool.nameEnglish }
      : null,
    isSuperAdmin: role === "superadmin",
    isHqUser: role === "hquser",
    isHqAdmin,
    actorSchoolId,
    canManageAnyNiswan: role === "superadmin",
    canManageHqStaff: role === "superadmin" || role === "hquser" || isHqAdmin,
    canManageOwnNiswanStaff: role === "admin" && !isHqAdmin && Boolean(actorSchoolId),
    canManageOwnNiswanStudents:
      ["admin", "teacher", "usthadh"].includes(role) && !isHqAdmin && Boolean(actorSchoolId),
    canManageAnyStudents: role === "superadmin",
    canViewOwnStaffAttendance: Boolean(actorStaff),
    canApplyOwnStaffLeave: Boolean(actorStaff),
  };

  return access;
};

const forbidden = (message) => {
  const error = new Error(message);
  error.status = 403;
  return error;
};

const badRequest = (message) => {
  const error = new Error(message);
  error.status = 400;
  return error;
};

export const normalizeScopeType = (value) => {
  const scope = String(value || "").trim().toUpperCase();
  return scope === "HQ" ? "HQ" : "NISWAN";
};

export const resolveStaffScope = async ({ user, scopeType, schoolId, requireManage = false }) => {
  const access = await getAttendanceAccess(user);
  const requestedScope = normalizeScopeType(scopeType);

  if (requestedScope === "HQ") {
    if (!access.hqSchool?._id) throw badRequest(`HQ Niswan (${HQ_SCHOOL_CODE}) is not configured.`);
    if (requireManage && !access.canManageHqStaff) {
      throw forbidden("You are not authorized to manage HQ staff attendance.");
    }
    if (!requireManage && !access.canManageHqStaff) {
      // Non-managers may only use self endpoints, never browse the whole HQ roster.
      throw forbidden("HQ staff list is available only to authorized HQ attendance managers.");
    }
    return {
      access,
      organizationType: "HQ",
      schoolId: access.hqSchool._id,
      school: access.hqSchool,
    };
  }

  let targetSchoolId = String(schoolId || "").trim();

  if (access.isSuperAdmin) {
    if (!isObjectId(targetSchoolId)) throw badRequest("Please select a valid Niswan.");
  } else if (access.canManageOwnNiswanStaff) {
    targetSchoolId = access.actorSchoolId;
  } else {
    throw forbidden("You are not authorized to manage Niswan staff attendance.");
  }

  const school = await School.findById(targetSchoolId).select("_id code nameEnglish active").lean();
  if (!school?._id) throw badRequest("Selected Niswan was not found.");

  if (String(school.code) === HQ_SCHOOL_CODE) {
    // Keep HQ rules explicit. Do not let a forged NISWAN request bypass HQ authorization.
    if (!access.canManageHqStaff) throw forbidden("HQ staff scope is not available for this account.");
    return {
      access,
      organizationType: "HQ",
      schoolId: String(school._id),
      school: { _id: String(school._id), code: school.code, nameEnglish: school.nameEnglish },
    };
  }

  return {
    access,
    organizationType: "NISWAN",
    schoolId: String(school._id),
    school: { _id: String(school._id), code: school.code, nameEnglish: school.nameEnglish },
  };
};

export const resolveStudentScope = async ({ user, schoolId, requireManage = true }) => {
  const access = await getAttendanceAccess(user);
  let targetSchoolId = String(schoolId || "").trim();

  if (access.canManageAnyStudents) {
    if (!isObjectId(targetSchoolId)) throw badRequest("Please select a valid Niswan.");
  } else if (access.canManageOwnNiswanStudents) {
    targetSchoolId = access.actorSchoolId;
  } else {
    throw forbidden("Student attendance is not available for this account.");
  }

  const school = await School.findById(targetSchoolId).select("_id code nameEnglish active").lean();
  if (!school?._id) throw badRequest("Selected Niswan was not found.");
  if (String(school.code) === HQ_SCHOOL_CODE) {
    throw badRequest("HQ is for staff attendance. Please select a Niswan for student attendance.");
  }

  return {
    access,
    schoolId: String(school._id),
    school: { _id: String(school._id), code: school.code, nameEnglish: school.nameEnglish },
  };
};

export const loadStaffByRef = async ({ staffType, staffId }) => {
  if (!isObjectId(staffId)) return null;

  if (staffType === "Supervisor") {
    const record = await Supervisor.findById(staffId)
      .populate({ path: "userId", select: "_id name email role" })
      .lean();
    if (!record?._id) return null;
    return {
      staffType: "Supervisor",
      staffId: String(record._id),
      userId: String(record.userId?._id || ""),
      role: normalizeRole(record.userId?.role || "supervisor"),
      schoolId: null,
      active: record.active,
      record,
    };
  }

  const record = await Employee.findById(staffId)
    .populate({ path: "userId", select: "_id name email role" })
    .populate({ path: "schoolId", select: "_id code nameEnglish active" })
    .lean();
  if (!record?._id) return null;
  return {
    staffType: "Employee",
    staffId: String(record._id),
    userId: String(record.userId?._id || ""),
    role: normalizeRole(record.userId?.role),
    schoolId: record.schoolId?._id ? String(record.schoolId._id) : null,
    schoolCode: record.schoolId?.code || "",
    active: record.active,
    record,
  };
};

export const staffBelongsToScope = async ({ staff, organizationType, schoolId }) => {
  if (!staff) return false;

  if (organizationType === "HQ") {
    if (staff.staffType === "Supervisor") return true;
    return String(staff.schoolId || "") === String(schoolId || "");
  }

  return staff.staffType === "Employee" && String(staff.schoolId || "") === String(schoolId || "");
};

export const canApproveStaffLeave = async ({ approverUser, leave }) => {
  const access = await getAttendanceAccess(approverUser);
  const targetUser = await User.findById(leave.userId).select("_id role").lean();
  const targetRole = normalizeRole(targetUser?.role);

  if (String(leave.userId) === String(approverUser?._id)) return false;

  // Admin leave (HQ Admin or Niswan Admin) is escalated to SuperAdmin.
  if (targetRole === "admin") return access.isSuperAdmin;

  if (access.isSuperAdmin) return true;

  if (leave.organizationType === "HQ") {
    return access.canManageHqStaff;
  }

  return access.canManageOwnNiswanStaff && String(access.actorSchoolId) === String(leave.schoolId || "");
};

export const canManagePayrollScope = async ({ user, scopeType, schoolId }) =>
  resolveStaffScope({ user, scopeType, schoolId, requireManage: true });
