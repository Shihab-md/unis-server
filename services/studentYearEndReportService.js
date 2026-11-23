import mongoose from "mongoose";
import School from "../models/School.js";
import Supervisor from "../models/Supervisor.js";
import Student from "../models/Student.js";
import Course from "../models/Course.js";
import AcademicYear from "../models/AcademicYear.js";
import Academic from "../models/Academic.js";
import FeeInvoice from "../models/FeeInvoice.js";
import AuditLog from "../models/AuditLog.js";
import { getNiswanSchoolFilter } from "../config/organizationPolicy.js";
import { buildYearEndData, filterYearEndData, confirmedNextYearAdmissions, textId } from "../utils/studentYearEndPolicy.js";

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const academicFields = "studentId acYear createdAt " + Array.from({ length: 5 }, (_, i) => `instituteId${i + 1} courseId${i + 1} year${i + 1} status${i + 1}`).join(" ");
const allowedKeys = new Set(["schoolId", "supervisorId", "courseId", "status", "decision", "page", "limit"]);
const optionalId = (value, label) => {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || !/^[a-fA-F0-9]{24}$/.test(value)) throw fail(400, "INVALID_FILTER", `Invalid ${label}`);
  return new mongoose.Types.ObjectId(value).toString();
};
export function parseYearEndFilters(query = {}) {
  for (const key of Object.keys(query)) if (!allowedKeys.has(key))
    throw fail(400, "INVALID_FILTER", "This report uses only the current Active academic year. Unsupported filter.");
  const status = query.status || "", decision = query.decision || "";
  if (typeof status !== "string" || !["", "DONE", "PENDING", "NEEDS_REVIEW", "NO_STUDENTS"].includes(status)) throw fail(400, "INVALID_FILTER", "Invalid report status");
  if (typeof decision !== "string" || !["", "PROMOTED", "NOT_PROMOTED", "COMPLETED", "PENDING", "NEEDS_REVIEW", "UNRESOLVED"].includes(decision)) throw fail(400, "INVALID_FILTER", "Invalid decision filter");
  const integer = (value, fallback, max) => {
    if (value === undefined || value === "") return fallback;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || Number(value) > max) throw fail(400, "INVALID_FILTER", "Invalid page or limit");
    return Number(value);
  };
  return { schoolId: optionalId(query.schoolId, "Niswan"), supervisorId: optionalId(query.supervisorId, "Supervisor"),
    courseId: optionalId(query.courseId, "Course"), status, decision, page: integer(query.page, 1, 1000000), limit: integer(query.limit, 50, 200) };
}

export async function getStudentYearEndReport(query = {}) {
  const filters = parseYearEndFilters(query);
  // Never trust browser/localStorage/Redis academic-year values for this report.
  const activeYears = await AcademicYear.find({ active: "Active" }).select("_id acYear").limit(2).lean();
  if (activeYears.length !== 1) throw fail(409, "ACTIVE_YEAR_CONFIGURATION", "Exactly one Active academic year must be configured.");
  const current = activeYears[0];
  const yearParts = /^(\d{4})-(\d{4})$/.exec(String(current.acYear || ""));
  if (!yearParts || Number(yearParts[2]) !== Number(yearParts[1]) + 1)
    throw fail(409, "ACADEMIC_YEAR_FORMAT", "The Active academic year must use the format YYYY-YYYY with consecutive years.");
  const targetLabel = `${yearParts[2]}-${Number(yearParts[2]) + 1}`;
  const [target, schools, courses, sourceAcademics] = await Promise.all([
    AcademicYear.findOne({ acYear: targetLabel }).select("_id acYear active").lean(),
    School.find(getNiswanSchoolFilter()).select("code nameEnglish active supervisorId incharge1Number contactNumber")
      .populate({ path: "supervisorId", select: "supervisorId userId", populate: { path: "userId", select: "name" } }).sort({ code: 1 }).lean(),
    Course.find({}).select("name type years promotionOrder").sort({ type: 1, name: 1 }).lean(),
    Academic.find({ acYear: current._id }).select(academicFields).lean(),
  ]);
  const schoolIds = schools.map((school) => school._id);
  const sourceIds = [...new Set(sourceAcademics.map((doc) => textId(doc.studentId)).filter(Boolean))];
  const [students, targetAcademics] = await Promise.all([
    Student.find({ $or: [{ _id: { $in: sourceIds } }, { schoolId: { $in: schoolIds }, active: "Active" }] })
      .select("userId schoolId rollNumber feesPaid active createdAt").populate({ path: "userId", select: "name" }).lean(),
    target ? Academic.find({ acYear: target._id }).select(academicFields).lean() : [],
  ]);
  const currentStudentIds = new Set(sourceIds);
  const targetStudentIds = new Set(targetAcademics.map((academic) => textId(academic.studentId)));
  const niswanIds = new Set(schoolIds.map(textId));
  const admissionCandidates = students.filter((student) => student.active === "Active" && niswanIds.has(textId(student.schoolId)) &&
    !currentStudentIds.has(textId(student._id)) && targetStudentIds.has(textId(student._id)));
  const candidateIds = admissionCandidates.map((student) => student._id);
  const [otherAcademicStudentIds, candidateInvoices, creationAudits] = candidateIds.length ? await Promise.all([
    Academic.distinct("studentId", { studentId: { $in: candidateIds }, acYear: { $ne: target._id } }),
    FeeInvoice.find({ studentId: { $in: candidateIds } }).select("studentId acYear schoolId academicId courseId source status").lean(),
    AuditLog.find({ action: "STUDENT_CREATE", resourceType: "Student", resourceId: { $in: candidateIds.map(textId) }, success: true })
      .select("action resourceType resourceId schoolId success createdAt").lean(),
  ]) : [[], [], []];
  const confirmedAdmissions = confirmedNextYearAdmissions({ students: admissionCandidates, schools, sourceAcademics, targetAcademics,
    targetYearId: target?._id, otherAcademicStudentIds: new Set(otherAcademicStudentIds.map(textId)), invoices: candidateInvoices, creationAudits });
  const studentIds = students.map((student) => student._id);
  const pendingIds = studentIds.length ? await FeeInvoice.distinct("studentId", {
    studentId: { $in: studentIds }, status: { $in: ["ISSUED", "PARTIAL"] },
  }) : [];
  // An explicitly excluded HQ organization is not an unassigned Niswan student.
  const knownNiswanIds = new Set(schoolIds.map(textId));
  const outOfScopeStudentIds = new Set(students.filter((student) => !knownNiswanIds.has(textId(student.schoolId))).map((student) => textId(student._id)));
  // Distinguish deliberately excluded HQ records from broken school references.
  const excludedSchools = outOfScopeStudentIds.size ? await School.find({ recordType: "LEGACY_HQ" }).select("_id").lean() : [];
  const excludedSchoolIds = new Set(excludedSchools.map((school) => textId(school._id)));
  const excludedStudentIds = new Set(students.filter((student) => excludedSchoolIds.has(textId(student.schoolId))).map((student) => textId(student._id)));
  const data = buildYearEndData({ schools, courses, students,
    sourceAcademics: sourceAcademics.filter((doc) => !excludedStudentIds.has(textId(doc.studentId))), targetAcademics,
    pendingFeeStudentIds: new Set(pendingIds.map(textId)), targetYearExists: Boolean(target),
    confirmedNextYearAdmissionIds: new Set(confirmedAdmissions.map((admission) => admission.studentId)) });
  const global = filterYearEndData(data);
  const filtered = filterYearEndData(data, filters);
  const activeCheck = await AcademicYear.find({ active: "Active" }).select("_id").limit(2).lean();
  if (activeCheck.length !== 1 || textId(activeCheck[0]._id) !== textId(current._id))
    throw fail(409, "ACTIVE_YEAR_CHANGED", "The Active academic year changed. Please refresh the report.");
  const exclusionCounts = (entries) => ({ statusExcludedStudents: new Set(entries.map((entry) => entry.studentId)).size, statusExcludedEntries: entries.length });
  const excludedByStatus = data.excludedByStatus.filter((entry) =>
    (!filters.schoolId || entry.schoolId === filters.schoolId) && (!filters.supervisorId || entry.supervisorId === filters.supervisorId) &&
    (!filters.courseId || entry.courseId === filters.courseId));
  const globalSummary = { ...global.summary, ...exclusionCounts(data.excludedByStatus), unassignedStudentCount: data.unassignedStudentCount, nextYearAdmissionsExcluded: confirmedAdmissions.length,
    ready: Boolean(target) && global.summary.totalStudents > 0 && data.unassignedStudentCount === 0 && global.summary.pendingStudents === 0 };
  const optionSchoolIds = new Set([...data.schoolRows.map((row) => row.schoolId), ...data.excludedByStatus.map((entry) => entry.schoolId), ...confirmedAdmissions.map((admission) => admission.schoolId)]);
  const optionSchools = schools.map((school) => ({ schoolId: textId(school._id), code: school.code || "", name: school.nameEnglish || "",
    supervisorId: textId(school.supervisorId), supervisorName: school.supervisorId?.userId?.name || "", supervisorCode: school.supervisorId?.supervisorId || "" }))
    .filter((school) => optionSchoolIds.has(school.schoolId));
  const supervisorOptions = [...new Map(optionSchools.filter((row) => row.supervisorId)
    .map((row) => [row.supervisorId, { _id: row.supervisorId, name: row.supervisorName, code: row.supervisorCode }])).values()];
  const excludedNextYearAdmissions = confirmedAdmissions.filter((admission) =>
    (!filters.schoolId || admission.schoolId === filters.schoolId) && (!filters.supervisorId || admission.supervisorId === filters.supervisorId) &&
    (!filters.courseId || admission.courseIds.includes(filters.courseId)));
  return { version: 1, generatedAt: new Date().toISOString(), academicYear: { _id: textId(current._id), label: current.acYear },
    nextAcademicYear: { _id: target ? textId(target._id) : "", label: targetLabel, configured: Boolean(target) },
    filters, globalSummary, summary: { ...filtered.summary, ...exclusionCounts(excludedByStatus), nextYearAdmissionsExcluded: excludedNextYearAdmissions.length },
    rows: filtered.rows, entries: filtered.entries, excludedNextYearAdmissions, excludedByStatus,
    unassignedRecords: data.unassignedRecords,
    warnings: [...(global.summary.totalStudents === 0 ? ["NO_REPORT_STUDENTS"] : []), ...(!target ? ["NEXT_YEAR_MISSING"] : []), ...(data.unassignedStudentCount ? ["UNASSIGNED_STUDENTS"] : [])],
    meta: { schools: optionSchools.map((row) => ({ _id: row.schoolId, code: row.code, name: row.name })),
      supervisors: supervisorOptions, courses: courses.map((course) => ({ _id: textId(course._id), name: course.name, type: course.type })) } };
}

export function yearEndStudentDetails(report) {
  const decision = report.filters.decision;
  const entries = report.entries.filter((entry) => !decision || (decision === "UNRESOLVED"
    ? ["PENDING", "NEEDS_REVIEW"].includes(entry.decision) : entry.decision === decision));
  // Explicit ordering keeps pagination/export stable when MongoDB changes read order.
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  entries.sort((left, right) => {
    for (const field of ["schoolCode", "rollNumber", "studentName", "studentId", "courseId"]) {
      const result = collator.compare(String(left[field] || ""), String(right[field] || ""));
      if (result) return result;
    }
    return 0;
  });
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.courseId || "MISSING";
    if (!groups.has(key)) groups.set(key, { courseId: entry.courseId, courseName: entry.courseName, entries: 0,
      promoted: 0, notPromoted: 0, completed: 0, pending: 0, needsReview: 0 });
    const group = groups.get(key); group.entries++;
    group[{ PROMOTED: "promoted", NOT_PROMOTED: "notPromoted", COMPLETED: "completed", PENDING: "pending", NEEDS_REVIEW: "needsReview" }[entry.decision]]++;
  }
  return { entries, courses: [...groups.values()] };
}
