import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import School from "../models/School.js";
import Supervisor from "../models/Supervisor.js";
import Employee from "../models/Employee.js";
import Student from "../models/Student.js";
import User from "../models/User.js";
import Academic from "../models/Academic.js";
import { sendCSV, sendXLSX } from "../utils/reportExport.js";
import { formatCompactDuration } from "../utils/profileDuration.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const isObjectIdLike = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const safeStr = (value) => (value === undefined || value === null ? "" : String(value).trim());
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ALUMNI_STUDENT_STATUSES = ["Graduated"];
const ALUMNI_ACADEMIC_STATUS = "Completed";

const getAuthPayload = (req) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return jwt.verify(token, process.env.JWT_SECRET);
};

const getPagination = (req) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(10, Number.parseInt(req.query.limit, 10) || 50));
  return { page, limit, skip: (page - 1) * limit };
};

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB");
};

const canViewSensitive = (role) => ["superadmin", "hquser"].includes(String(role || "").toLowerCase());

async function getAccessibleSchoolIds({ role, schoolId, userId }) {
  const normalizedRole = String(role || "").toLowerCase();
  if (normalizedRole === "superadmin" || normalizedRole === "hquser") return null;

  if (normalizedRole === "admin") {
    return schoolId && isObjectIdLike(schoolId) ? [String(schoolId)] : [];
  }

  if (normalizedRole === "supervisor") {
    const uid = safeStr(userId);
    if (!uid) return [];
    const supervisor = await Supervisor.findOne({ userId: uid }).select("_id").lean();
    if (!supervisor?._id && !isObjectIdLike(uid)) return [];
    const possibleSupervisorIds = [];
    if (supervisor?._id) possibleSupervisorIds.push(supervisor._id);
    if (isObjectIdLike(uid)) possibleSupervisorIds.push(oid(uid));
    const schools = await School.find({ supervisorId: { $in: possibleSupervisorIds } }).select("_id").lean();
    return schools.map((school) => String(school._id));
  }

  return schoolId && isObjectIdLike(schoolId) ? [String(schoolId)] : [];
}

async function resolveSchoolScope({ allowedSchoolIds, schoolId, schoolCode, schoolSearch }) {
  if (schoolId && isObjectIdLike(schoolId)) {
    if (allowedSchoolIds === null) return [String(schoolId)];
    return allowedSchoolIds.includes(String(schoolId)) ? [String(schoolId)] : [];
  }

  const hasSchoolFilter = Boolean(safeStr(schoolCode) || safeStr(schoolSearch));
  if (!hasSchoolFilter) return allowedSchoolIds;

  const query = {};
  if (allowedSchoolIds !== null) query._id = { $in: allowedSchoolIds.map(oid) };
  if (safeStr(schoolCode)) query.code = safeStr(schoolCode);
  if (safeStr(schoolSearch)) {
    const regex = new RegExp(escapeRegex(safeStr(schoolSearch)), "i");
    query.$or = [{ code: regex }, { nameEnglish: regex }];
  }

  const schools = await School.find(query).select("_id").lean();
  return schools.map((school) => String(school._id));
}

const schoolMatch = (resolvedSchoolIds) => {
  if (resolvedSchoolIds === null) return {};
  if (!Array.isArray(resolvedSchoolIds) || resolvedSchoolIds.length === 0) return { schoolId: { $in: [] } };
  return { schoolId: { $in: resolvedSchoolIds.map(oid) } };
};

const buildAcademicClauses = ({ courseId, studyYear, courseStatus }) => {
  const clauses = [];
  const courseObjectId = courseId && isObjectIdLike(courseId) ? oid(courseId) : null;
  const rawYear = safeStr(studyYear);
  const year = rawYear === "" ? null : Number(rawYear);
  const validYear = Number.isInteger(year) && year >= 0 && year <= 20 ? year : null;
  const status = safeStr(courseStatus);
  if (!courseObjectId && validYear === null && !status) return clauses;

  for (let i = 1; i <= 5; i += 1) {
    const clause = {};
    if (courseObjectId) clause[`courseId${i}`] = courseObjectId;
    if (validYear !== null) clause[`year${i}`] = validYear;
    if (status) clause[`status${i}`] = status;
    clauses.push(clause);
  }
  return clauses;
};

async function getStudentIdsByAcademicFilter({ acYear, courseId, studyYear, courseStatus }) {
  const match = {};
  if (acYear && isObjectIdLike(acYear)) match.acYear = oid(acYear);
  const clauses = buildAcademicClauses({ courseId, studyYear, courseStatus });
  if (clauses.length) match.$or = clauses;
  if (!Object.keys(match).length) return null;
  return Academic.distinct("studentId", match);
}

async function buildStudentReportMatch(req, payload) {
  const role = payload.role;
  const userId = payload.id || payload._id || payload.userId;
  const allowedSchoolIds = await getAccessibleSchoolIds({ role, schoolId: payload.schoolId, userId });
  const resolvedSchoolIds = await resolveSchoolScope({
    allowedSchoolIds,
    schoolId: safeStr(req.query.schoolId),
    schoolCode: safeStr(req.query.schoolCode),
    schoolSearch: safeStr(req.query.q),
  });

  const status = safeStr(req.query.status);
  const [academicIds, alumniIds] = await Promise.all([
    getStudentIdsByAcademicFilter({
      acYear: safeStr(req.query.acYear),
      courseId: safeStr(req.query.courseId),
      studyYear: safeStr(req.query.year),
    }),
    status.toLowerCase() === "alumni"
      ? getStudentIdsByAcademicFilter({
          acYear: safeStr(req.query.acYear),
          courseId: safeStr(req.query.courseId),
          studyYear: safeStr(req.query.year),
          courseStatus: ALUMNI_ACADEMIC_STATUS,
        })
      : Promise.resolve(null),
  ]);

  const match = schoolMatch(resolvedSchoolIds);
  const hostel = safeStr(req.query.hostel);
  const feesStatus = safeStr(req.query.feesStatus);
  if (hostel === "Yes" || hostel === "No") match.hostel = hostel;
  if (feesStatus === "Paid") match.feesPaid = 1;
  if (feesStatus === "Unpaid") match.feesPaid = 0;
  if (Array.isArray(academicIds)) match._id = { $in: academicIds.map(oid) };

  if (status.toLowerCase() === "alumni") {
    const or = [{ active: { $in: ALUMNI_STUDENT_STATUSES } }];
    if (Array.isArray(alumniIds) && alumniIds.length) or.push({ _id: { $in: alumniIds.map(oid) } });
    match.$or = or;
  } else if (status) {
    match.active = status;
  }

  return match;
}

const mapStudentRow = (student, { includeSensitive = false } = {}) => {
  const row = {
    _id: student._id,
    rollNumber: student.rollNumber || "-",
    name: student.userId?.name || "-",
    schoolCode: student.schoolId?.code || "-",
    schoolName: student.schoolId?.nameEnglish || "-",
    dob: student.dob || null,
    age: formatCompactDuration(student.dob),
    admissionDate: student.doa || null,
    admissionDuration: formatCompactDuration(student.doa),
    gender: student.gender || "-",
    courses: (student.courses || []).map((course) => course?.name).filter(Boolean).join(", ") || "-",
    status: student.active || "-",
    hostel: student.hostel || "No",
    feesStatus: Number(student.feesPaid) === 1 ? "Paid" : "Unpaid",
    address: student.address || "-",
    city: student.city || "-",
  };

  // Preserve the historical summary payload for Guest users. The expanded
  // Student profile fields below contain family/contact and other personal
  // data, so they are returned only to authenticated operational report roles.
  if (!includeSensitive) return row;

  return {
    ...row,
    email: student.userId?.email || "-",
    oldRollNumber: student.oldRollNumber || "-",
    maritalStatus: student.maritalStatus || "-",
    motherTongue: student.motherTongue || "-",
    bloodGroup: student.bloodGroup || "-",
    identificationMark1: student.idMark1 || "-",
    identificationMark2: student.idMark2 || "-",
    about: student.about || "-",
    fatherName: student.fatherName || "-",
    fatherNumber: student.fatherNumber ?? "-",
    fatherOccupation: student.fatherOccupation || "-",
    motherName: student.motherName || "-",
    motherNumber: student.motherNumber ?? "-",
    motherOccupation: student.motherOccupation || "-",
    guardianName: student.guardianName || "-",
    guardianNumber: student.guardianNumber ?? "-",
    guardianOccupation: student.guardianOccupation || "-",
    guardianRelation: student.guardianRelation || "-",
    landmark: student.landmark || "-",
    pincode: student.pincode ?? "-",
    district: student.districtStateId?.district || "-",
    state: student.districtStateId?.state || "-",
    hostelRefNumber: student.hostelRefNumber || "-",
    hostelFees: Number(student.hostelFees || 0),
    hostelDiscount: Number(student.hostelDiscount || 0),
    hostelFinalFees: Number(student.hostelFinalFees || 0),
    remarks: student.remarks || "-",
  };
};

async function getStudentRows(req, { exportAll = false } = {}) {
  const payload = getAuthPayload(req);
  if (!payload) return { success: false, status: 401, error: "Unauthorized" };
  const match = await buildStudentReportMatch(req, payload);
  const { page, limit, skip } = getPagination(req);
  const normalizedRole = String(payload.role || "").toLowerCase();
  const includeSensitive = ["superadmin", "hquser", "supervisor", "admin"].includes(normalizedRole);

  const query = Student.find(match)
    .select(
      "rollNumber oldRollNumber userId schoolId dob doa gender maritalStatus motherTongue bloodGroup " +
      "idMark1 idMark2 about fatherName fatherNumber fatherOccupation motherName motherNumber motherOccupation " +
      "guardianName guardianNumber guardianOccupation guardianRelation address city landmark pincode districtStateId " +
      "courses active hostel hostelRefNumber hostelFees hostelDiscount hostelFinalFees feesPaid remarks"
    )
    .populate({ path: "userId", select: "name email" })
    .populate({ path: "schoolId", select: "code nameEnglish" })
    .populate({ path: "districtStateId", select: "district state" })
    .populate({ path: "courses", select: "name code type" })
    .sort({ schoolId: 1, rollNumber: 1 });

  if (!exportAll) query.skip(skip).limit(limit);
  const [records, total] = await Promise.all([query.lean(), Student.countDocuments(match)]);
  return {
    success: true,
    rows: records.map((student) => mapStudentRow(student, { includeSensitive })),
    canViewSensitive: includeSensitive,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  };
}

async function resolvePersonSearchIds(search, roles = null) {
  const value = safeStr(search);
  if (!value) return null;
  const regex = new RegExp(escapeRegex(value), "i");
  const query = { $or: [{ name: regex }, { email: regex }] };
  if (Array.isArray(roles) && roles.length) query.role = { $in: roles };
  return User.distinct("_id", query);
}

async function getEmployeeRows(req, { exportAll = false } = {}) {
  const payload = getAuthPayload(req);
  if (!payload) return { success: false, status: 401, error: "Unauthorized" };
  const role = String(payload.role || "").toLowerCase();
  const userId = payload.id || payload._id || payload.userId;
  const allowedSchoolIds = await getAccessibleSchoolIds({ role, schoolId: payload.schoolId, userId });
  const resolvedSchoolIds = await resolveSchoolScope({
    allowedSchoolIds,
    schoolId: safeStr(req.query.schoolId),
    schoolCode: safeStr(req.query.schoolCode),
    schoolSearch: safeStr(req.query.schoolSearch),
  });

  const match = schoolMatch(resolvedSchoolIds);
  const status = safeStr(req.query.status);
  if (status) match.active = status;

  const search = safeStr(req.query.search);
  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    const userIds = await resolvePersonSearchIds(search);
    match.$or = [{ employeeId: regex }, ...(Array.isArray(userIds) && userIds.length ? [{ userId: { $in: userIds } }] : [])];
  }

  const roleFilter = safeStr(req.query.role);
  if (roleFilter) {
    const userIds = await User.distinct("_id", { role: roleFilter.toLowerCase() });
    match.userId = { $in: userIds };
  }

  const { page, limit, skip } = getPagination(req);
  const query = Employee.find(match)
    .select("employeeId userId schoolId contactNumber fatherGuardianName dob doj gender maritalStatus qualification salary travellingAllowance otherDesignation activitiesCarriedOut bankAccountDetails active remarks")
    .populate({ path: "userId", select: "name email role" })
    .populate({ path: "schoolId", select: "code nameEnglish" })
    .sort({ employeeId: 1 });
  if (!exportAll) query.skip(skip).limit(limit);

  const [records, total] = await Promise.all([query.lean(), Employee.countDocuments(match)]);
  const sensitive = canViewSensitive(role);
  const rows = records.map((employee) => ({
    _id: employee._id,
    employeeId: employee.employeeId || "-",
    name: employee.userId?.name || "-",
    email: employee.userId?.email || "-",
    role: employee.userId?.role || "-",
    schoolCode: employee.schoolId?.code || "-",
    schoolName: employee.schoolId?.nameEnglish || "-",
    contactNumber: employee.contactNumber || "-",
    fatherGuardianName: employee.fatherGuardianName || "-",
    dob: employee.dob || null,
    age: formatCompactDuration(employee.dob),
    doj: employee.doj || null,
    workingExperience: formatCompactDuration(employee.doj),
    gender: employee.gender || "-",
    maritalStatus: employee.maritalStatus || "-",
    qualification: employee.qualification || "-",
    hadhiya: sensitive ? Number(employee.salary || 0) : null,
    travellingAllowance: sensitive ? Number(employee.travellingAllowance || 0) : null,
    otherDesignation: employee.otherDesignation || "-",
    activitiesCarriedOut: employee.activitiesCarriedOut || "-",
    bankAccountDetails: sensitive ? employee.bankAccountDetails || "-" : null,
    status: employee.active || "-",
    remarks: employee.remarks || "-",
  }));

  return {
    success: true,
    rows,
    canViewSensitive: sensitive,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  };
}

async function getAllowedSupervisorIds(payload) {
  const role = String(payload.role || "").toLowerCase();
  const userId = payload.id || payload._id || payload.userId;
  if (role === "superadmin" || role === "hquser") return null;

  if (role === "supervisor") {
    const supervisor = await Supervisor.findOne({ userId }).select("_id").lean();
    return supervisor?._id ? [String(supervisor._id)] : [];
  }

  const allowedSchoolIds = await getAccessibleSchoolIds({ role, schoolId: payload.schoolId, userId });
  if (!Array.isArray(allowedSchoolIds) || !allowedSchoolIds.length) return [];
  const supervisorIds = await School.distinct("supervisorId", { _id: { $in: allowedSchoolIds.map(oid) } });
  return supervisorIds.map((id) => String(id));
}

async function attachSupervisorCounts(supervisors) {
  const supervisorIds = supervisors.map((item) => item._id);
  if (!supervisorIds.length) return supervisors.map((item) => ({ ...item, niswansCount: 0, employeesCount: 0, studentsCount: 0 }));

  const schools = await School.find({ supervisorId: { $in: supervisorIds } }).select("_id supervisorId").lean();
  const schoolIds = schools.map((school) => school._id);
  const schoolToSupervisor = new Map(schools.map((school) => [String(school._id), String(school.supervisorId)]));

  const [employeeGroups, studentGroups] = await Promise.all([
    schoolIds.length
      ? Employee.aggregate([{ $match: { schoolId: { $in: schoolIds }, active: "Active" } }, { $group: { _id: "$schoolId", count: { $sum: 1 } } }])
      : [],
    schoolIds.length
      ? Student.aggregate([{ $match: { schoolId: { $in: schoolIds }, active: "Active" } }, { $group: { _id: "$schoolId", count: { $sum: 1 } } }])
      : [],
  ]);

  const counts = new Map(supervisorIds.map((id) => [String(id), { niswansCount: 0, employeesCount: 0, studentsCount: 0 }]));
  for (const school of schools) {
    const key = String(school.supervisorId);
    const entry = counts.get(key);
    if (entry) entry.niswansCount += 1;
  }
  for (const group of employeeGroups) {
    const key = schoolToSupervisor.get(String(group._id));
    const entry = counts.get(key);
    if (entry) entry.employeesCount += Number(group.count || 0);
  }
  for (const group of studentGroups) {
    const key = schoolToSupervisor.get(String(group._id));
    const entry = counts.get(key);
    if (entry) entry.studentsCount += Number(group.count || 0);
  }

  return supervisors.map((item) => ({ ...item, ...(counts.get(String(item._id)) || {}) }));
}

async function getSupervisorRows(req, { exportAll = false } = {}) {
  const payload = getAuthPayload(req);
  if (!payload) return { success: false, status: 401, error: "Unauthorized" };
  const role = String(payload.role || "").toLowerCase();
  const allowedSupervisorIds = await getAllowedSupervisorIds(payload);
  const match = {};
  if (allowedSupervisorIds !== null) match._id = { $in: allowedSupervisorIds.map(oid) };

  const status = safeStr(req.query.status);
  const jobType = safeStr(req.query.jobType);
  if (status) match.active = status;
  if (jobType) match.jobType = jobType;

  const search = safeStr(req.query.search);
  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    const userIds = await resolvePersonSearchIds(search, ["supervisor"]);
    match.$or = [{ supervisorId: regex }, ...(Array.isArray(userIds) && userIds.length ? [{ userId: { $in: userIds } }] : [])];
  }

  const { page, limit, skip } = getPagination(req);
  const query = Supervisor.find(match)
    .select("supervisorId userId contactNumber address routeName qualification fatherGuardianName dob doj gender maritalStatus salary travellingAllowance otherDesignation activitiesCarriedOut bankAccountDetails jobType active remarks")
    .populate({ path: "userId", select: "name email role" })
    .sort({ supervisorId: 1 });
  if (!exportAll) query.skip(skip).limit(limit);

  const [records, total] = await Promise.all([query.lean(), Supervisor.countDocuments(match)]);
  const recordsWithCounts = await attachSupervisorCounts(records);
  const sensitive = canViewSensitive(role);
  const rows = recordsWithCounts.map((supervisor) => ({
    _id: supervisor._id,
    supervisorId: supervisor.supervisorId || "-",
    name: supervisor.userId?.name || "-",
    email: supervisor.userId?.email || "-",
    contactNumber: supervisor.contactNumber || "-",
    fatherGuardianName: supervisor.fatherGuardianName || "-",
    dob: supervisor.dob || null,
    age: formatCompactDuration(supervisor.dob),
    doj: supervisor.doj || null,
    workingExperience: formatCompactDuration(supervisor.doj),
    gender: supervisor.gender || "-",
    maritalStatus: supervisor.maritalStatus || "-",
    routeName: supervisor.routeName || "-",
    qualification: supervisor.qualification || "-",
    jobType: supervisor.jobType || "-",
    hadhiya: sensitive ? Number(supervisor.salary || 0) : null,
    travellingAllowance: sensitive ? Number(supervisor.travellingAllowance || 0) : null,
    otherDesignation: supervisor.otherDesignation || "-",
    activitiesCarriedOut: supervisor.activitiesCarriedOut || "-",
    bankAccountDetails: sensitive ? supervisor.bankAccountDetails || "-" : null,
    niswansCount: Number(supervisor.niswansCount || 0),
    employeesCount: Number(supervisor.employeesCount || 0),
    studentsCount: Number(supervisor.studentsCount || 0),
    status: supervisor.active || "-",
    remarks: supervisor.remarks || "-",
  }));

  return {
    success: true,
    rows,
    canViewSensitive: sensitive,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  };
}

const sendRowsExport = (res, format, filename, rows, sheetName) => {
  const safeFormat = String(format || "xlsx").toLowerCase();
  if (safeFormat === "csv") return sendCSV(res, filename, rows, Object.keys(rows[0] || {}));
  return sendXLSX(res, filename, rows, sheetName);
};

const flattenStudentExport = (row, sensitive) => ({
  "Roll Number": row.rollNumber,
  ...(sensitive ? { "Old Roll Number": row.oldRollNumber } : {}),
  "Student Name": row.name,
  ...(sensitive ? { Email: row.email } : {}),
  "Niswan Code": row.schoolCode,
  Niswan: row.schoolName,
  "Date of Birth": formatDate(row.dob),
  Age: row.age,
  "Admission Date": formatDate(row.admissionDate),
  "Admission Duration": row.admissionDuration,
  Gender: row.gender,
  ...(sensitive ? {
    "Marital Status": row.maritalStatus,
    "Mother Tongue": row.motherTongue,
    "Blood Group": row.bloodGroup,
    "Identification Mark-1": row.identificationMark1,
    "Identification Mark-2": row.identificationMark2,
    "More details about the Student": row.about,
    "Father's Name": row.fatherName,
    "Father's Number": row.fatherNumber,
    "Father's Occupation": row.fatherOccupation,
    "Mother's Name": row.motherName,
    "Mother's Number": row.motherNumber,
    "Mother's Occupation": row.motherOccupation,
    "Guardian's Name": row.guardianName,
    "Guardian's Number": row.guardianNumber,
    "Guardian's Occupation": row.guardianOccupation,
    "Guardian's Relationship": row.guardianRelation,
  } : {}),
  Course: row.courses,
  Status: row.status,
  Hostel: row.hostel,
  "Fees Status": row.feesStatus,
  Address: row.address,
  City: row.city,
  ...(sensitive ? {
    Landmark: row.landmark,
    Pincode: row.pincode,
    District: row.district,
    State: row.state,
    "Hostel Reference": row.hostelRefNumber,
    "Hostel Monthly Fees": row.hostelFees,
    "Hostel Discount": row.hostelDiscount,
    "Hostel Final Fees": row.hostelFinalFees,
    Remarks: row.remarks,
  } : {}),
});

const flattenEmployeeExport = (row, sensitive) => ({
  "Employee ID": row.employeeId,
  Name: row.name,
  Email: row.email,
  Role: row.role,
  "Niswan Code": row.schoolCode,
  Niswan: row.schoolName,
  "Contact Number": row.contactNumber,
  "Father / Guardian Name": row.fatherGuardianName,
  "Date of Birth": formatDate(row.dob),
  Age: row.age,
  "Date of Joining": formatDate(row.doj),
  "Working Experience": row.workingExperience,
  Gender: row.gender,
  "Marital Status": row.maritalStatus,
  Qualification: row.qualification,
  ...(sensitive ? { Hadhiya: row.hadhiya, "Travelling Allowance": row.travellingAllowance } : {}),
  "Other Designation": row.otherDesignation,
  "Activities carried out": row.activitiesCarriedOut,
  ...(sensitive ? { "Bank account details": row.bankAccountDetails } : {}),
  Status: row.status,
  Remarks: row.remarks,
});

const flattenSupervisorExport = (row, sensitive) => ({
  "Supervisor ID": row.supervisorId,
  Name: row.name,
  Email: row.email,
  "Contact Number": row.contactNumber,
  "Father / Guardian Name": row.fatherGuardianName,
  "Date of Birth": formatDate(row.dob),
  Age: row.age,
  "Date of Joining": formatDate(row.doj),
  "Working Experience": row.workingExperience,
  Gender: row.gender,
  "Marital Status": row.maritalStatus,
  Route: row.routeName,
  Qualification: row.qualification,
  "Job Type": row.jobType,
  ...(sensitive ? { Hadhiya: row.hadhiya, "Travelling Allowance": row.travellingAllowance } : {}),
  "Other Designation": row.otherDesignation,
  "Activities carried out": row.activitiesCarriedOut,
  ...(sensitive ? { "Bank account details": row.bankAccountDetails } : {}),
  Niswans: row.niswansCount,
  Employees: row.employeesCount,
  Students: row.studentsCount,
  Status: row.status,
  Remarks: row.remarks,
});

export const getStudentDetailReport = async (req, res) => {
  try {
    const data = await getStudentRows(req);
    if (!data.success) return res.status(data.status || 500).json(data);
    return res.status(200).json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: "Student report server error" });
  }
};

export const exportStudentDetailReport = async (req, res) => {
  try {
    const data = await getStudentRows(req, { exportAll: true });
    if (!data.success) return res.status(data.status || 500).json(data);
    return sendRowsExport(res, req.query.format, `Students_Report_${Date.now()}`, data.rows.map((row) => flattenStudentExport(row, data.canViewSensitive)), "Students");
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: "Student report export error" });
  }
};

export const getEmployeeDetailReport = async (req, res) => {
  try {
    const data = await getEmployeeRows(req);
    if (!data.success) return res.status(data.status || 500).json(data);
    return res.status(200).json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: "Employee report server error" });
  }
};

export const exportEmployeeDetailReport = async (req, res) => {
  try {
    const data = await getEmployeeRows(req, { exportAll: true });
    if (!data.success) return res.status(data.status || 500).json(data);
    return sendRowsExport(res, req.query.format, `Employees_Report_${Date.now()}`, data.rows.map((row) => flattenEmployeeExport(row, data.canViewSensitive)), "Employees");
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: "Employee report export error" });
  }
};

export const getSupervisorDetailReport = async (req, res) => {
  try {
    const data = await getSupervisorRows(req);
    if (!data.success) return res.status(data.status || 500).json(data);
    return res.status(200).json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: "Supervisor report server error" });
  }
};

export const exportSupervisorDetailReport = async (req, res) => {
  try {
    const data = await getSupervisorRows(req, { exportAll: true });
    if (!data.success) return res.status(data.status || 500).json(data);
    return sendRowsExport(res, req.query.format, `Supervisors_Report_${Date.now()}`, data.rows.map((row) => flattenSupervisorExport(row, data.canViewSensitive)), "Supervisors");
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, error: "Supervisor report export error" });
  }
};
