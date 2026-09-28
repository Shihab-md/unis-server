import mongoose from "mongoose";
import Employee from "../models/Employee.js";
import Supervisor from "../models/Supervisor.js";
import School from "../models/School.js";
import User from "../models/User.js";
import {
  ORGANIZATION_TYPES,
  getHqOrganizationSummary,
  getNiswanSchoolFilter,
  normalizeOrganizationType,
} from "../config/organizationPolicy.js";

export const normalizeRole = (value) => String(value || "").trim().toLowerCase();

const EMPLOYEE_STAFF_ROLES = new Set([
  "hqadmin",
  "accountant",
  "hquser",
  "hqstaff",
  "admin",
  "employee",
  "teacher",
  "usthadh",
  "warden",
  "staff",
]);

export const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

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
      organizationType: ORGANIZATION_TYPES.HQ,
      schoolId: null,
      record: supervisor,
    };
  }

  if (EMPLOYEE_STAFF_ROLES.has(role)) {
    const employee = await Employee.findOne({ userId })
      .populate({ path: "userId", select: "_id name email role" })
      .populate({ path: "schoolId", select: "_id code nameEnglish active recordType" })
      .lean();

    if (!employee?._id) return null;
    const organizationType = normalizeOrganizationType(employee.organizationType);
    return {
      staffType: "Employee",
      staffId: String(employee._id),
      userId: String(employee.userId?._id || userId),
      role,
      active: employee.active,
      organizationType,
      schoolId:
        organizationType === ORGANIZATION_TYPES.NISWAN && employee.schoolId?._id
          ? String(employee.schoolId._id)
          : null,
      schoolCode:
        organizationType === ORGANIZATION_TYPES.NISWAN ? employee.schoolId?.code || "" : "",
      record: employee,
    };
  }

  return null;
};

export const getAttendanceAccess = async (user) => {
  const role = normalizeRole(user?.role);
  const actorStaff = await getActorStaff(user);
  const actorOrganizationType = actorStaff?.organizationType || null;
  const actorSchoolId = actorStaff?.schoolId || null;
  const isLegacyHqAdmin = role === "admin" && actorOrganizationType === ORGANIZATION_TYPES.HQ;
  const isHqAdmin = role === "hqadmin" || isLegacyHqAdmin;
  const hasGlobalRead = ["superadmin", "hqadmin", "accountant", "hquser"].includes(role);

  return {
    role,
    userId: user?._id ? String(user._id) : null,
    actorStaff,
    hqOrganization: getHqOrganizationSummary(),
    isSuperAdmin: role === "superadmin",
    isHqUser: role === "hquser",
    isHqAdmin,
    isLegacyHqAdmin,
    isAccountant: role === "accountant",
    isHqStaff: role === "hqstaff",
    actorOrganizationType,
    actorSchoolId,
    canManageAnyNiswan: role === "superadmin",
    canViewAnyNiswanStaff: hasGlobalRead,
    canViewHqStaff: hasGlobalRead || isLegacyHqAdmin,
    canManageHqStaff: role === "superadmin" || role === "hqadmin" || isLegacyHqAdmin,
    canManageOwnNiswanStaff:
      role === "admin" && !isLegacyHqAdmin && actorOrganizationType === ORGANIZATION_TYPES.NISWAN && Boolean(actorSchoolId),
    canManageOwnNiswanStudents:
      ["admin", "teacher", "usthadh"].includes(role) &&
      !isLegacyHqAdmin &&
      actorOrganizationType === ORGANIZATION_TYPES.NISWAN &&
      Boolean(actorSchoolId),
    canViewAnyStudents: hasGlobalRead,
    canManageAnyStudents: role === "superadmin" || role === "hqadmin",
    canViewOwnStaffAttendance: Boolean(actorStaff),
    canApplyOwnStaffLeave: Boolean(actorStaff),
  };
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
  return scope === ORGANIZATION_TYPES.HQ ? ORGANIZATION_TYPES.HQ : ORGANIZATION_TYPES.NISWAN;
};

export const resolveStaffScope = async ({ user, scopeType, schoolId, requireManage = false }) => {
  const access = await getAttendanceAccess(user);
  const requestedScope = normalizeScopeType(scopeType);

  if (requestedScope === ORGANIZATION_TYPES.HQ) {
    if (requireManage && !access.canManageHqStaff) {
      throw forbidden("You are not authorized to manage HQ staff attendance.");
    }
    if (!requireManage && !access.canViewHqStaff) {
      throw forbidden("You are not authorized to view the HQ staff attendance roster.");
    }
    return {
      access,
      organizationType: ORGANIZATION_TYPES.HQ,
      schoolId: null,
      school: null,
      organization: access.hqOrganization,
    };
  }

  let targetSchoolId = String(schoolId || "").trim();

  if (access.isSuperAdmin) {
    if (!isObjectId(targetSchoolId)) throw badRequest("Please select a valid Niswan.");
  } else if (!requireManage && access.canViewAnyNiswanStaff) {
    if (!isObjectId(targetSchoolId)) throw badRequest("Please select a valid Niswan.");
  } else if (access.canManageOwnNiswanStaff) {
    targetSchoolId = access.actorSchoolId;
  } else {
    throw forbidden(
      requireManage
        ? "You are not authorized to manage Niswan staff attendance."
        : "You are not authorized to view Niswan staff attendance."
    );
  }

  const school = await School.findOne({ _id: targetSchoolId, ...getNiswanSchoolFilter() })
    .select("_id code nameEnglish active recordType")
    .lean();
  if (!school?._id) throw badRequest("Selected Niswan was not found.");

  return {
    access,
    organizationType: ORGANIZATION_TYPES.NISWAN,
    schoolId: String(school._id),
    school: { _id: String(school._id), code: school.code, nameEnglish: school.nameEnglish },
    organization: {
      organizationType: ORGANIZATION_TYPES.NISWAN,
      code: school.code,
      nameEnglish: school.nameEnglish,
    },
  };
};

export const resolvePayrollScope = async ({ user, scopeType, schoolId }) => {
  const access = await getAttendanceAccess(user);
  const role = access.role;
  const requestedScope = normalizeScopeType(scopeType);
  const hasGlobalPayrollScope = ["superadmin", "hqadmin", "accountant"].includes(role);
  const hasOwnNiswanPayrollScope =
    role === "admin" &&
    !access.isLegacyHqAdmin &&
    access.actorOrganizationType === ORGANIZATION_TYPES.NISWAN &&
    Boolean(access.actorSchoolId);

  if (requestedScope === ORGANIZATION_TYPES.HQ) {
    if (!hasGlobalPayrollScope) {
      throw forbidden("You are not authorized to access HQ Payroll.");
    }
    return {
      access,
      organizationType: ORGANIZATION_TYPES.HQ,
      schoolId: null,
      school: null,
      organization: access.hqOrganization,
    };
  }

  let targetSchoolId = String(schoolId || "").trim();
  if (hasGlobalPayrollScope) {
    if (!isObjectId(targetSchoolId)) throw badRequest("Please select a valid Niswan.");
  } else if (hasOwnNiswanPayrollScope) {
    targetSchoolId = access.actorSchoolId;
  } else {
    throw forbidden("You are not authorized to access Niswan Payroll.");
  }

  const school = await School.findOne({ _id: targetSchoolId, ...getNiswanSchoolFilter() })
    .select("_id code nameEnglish active recordType")
    .lean();
  if (!school?._id) throw badRequest("Selected Niswan was not found.");

  return {
    access,
    organizationType: ORGANIZATION_TYPES.NISWAN,
    schoolId: String(school._id),
    school: { _id: String(school._id), code: school.code, nameEnglish: school.nameEnglish },
    organization: {
      organizationType: ORGANIZATION_TYPES.NISWAN,
      code: school.code,
      nameEnglish: school.nameEnglish,
    },
  };
};

export const resolveStudentScope = async ({ user, schoolId, requireManage = true }) => {
  const access = await getAttendanceAccess(user);
  let targetSchoolId = String(schoolId || "").trim();

  if (requireManage ? access.canManageAnyStudents : access.canViewAnyStudents) {
    if (!isObjectId(targetSchoolId)) throw badRequest("Please select a valid Niswan.");
  } else if (access.canManageOwnNiswanStudents) {
    targetSchoolId = access.actorSchoolId;
  } else {
    throw forbidden(
      requireManage
        ? "Student attendance management is not available for this account."
        : "Student attendance view is not available for this account."
    );
  }

  const school = await School.findOne({ _id: targetSchoolId, ...getNiswanSchoolFilter() })
    .select("_id code nameEnglish active recordType")
    .lean();
  if (!school?._id) throw badRequest("Selected Niswan was not found.");

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
      organizationType: ORGANIZATION_TYPES.HQ,
      schoolId: null,
      active: record.active,
      record,
    };
  }

  const record = await Employee.findById(staffId)
    .populate({ path: "userId", select: "_id name email role" })
    .populate({ path: "schoolId", select: "_id code nameEnglish active recordType" })
    .lean();
  if (!record?._id) return null;
  const organizationType = normalizeOrganizationType(record.organizationType);
  return {
    staffType: "Employee",
    staffId: String(record._id),
    userId: String(record.userId?._id || ""),
    role: normalizeRole(record.userId?.role),
    organizationType,
    schoolId:
      organizationType === ORGANIZATION_TYPES.NISWAN && record.schoolId?._id
        ? String(record.schoolId._id)
        : null,
    schoolCode:
      organizationType === ORGANIZATION_TYPES.NISWAN ? record.schoolId?.code || "" : "",
    active: record.active,
    record,
  };
};

export const staffBelongsToScope = async ({ staff, organizationType, schoolId }) => {
  if (!staff) return false;

  if (organizationType === ORGANIZATION_TYPES.HQ) {
    return staff.staffType === "Supervisor" || staff.organizationType === ORGANIZATION_TYPES.HQ;
  }

  return (
    staff.staffType === "Employee" &&
    staff.organizationType === ORGANIZATION_TYPES.NISWAN &&
    String(staff.schoolId || "") === String(schoolId || "")
  );
};

export const canApproveStaffLeave = async ({ approverUser, leave }) => {
  const access = await getAttendanceAccess(approverUser);
  const targetUser = await User.findById(leave.userId).select("_id role").lean();
  const targetRole = normalizeRole(targetUser?.role);

  if (String(leave.userId) === String(approverUser?._id)) return false;

  // HQ Admin and Niswan Admin leave is escalated to SuperAdmin.
  if (["hqadmin", "admin"].includes(targetRole)) return access.isSuperAdmin;

  if (access.isSuperAdmin) return true;

  if (leave.organizationType === ORGANIZATION_TYPES.HQ) {
    return access.canManageHqStaff;
  }

  return access.canManageOwnNiswanStaff && String(access.actorSchoolId) === String(leave.schoolId || "");
};

export const canManagePayrollScope = async ({ user, scopeType, schoolId }) =>
  resolvePayrollScope({ user, scopeType, schoolId });
