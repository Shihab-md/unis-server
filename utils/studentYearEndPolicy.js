// Reporting only: never changes Academic, Student, fees or promotion decisions.
export const textId = (value) => String(value?._id ?? value ?? "");
export const normalizeYearEndDecision = (value) => String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
export const DECISIONS = Object.freeze({ PROMOTED: "PROMOTED", NOT_PROMOTED: "NOT_PROMOTED", COMPLETED: "COMPLETED", PENDING: "PENDING", NEEDS_REVIEW: "NEEDS_REVIEW" });
const finished = new Set([DECISIONS.PROMOTED, DECISIONS.NOT_PROMOTED, DECISIONS.COMPLETED]);
const slots = (academic) => Array.from({ length: 5 }, (_, i) => i + 1)
  .filter((slot) => academic?.[`courseId${slot}`])
  .map((slot) => ({ academicId: textId(academic._id), courseId: textId(academic[`courseId${slot}`]),
    slot, year: Number(academic[`year${slot}`] || 0), status: academic[`status${slot}`] || "" }));

export function courseProgression(course, courses) {
  if (!course) return { error: "COURSE_MISSING", isFinalYear: null };
  if (course.type === "School Education") {
    const order = Number(course.promotionOrder || 0);
    if (!Number.isInteger(order) || order <= 0) return { error: "COURSE_ORDER_INVALID", isFinalYear: null };
    const schoolCourses = courses.filter((item) => item.type === "School Education");
    if (schoolCourses.filter((item) => Number(item.promotionOrder) === order).length !== 1)
      return { error: "COURSE_ORDER_AMBIGUOUS", isFinalYear: null };
    const next = schoolCourses.filter((item) => Number(item.promotionOrder) === order + 1);
    if (next.length > 1 || (!next.length && schoolCourses.some((item) => Number(item.promotionOrder) > order)))
      return { error: "COURSE_ORDER_GAP", isFinalYear: null };
    return { sourceYear: order, nextYear: order + 1, nextCourseId: textId(next[0]?._id), isFinalYear: !next.length };
  }
  const makthab = /Makthab_Level([1-4])/.exec(String(course.name || ""));
  const duration = makthab ? Number(makthab[1]) * 3 : Number(course.years || 0);
  if (!Number.isInteger(duration) || duration <= 0) return { error: "COURSE_DURATION_INVALID", isFinalYear: null };
  return { duration, nextCourseId: textId(course._id) };
}

function classifyEntry(source, targetSlots, course, courses, duplicateSource, context) {
  const progression = courseProgression(course, courses);
  const sourceYear = progression.sourceYear || source.year || (progression.duration === 1 ? 1 : 0);
  const isFinalYear = progression.isFinalYear ?? (sourceYear > 0 ? sourceYear >= progression.duration : null);
  const base = { courseId: source.courseId, courseName: course?.name || "", courseType: course?.type || "",
    sourceAcademicId: source.academicId, sourceSlot: source.slot, sourceYear, sourceStatus: source.status,
    isFinalYear, targetAcademicId: "", targetCourseName: "", targetYear: null };
  const outcome = (decision, reasonCode = "", extra = {}) => ({ ...base, decision, reasonCode, ...extra });
  if (duplicateSource) return outcome(DECISIONS.NEEDS_REVIEW, "SOURCE_DUPLICATE");
  if (progression.error) return outcome(DECISIONS.NEEDS_REVIEW, progression.error);
  if (!Number.isInteger(sourceYear) || sourceYear < 1) return outcome(DECISIONS.NEEDS_REVIEW, "STUDY_YEAR_INVALID");
  const possibleIds = new Set([source.courseId, progression.nextCourseId].filter(Boolean));
  const matches = targetSlots.filter((slot) => possibleIds.has(slot.courseId));
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
    const extra = { targetAcademicId: target.academicId, targetYear: target.year,
      targetCourseName: courses.find((item) => textId(item._id) === target.courseId)?.name || "" };
    if (decision === "notpromoted" && target.courseId === source.courseId && target.year === sourceYear)
      return outcome(DECISIONS.NOT_PROMOTED, "", extra);
    const nextYear = progression.nextYear || sourceYear + 1;
    if (decision === "promoted" && !isFinalYear && target.courseId === progression.nextCourseId && target.year === nextYear)
      return outcome(DECISIONS.PROMOTED, "", extra);
    return outcome(DECISIONS.NEEDS_REVIEW, ["admission", ""].includes(decision) ? "TARGET_DECISION_MISSING" : "TARGET_PROGRESSION_CONFLICT", extra);
  }
  if (["Transferred", "In-Active", "Discontinued", "Graduated", "Alumni"].includes(String(context.student.active || "")))
    return outcome(DECISIONS.NEEDS_REVIEW, "STUDENT_STATUS_REVIEW");
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

export function buildYearEndData({ schools, students, sourceAcademics, targetAcademics, courses, pendingFeeStudentIds = new Set(), targetYearExists }) {
  const schoolMap = new Map(schools.map((school) => [textId(school._id), school]));
  const studentMap = new Map(students.map((student) => [textId(student._id), student]));
  const sourceMap = new Map(), targetMap = new Map();
  const group = (map, docs) => { for (const doc of docs) { const id = textId(doc.studentId); if (!map.has(id)) map.set(id, []); map.get(id).push(doc); } };
  group(sourceMap, sourceAcademics); group(targetMap, targetAcademics);
  const entries = [], unassignedStudentIds = new Set(), unassignedRecords = [];
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
    const common = { studentId, studentName: student.userId?.name || "", rollNumber: Number(student.feesPaid) === 1 ? student.rollNumber || "" : "-",
      schoolId: textId(school._id), schoolCode: school.code || "", schoolName: school.nameEnglish || "", studentStatus: student.active || "" };
    if (!uniqueSlots.length) entries.push({ ...common, courseId: "", courseName: "", decision: DECISIONS.NEEDS_REVIEW, reasonCode: "SOURCE_COURSES_MISSING", isFinalYear: null });
    for (const source of uniqueSlots) {
      const course = courses.find((item) => textId(item._id) === source.courseId);
      const classification = classifyEntry(source, targets, course, courses, academics.length > 1 || duplicateCourses.has(source.courseId),
        { student, pendingFeeStudentIds, targetYearExists, targetAcademicCount: (targetMap.get(studentId) || []).length });
      entries.push({ ...common, ...classification });
    }
  }
  // Students visible to a Niswan must not disappear because they lack this year's record.
  for (const student of students) {
    const studentId = textId(student._id), school = schoolMap.get(textId(student.schoolId));
    if (!school || student.active !== "Active" || sourceMap.has(studentId)) continue;
    // A target-year Admission alone cannot prove that this is a new intake:
    // the legacy individual-promotion path also writes Admission. Require review.
    entries.push({ studentId, studentName: student.userId?.name || "", rollNumber: Number(student.feesPaid) === 1 ? student.rollNumber || "" : "-",
      schoolId: textId(school._id), schoolCode: school.code || "", schoolName: school.nameEnglish || "", studentStatus: student.active,
      courseId: "", courseName: "", decision: DECISIONS.NEEDS_REVIEW, reasonCode: "SOURCE_ACADEMIC_MISSING", isFinalYear: null });
  }
  const schoolRows = schools.map((school) => {
    const schoolEntries = entries.filter((entry) => entry.schoolId === textId(school._id));
    const counts = summarizeEntries(schoolEntries);
    return { schoolId: textId(school._id), code: school.code || "", name: school.nameEnglish || "", active: school.active || "",
      supervisorId: textId(school.supervisorId), supervisorCode: school.supervisorId?.supervisorId || "",
      supervisorName: school.supervisorId?.userId?.name || "", contact: String(school.incharge1Number || school.contactNumber || ""),
      ...counts, status: schoolProgressStatus(counts) };
  }).filter((row) => row.active === "Active" || row.totalStudents > 0);
  return { entries, schoolRows, unassignedRecords, unassignedStudentCount: unassignedStudentIds.size };
}

export function filterYearEndData(data, filters = {}) {
  const matchedSchools = new Set(data.schoolRows.filter((row) =>
    (!filters.schoolId || row.schoolId === filters.schoolId) && (!filters.supervisorId || row.supervisorId === filters.supervisorId)).map((row) => row.schoolId));
  let entries = data.entries.filter((entry) => matchedSchools.has(entry.schoolId) && (!filters.courseId || entry.courseId === filters.courseId));
  let rows = data.schoolRows.filter((row) => matchedSchools.has(row.schoolId)).map((row) => {
    const scoped = entries.filter((entry) => entry.schoolId === row.schoolId);
    const counts = summarizeEntries(scoped);
    return { ...row, ...counts, status: schoolProgressStatus(counts), allCoursesStatus: row.status };
  });
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
  COURSE_ORDER_AMBIGUOUS: "More than one school course has the same progression order.",
  COURSE_ORDER_GAP: "The next school course is missing or ambiguous.", COURSE_DURATION_INVALID: "Course duration is not configured.",
  SOURCE_DUPLICATE: "More than one source academic record or course entry needs review.", STUDY_YEAR_INVALID: "The student's study year is missing or invalid.",
  NON_FINAL_COMPLETED: "A non-final course year is marked Completed.", COMPLETION_TARGET_CONFLICT: "A completed course also has a next-year entry.",
  TARGET_DUPLICATE: "More than one matching next-year course entry needs review.", TARGET_DECISION_MISSING: "A next-year record exists without an explicit promotion decision.",
  TARGET_PROGRESSION_CONFLICT: "The next-year decision does not match the course progression.", STUDENT_STATUS_REVIEW: "The student's current status needs review before closing the year.",
  NEXT_YEAR_MISSING: "The next academic year is not configured.", ADMISSION_FEES_INCOMPLETE: "The admission fees-paid flag is incomplete.",
  PENDING_FEE_INVOICE: "An unpaid fee invoice is blocking the decision.", FINAL_DECISION_PENDING: "The final-year completion or repeat decision is pending.",
  DECISION_PENDING: "The promotion or repeat decision is pending.", SOURCE_COURSES_MISSING: "The current academic record has no course entries.",
  SOURCE_ACADEMIC_MISSING: "The current academic-year record is missing.",
});
