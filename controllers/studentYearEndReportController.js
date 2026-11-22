import { getStudentYearEndReport, yearEndStudentDetails } from "../services/studentYearEndReportService.js";
import { YEAR_END_REASON_TEXT } from "../utils/studentYearEndPolicy.js";
import { sendXLSXMulti } from "../utils/reportExport.js";

export const requireStudentYearEndReportRole = (req, res, next) => {
  if (!["superadmin", "hqadmin"].includes(String(req.user?.role || "").trim().toLowerCase()))
    return res.status(403).json({ success: false, error: "This report is available only to Superadmin and HQAdmin." });
  return next();
};
const loadReport = async (req) => {
  const report = await getStudentYearEndReport(req.query);
  const expectedYear = req.headers?.["x-expected-academic-year"];
  if (expectedYear && expectedYear !== report.academicYear._id)
    throw Object.assign(new Error("The Active academic year changed. Please refresh the report."), { status: 409, code: "ACTIVE_YEAR_CHANGED" });
  return report;
};
const noCache = (res) => res.setHeader("Cache-Control", "private, no-store");
const onError = (res, error) => res.status(error.status || 500).json({ success: false,
  code: error.code || "YEAR_END_REPORT_ERROR", error: error.status ? error.message : "Unable to load the student year-end report." });
export async function getStudentYearEndSummary(req, res) {
  noCache(res);
  try {
    const { entries, ...report } = await loadReport(req);
    return res.status(200).json({ success: true, report });
  } catch (error) { return onError(res, error); }
}
export async function getStudentYearEndStudents(req, res) {
  noCache(res);
  try {
    const report = await loadReport(req);
    const details = yearEndStudentDetails(report);
    const start = (report.filters.page - 1) * report.filters.limit;
    return res.status(200).json({ success: true, academicYear: report.academicYear, nextAcademicYear: report.nextAcademicYear,
      generatedAt: report.generatedAt, totalEntries: details.entries.length, page: report.filters.page, limit: report.filters.limit,
      entries: details.entries.slice(start, start + report.filters.limit), courses: details.courses });
  } catch (error) { return onError(res, error); }
}
export async function exportStudentYearEndReport(req, res) {
  noCache(res);
  try {
    const report = await loadReport(req);
    const { entries, courses } = yearEndStudentDetails(report);
    const metadata = [
      { Field: "Academic Year", Value: report.academicYear.label }, { Field: "Next Academic Year", Value: report.nextAcademicYear.label },
      { Field: "Generated At (UTC)", Value: report.generatedAt }, { Field: "All Niswans Ready", Value: report.globalSummary.ready ? "Yes" : "No" },
      { Field: "Unassigned Students (all Niswans)", Value: report.globalSummary.unassignedStudentCount },
      { Field: "Scope", Value: "Niswan rows follow school/supervisor/course/status filters. Student rows additionally follow the decision filter. All pages included." },
      { Field: "Count rule", Value: "Students are unique. Course decisions count student-course entries. Needs Review students are included in Pending Students." },
      { Field: "Ownership", Value: "Niswan is the student's current Niswan. Historical transfer ownership is not stored on Academic records." },
      ...Object.entries(report.filters).filter(([key, value]) => value && !["page", "limit"].includes(key)).map(([key, value]) => ({ Field: key, Value: String(value) })),
    ];
    const rows = report.rows.map((row) => ({ "Niswan Code": row.code, Niswan: row.name, "Niswan Status": row.active,
      "Supervisor ID": row.supervisorCode, Supervisor: row.supervisorName, Contact: row.contact,
      Students: row.totalStudents, "Fully Processed": row.processedStudents, "Pending Students": row.pendingStudents,
      "Needs Review Students": row.needsReviewStudents, "Final-Year Decisions Pending": row.finalYearPending,
      "Course Entries": row.totalEntries, Promoted: row.promoted, "Not Promoted": row.notPromoted, Completed: row.completed,
      "Pending Entries": row.pending, "Needs Review Entries": row.needsReview, Status: row.status, "All Courses Status": row.allCoursesStatus }));
    const studentRows = entries.map((entry) => ({ "Niswan Code": entry.schoolCode, Niswan: entry.schoolName,
      "Student ID": entry.studentId, "Roll Number": entry.rollNumber, "Student Name": entry.studentName,
      "Student Status": entry.studentStatus, Course: entry.courseName, "Source Year": entry.sourceYear ?? "", "Source Status": entry.sourceStatus || "",
      "Final Year": entry.isFinalYear === null ? "Unknown" : entry.isFinalYear ? "Yes" : "No",
      "Next Course": entry.targetCourseName || "", "Next Study Year": entry.targetYear ?? "", Decision: entry.decision, Reason: YEAR_END_REASON_TEXT[entry.reasonCode] || "" }));
    return sendXLSXMulti(res, `Student_Year_End_${report.academicYear.label}`, [
      { name: "Report Info", rows: metadata }, { name: "Niswans", rows }, { name: "Course Decisions", rows: courses.map((course) => ({ Course: course.courseName || "Course details missing", Entries: course.entries,
        Promoted: course.promoted, "Not Promoted": course.notPromoted, Completed: course.completed, Pending: course.pending, "Needs Review": course.needsReview })) },
      { name: "Student Decisions", rows: studentRows },
      { name: "Records To Review", rows: report.unassignedRecords.map((record) => ({ "Student ID": record.studentId, "Student Name": record.studentName,
        "Niswan Reference": record.schoolId, Reason: YEAR_END_REASON_TEXT[record.reasonCode] })) },
    ]);
  } catch (error) { return onError(res, error); }
}
