import { schoolCourseProgression, schoolCourseInstitutes, schoolCourseFamily, sameSchoolInstitute } from "./schoolCourseReportPolicy.js";
// Reporting only: never changes Academic, Student, fees or promotion decisions.
export const textId = (value) => String(value?._id ?? value ?? "");
export const normalizeYearEndDecision = (value) => String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
export const DECISIONS = Object.freeze({ PROMOTED: "PROMOTED", NOT_PROMOTED: "NOT_PROMOTED", COMPLETED: "COMPLETED", PENDING: "PENDING", NEEDS_REVIEW: "NEEDS_REVIEW" });
const finished = new Set([DECISIONS.PROMOTED, DECISIONS.NOT_PROMOTED, DECISIONS.COMPLETED]);
const storedStudyYear = (value) => {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return null;
  if (typeof value !== "number" && typeof value !== "string") return NaN;
  return Number(value);
};
const slots = (academic) => Array.from({ length: 5 }, (_, i) => i + 1)
  .filter((slot) => academic?.[`courseId${slot}`])
  .map((slot) => ({ academicId: textId(academic._id), courseId: textId(academic[`courseId${slot}`]),
    instituteId: textId(academic[`instituteId${slot}`]), slot, year: storedStudyYear(academic[`year${slot}`]), status: academic[`status${slot}`] || "" }));

export function courseProgression(course, courses, context = {}) {
  if (!course) return { error: "COURSE_MISSING", isFinalYear: null };
  if (course.type === "School Education") return schoolCourseProgression(course, courses, context);
  const makthab = /Makthab_Level([1-4])/.exec(String(course.name || ""));
  const duration = makthab ? Number(makthab[1]) * 3 : Number(course.years || 0);
  if (!Number.isInteger(duration) || duration <= 0) return { error: "COURSE_DURATION_INVALID", isFinalYear: null };
  return { duration, nextCourseId: textId(course._id), allowZeroYear: Boolean(makthab && Number(makthab[1]) === 1) };
}

function classifyEntry(source, targetSlots, course, courses, duplicateSource, context) {
  const progression = courseProgression(course, courses, { ...context, source, targetSlots });
  // Makthab Level1 explicitly allows Year 0. Keep it distinct from a missing year.
  const sourceYear = progression.sourceYear ?? (
    progression.allowZeroYear && source.year === 0 ? 0 :
      (source.year === null || source.year === 0) && progression.duration === 1 ? 1 : source.year
  );
  const isFinalYear = progression.error ? null : progression.isFinalYear ?? (Number.isInteger(sourceYear) && sourceYear >= 0 ? sourceYear >= progression.duration : null);
  const base = { courseId: source.courseId, courseName: course?.name || "", courseType: course?.type || "",
    sourceAcademicId: source.academicId, sourceSlot: source.slot, sourceYear: Number.isFinite(sourceYear) ? sourceYear : null, sourceStatus: source.status,
    isFinalYear, targetAcademicId: "", targetCourseName: "", targetYear: null };
  const outcome = (decision, reasonCode = "", extra = {}) => ({ ...base, decision, reasonCode, ...extra });
  if (duplicateSource) return outcome(DECISIONS.NEEDS_REVIEW, "SOURCE_DUPLICATE");
  if (progression.error && !Number.isFinite(progression.sourceYear)) return outcome(DECISIONS.NEEDS_REVIEW, progression.error);
  if (!Number.isInteger(sourceYear) || sourceYear < (progression.allowZeroYear ? 0 : 1)) return outcome(DECISIONS.NEEDS_REVIEW, "STUDY_YEAR_INVALID");
  const isSchool = course?.type === "School Education";
  const family = isSchool ? schoolCourseFamily(course) : null;
  const schoolTargets = isSchool ? targetSlots.filter((slot) => context.courseMap.get(slot.courseId)?.type === "School Education") : [];
  const compatiblePath = (slot) => sameSchoolInstitute(source, slot) &&
    (family === null || schoolCourseFamily(context.courseMap.get(slot.courseId)) === family);
  const explicitSchoolTargets = schoolTargets.filter((slot) => ["promoted", "notpromoted"].includes(normalizeYearEndDecision(slot.status)));
  if (isSchool && context.schoolSourceCount === 1 && explicitSchoolTargets.some((slot) => !compatiblePath(slot)))
    return outcome(DECISIONS.NEEDS_REVIEW, "SCHOOL_TARGET_PATH_CONFLICT");
  const possibleIds = new Set([source.courseId, progression.nextCourseId, ...(progression.nextCandidateIds || [])].filter(Boolean));
  const matches = targetSlots.filter((slot) => possibleIds.has(slot.courseId));
  // A verified repeat uses the same course/year; selecting a next course is irrelevant.
  if (isSchool && context.targetAcademicCount <= 1 && normalizeYearEndDecision(source.status) !== "completed" && matches.length === 1 &&
    matches[0].courseId === source.courseId && matches[0].year === sourceYear &&
    normalizeYearEndDecision(matches[0].status) === "notpromoted" && sameSchoolInstitute(source, matches[0]) &&
    !schoolTargets.some((slot) => slot !== matches[0] && compatiblePath(slot)))
    return outcome(DECISIONS.NOT_PROMOTED, "", { targetAcademicId: matches[0].academicId,
      targetCourseName: course.name, targetYear: matches[0].year });
  if (progression.error) return outcome(DECISIONS.NEEDS_REVIEW, progression.error);
  if (isSchool && matches.some((slot) => !sameSchoolInstitute(source, slot)))
    return outcome(DECISIONS.NEEDS_REVIEW, "SCHOOL_TARGET_PATH_CONFLICT");
  if (isSchool && context.schoolSourceCount === 1 && explicitSchoolTargets.some((slot) => !possibleIds.has(slot.courseId)))
    return outcome(DECISIONS.NEEDS_REVIEW, "SCHOOL_TARGET_PATH_CONFLICT");
  const sourceDecision = normalizeYearEndDecision(source.status);
  if (sourceDecision === "completed") {
    if (!isFinalYear) return outcome(DECISIONS.NEEDS_REVIEW, "NON_FINAL_COMPLETED");
    if (matches.length) return outcome(DECISIONS.NEEDS_REVIEW, "COMPLETION_TARGET_CONFLICT");
    return outcome(DECISIONS.COMPLETED);
  }
  if (matches.length > 1 || context.targetAcademicCount > 1) return outcome(DECISIONS.NEEDS_REVIEW, "TARGET_DUPLICATE");
  if (matches.length === 1) {
    const target = matches[0];
    const decision = normalizeYearEndDecision(target.status);
    const extra = { targetAcademicId: target.academicId, targetYear: Number.isFinite(target.year) ? target.year : null,
      targetCourseName: courses.find((item) => textId(item._id) === target.courseId)?.name || "" };
    if (decision === "notpromoted" && target.courseId === source.courseId && target.year === sourceYear)
      return outcome(DECISIONS.NOT_PROMOTED, "", extra);
    const nextYear = progression.nextYear || sourceYear + 1;
    if (decision === "promoted" && !isFinalYear && target.courseId === progression.nextCourseId && target.year === nextYear) {
      // One saved school target must not verify two overlapping source paths.
      if (isSchool && context.schoolSources.some((other) => other.courseId !== source.courseId && sameSchoolInstitute(source, other) &&
        Number(context.courseMap.get(other.courseId)?.promotionOrder) === sourceYear && schoolCourseFamily(context.courseMap.get(other.courseId)) === family))
        return outcome(DECISIONS.NEEDS_REVIEW, "SOURCE_DUPLICATE", extra);
      return outcome(DECISIONS.PROMOTED, "", extra);
    }
    return outcome(DECISIONS.NEEDS_REVIEW, ["admission", ""].includes(decision) ? "TARGET_DECISION_MISSING" : "TARGET_PROGRESSION_CONFLICT", extra);
  }
  if (!context.targetYearExists) return outcome(DECISIONS.NEEDS_REVIEW, "NEXT_YEAR_MISSING");
  if (Number(context.student.feesPaid || 0) !== 1) return outcome(DECISIONS.PENDING, "ADMISSION_FEES_INCOMPLETE");
  if (context.pendingFeeStudentIds.has(textId(context.student._id))) return outcome(DECISIONS.PENDING, "PENDING_FEE_INVOICE");
  return outcome(DECISIONS.PENDING, isFinalYear ? "FINAL_DECISION_PENDING" : "DECISION_PENDING");
}

const emptyCounts = () => ({ totalStudents: 0, processedStudents: 0, pendingStudents: 0, needsReviewStudents: 0,
  totalEntries: 0, promoted: 0, notPromoted: 0, completed: 0, pending: 0, needsReview: 0, finalYearPending: 0 });
const addEntry = (counts, entry) => {
  counts.totalEntries++;
  const field = { PROMOTED: "promoted", NOT_PROMOTED: "notPromoted", COMPLETED: "completed", PENDING: "pending", NEEDS_REVIEW: "needsReview" }[entry.decision];
  counts[field]++;
  if (entry.isFinalYear === true && !finished.has(entry.decision)) counts.finalYearPending++;
};
export function summarizeEntries(entries) {
  const result = emptyCounts();
  const byStudent = new Map();
  for (const entry of entries) {
    addEntry(result, entry);
    if (!byStudent.has(entry.studentId)) byStudent.set(entry.studentId, []);
    byStudent.get(entry.studentId).push(entry);
  }
  for (const studentEntries of byStudent.values()) {
    result.totalStudents++;
    if (studentEntries.every((entry) => finished.has(entry.decision))) result.processedStudents++;
    else result.pendingStudents++;
    if (studentEntries.some((entry) => entry.decision === DECISIONS.NEEDS_REVIEW)) result.needsReviewStudents++;
  }
  return result;
}
export const schoolProgressStatus = (counts) => !counts.totalStudents ? "NO_STUDENTS" : counts.needsReviewStudents ? "NEEDS_REVIEW" : counts.pendingStudents ? "PENDING" : "DONE";

const entriesBySchool = (entries) => {
  const grouped = new Map();
  for (const entry of entries) {
    if (!grouped.has(entry.schoolId)) grouped.set(entry.schoolId, []);
    grouped.get(entry.schoolId).push(entry);
  }
  return grouped;
};

// Positive admission evidence is required: a target-year Admission label alone
// is also produced by the legacy individual-promotion path.
export function confirmedNextYearAdmissions({ students, schools, sourceAcademics, targetAcademics,
  targetYearId, otherAcademicStudentIds = new Set(), invoices = [], creationAudits = [] }) {
  if (!targetYearId) return [];
  const sourceStudents = new Set(sourceAcademics.map((doc) => textId(doc.studentId)));
  const schoolMap = new Map(schools.map((school) => [textId(school._id), school]));
  const targets = new Map(), invoiceMap = new Map(), auditMap = new Map();
  const append = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
  for (const doc of targetAcademics) append(targets, textId(doc.studentId), doc);
  for (const invoice of invoices) append(invoiceMap, textId(invoice.studentId), invoice);
  for (const audit of creationAudits) append(auditMap, String(audit.resourceId || ""), audit);
  const time = (value) => value === undefined || value === null || value === "" ? NaN : new Date(value).getTime();
  const confirmed = [];
  for (const student of students) {
    const studentId = textId(student._id), schoolId = textId(student.schoolId), school = schoolMap.get(schoolId);
    if (!school || student.active !== "Active" || sourceStudents.has(studentId) || otherAcademicStudentIds.has(studentId)) continue;
    const records = targets.get(studentId) || [];
    if (records.length !== 1 || textId(records[0].acYear) !== textId(targetYearId)) continue;
    const academic = records[0], courseSlots = slots(academic);
    if (!courseSlots.length || courseSlots.some((entry) => normalizeYearEndDecision(entry.status) !== "admission") ||
      new Set(courseSlots.map((entry) => entry.courseId)).size !== courseSlots.length) continue;
    const studentInvoices = (invoiceMap.get(studentId) || []).filter((invoice) => String(invoice.status || "") !== "CANCELLED");
    if (studentInvoices.some((invoice) => textId(invoice.acYear) !== textId(targetYearId) &&
      ["ADMISSION", "PROMOTE", "COURSE_CHANGE", "CERTIFICATE"].includes(String(invoice.source || "")))) continue;
    const nextInvoices = studentInvoices.filter((invoice) => textId(invoice.acYear) === textId(targetYearId));
    if (nextInvoices.some((invoice) => ["PROMOTE", "COURSE_CHANGE"].includes(String(invoice.source || "")))) continue;
    const admissionInvoice = nextInvoices.find((invoice) => invoice.source === "ADMISSION" &&
      ["ISSUED", "PARTIAL", "PAID"].includes(invoice.status) && textId(invoice.schoolId) === schoolId && (textId(invoice.academicId) === textId(academic._id) ||
        (!textId(invoice.academicId) && courseSlots.some((entry) => entry.courseId === textId(invoice.courseId)))));
    const createdAt = time(student.createdAt), academicCreatedAt = time(academic.createdAt);
    const admissionAudit = (auditMap.get(studentId) || []).find((audit) => audit.action === "STUDENT_CREATE" && audit.resourceType === "Student" &&
      audit.success === true && textId(audit.schoolId) === schoolId && Number.isFinite(createdAt) && Number.isFinite(academicCreatedAt) &&
      createdAt <= academicCreatedAt && academicCreatedAt <= time(audit.createdAt));
    if (!admissionInvoice && !admissionAudit) continue;
    confirmed.push({ studentId, schoolId, schoolCode: school.code || "", schoolName: school.nameEnglish || "",
      supervisorId: textId(school.supervisorId), studentName: student.userId?.name || "",
      rollNumber: Number(student.feesPaid) === 1 ? student.rollNumber || "" : "-", academicId: textId(academic._id),
      courseIds: courseSlots.map((entry) => entry.courseId), courseYears: courseSlots.map((entry) => Number.isFinite(entry.year) ? entry.year : null), evidence: admissionInvoice ? "ADMISSION_INVOICE" : "STUDENT_CREATION_AUDIT" });
  }
  return confirmed;
}

export function buildYearEndData({ schools, students, sourceAcademics, targetAcademics, courses, pendingFeeStudentIds = new Set(), targetYearExists, confirmedNextYearAdmissionIds = new Set() }) {
  const schoolMap = new Map(schools.map((school) => [textId(school._id), school]));
  const studentMap = new Map(students.map((student) => [textId(student._id), student]));
  const courseMap = new Map(courses.map((course) => [textId(course._id), course]));
  const sourceMap = new Map(), targetMap = new Map();
  const group = (map, docs) => { for (const doc of docs) { const id = textId(doc.studentId); if (!map.has(id)) map.set(id, []); map.get(id).push(doc); } };
  group(sourceMap, sourceAcademics); group(targetMap, targetAcademics);
  let entries = [];
  const courseInstitutes = schoolCourseInstitutes([...sourceAcademics, ...targetAcademics]);
  const unassignedStudentIds = new Set(), unassignedRecords = [];
  for (const [studentId, academics] of sourceMap) {
    const student = studentMap.get(studentId);
    if (!student || !schoolMap.has(textId(student.schoolId))) {
      unassignedStudentIds.add(studentId);
      unassignedRecords.push({ studentId, studentName: student?.userId?.name || "", schoolId: textId(student?.schoolId),
        reasonCode: student ? "NISWAN_RECORD_MISSING" : "STUDENT_RECORD_MISSING" });
      continue;
    }
    const school = schoolMap.get(textId(student.schoolId));
    const sourceSlots = academics.flatMap(slots);
    const targets = (targetMap.get(studentId) || []).flatMap(slots);
    const duplicateCourses = new Set(sourceSlots.filter((entry, index) => sourceSlots.some((other, i) => i !== index && other.courseId === entry.courseId)).map((entry) => entry.courseId));
    const uniqueSlots = [...new Map(sourceSlots.map((entry) => [entry.courseId, entry])).values()];
    const schoolSources = uniqueSlots.filter((slot) => courseMap.get(slot.courseId)?.type === "School Education");
    const common = { studentId, studentName: student.userId?.name || "", rollNumber: Number(student.feesPaid) === 1 ? student.rollNumber || "" : "-",
      schoolId: textId(school._id), schoolCode: school.code || "", schoolName: school.nameEnglish || "", studentStatus: student.active || "", supervisorId: textId(school.supervisorId) };
    if (!uniqueSlots.length) entries.push({ ...common, courseId: "", courseName: "", decision: DECISIONS.NEEDS_REVIEW, reasonCode: "SOURCE_COURSES_MISSING", isFinalYear: null });
    for (const source of uniqueSlots) {
      const course = courseMap.get(source.courseId);
      const classification = classifyEntry(source, targets, course, courses, academics.length > 1 || duplicateCourses.has(source.courseId),
        { student, pendingFeeStudentIds, targetYearExists, targetAcademicCount: (targetMap.get(studentId) || []).length, courseMap, courseInstitutes,
          schoolSources, schoolSourceCount: schoolSources.length });
      entries.push({ ...common, ...classification });
    }
  }
  // Students visible to a Niswan must not disappear because they lack this year's record.
  for (const student of students) {
    const studentId = textId(student._id), school = schoolMap.get(textId(student.schoolId));
    if (!school || student.active !== "Active" || sourceMap.has(studentId)) continue;
    // Only confirmed new next-year admissions are outside the current cohort.
    if (confirmedNextYearAdmissionIds.has(studentId)) continue;
    const hasNextAdmission = (targetMap.get(studentId) || []).some((academic) =>
      slots(academic).some((entry) => normalizeYearEndDecision(entry.status) === "admission"));
    entries.push({ studentId, studentName: student.userId?.name || "", rollNumber: Number(student.feesPaid) === 1 ? student.rollNumber || "" : "-",
      schoolId: textId(school._id), schoolCode: school.code || "", schoolName: school.nameEnglish || "", studentStatus: student.active,
      courseId: "", courseName: "", decision: DECISIONS.NEEDS_REVIEW, reasonCode: hasNextAdmission ? "NEXT_ADMISSION_UNVERIFIED" : "SOURCE_ACADEMIC_MISSING", isFinalYear: null });
  }
  // Exclusion is separate from an academic decision. Keep all verified outcomes.
  const excludedStatuses = new Set(["inactive", "transferred", "discontinued", "graduated", "alumni"]);
  const excludedByStatus = entries.filter((entry) => excludedStatuses.has(normalizeYearEndDecision(entry.studentStatus)) && !finished.has(entry.decision));
  const excludedEntries = new Set(excludedByStatus);
  entries = entries.filter((entry) => !excludedEntries.has(entry));
  const schoolEntriesById = entriesBySchool(entries);
  const schoolRows = schools.map((school) => {
    const schoolEntries = schoolEntriesById.get(textId(school._id)) || [];
    const counts = summarizeEntries(schoolEntries);
    return { schoolId: textId(school._id), code: school.code || "", name: school.nameEnglish || "", active: school.active || "",
      supervisorId: textId(school.supervisorId), supervisorCode: school.supervisorId?.supervisorId || "",
      supervisorName: school.supervisorId?.userId?.name || "", contact: String(school.incharge1Number || school.contactNumber || ""),
      ...counts, status: schoolProgressStatus(counts) };
  }).filter((row) => row.totalStudents > 0);
  return { entries, schoolRows, excludedByStatus, unassignedRecords, unassignedStudentCount: unassignedStudentIds.size };
}

export function filterYearEndData(data, filters = {}) {
  const matchedSchools = new Set(data.schoolRows.filter((row) =>
    (!filters.schoolId || row.schoolId === filters.schoolId) && (!filters.supervisorId || row.supervisorId === filters.supervisorId)).map((row) => row.schoolId));
  let entries = data.entries.filter((entry) => matchedSchools.has(entry.schoolId) && (!filters.courseId || entry.courseId === filters.courseId));
  const scopedEntriesBySchool = entriesBySchool(entries);
  let rows = data.schoolRows.filter((row) => matchedSchools.has(row.schoolId)).map((row) => {
    const scoped = scopedEntriesBySchool.get(row.schoolId) || [];
    const counts = summarizeEntries(scoped);
    return { ...row, ...counts, status: schoolProgressStatus(counts), allCoursesStatus: row.status };
  }).filter((row) => row.totalStudents > 0);
  if (filters.status) rows = rows.filter((row) => row.status === filters.status);
  const allowed = new Set(rows.map((row) => row.schoolId));
  entries = entries.filter((entry) => allowed.has(entry.schoolId));
  const summary = summarizeEntries(entries);
  return { rows, entries, summary: { ...summary, totalNiswans: rows.length,
    doneNiswans: rows.filter((row) => row.status === "DONE").length,
    pendingNiswans: rows.filter((row) => row.status === "PENDING").length,
    needsReviewNiswans: rows.filter((row) => row.status === "NEEDS_REVIEW").length,
    noStudentNiswans: rows.filter((row) => row.status === "NO_STUDENTS").length } };
}

export const YEAR_END_REASON_TEXT = Object.freeze({
  STUDENT_RECORD_MISSING: "The academic record refers to a missing student.",
  NISWAN_RECORD_MISSING: "The student refers to a missing Niswan.",
  COURSE_MISSING: "Course details are missing.", COURSE_ORDER_INVALID: "School course progression is not configured.",
  SCHOOL_PATH_UNDEFINED: "The school-course path cannot be identified reliably from the recorded course and institute.",
  SCHOOL_NEXT_AMBIGUOUS: "More than one next course is configured within this school-course path.",
  SCHOOL_TARGET_PATH_CONFLICT: "The next-year school course or institute does not match this school-course path.",
  COURSE_ORDER_GAP: "A progression step is missing within this school-course path.", COURSE_DURATION_INVALID: "Course duration is not configured.",
  SOURCE_DUPLICATE: "More than one source academic record or course entry needs review.", STUDY_YEAR_INVALID: "The student's study year is missing or invalid.",
  NON_FINAL_COMPLETED: "A non-final course year is marked Completed.", COMPLETION_TARGET_CONFLICT: "A completed course also has a next-year entry.",
  TARGET_DUPLICATE: "More than one matching next-year course entry needs review.", TARGET_DECISION_MISSING: "A next-year record exists without an explicit promotion decision.",
  TARGET_PROGRESSION_CONFLICT: "The next-year decision does not match the course progression.", STUDENT_STATUS_REVIEW: "The student's current status needs review before closing the year.",
  NEXT_YEAR_MISSING: "The next academic year is not configured.", ADMISSION_FEES_INCOMPLETE: "The admission fees-paid flag is incomplete.",
  PENDING_FEE_INVOICE: "An unpaid fee invoice is blocking the decision.", FINAL_DECISION_PENDING: "The final-year completion or repeat decision is pending.",
  DECISION_PENDING: "The promotion or repeat decision is pending.", SOURCE_COURSES_MISSING: "The current academic record has no course entries.",
  SOURCE_ACADEMIC_MISSING: "The current academic-year record is missing.",
  NEXT_ADMISSION_UNVERIFIED: "The next-year record could not be confirmed as a new admission. Check the enrolment history.",
});
