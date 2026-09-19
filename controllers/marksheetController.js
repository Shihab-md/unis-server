import mongoose from "mongoose";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import Academic from "../models/Academic.js";
import AcademicYear from "../models/AcademicYear.js";
import Course from "../models/Course.js";
import Employee from "../models/Employee.js";
import MarksheetExam from "../models/MarksheetExam.js";
import MarksheetStudent from "../models/MarksheetStudent.js";
import School from "../models/School.js";
import Student from "../models/Student.js";
import Template from "../models/Template.js";
import { calculateGradeFromRules, getActiveGradeRules } from "../services/gradeService.js";
import {
  buildPendingMarksheetPdfState,
  getMarksheetPdfSummary,
  getNormalMarksheetTemplateInfo,
  getNormalMarksheetTemplateMap,
  sanitizeMarksheetExam,
  sanitizeMarksheetStudent,
} from "../services/marksheetPdfService.js";
import { downloadGeneratedMarksheetPdfFromDrive } from "../services/marksheetPdfDriveService.js";
import {
  fetchTemplatePdfBuffer,
  renderMuballigaIndividualExamPdfs,
} from "../services/muballigaIndividualMarksheetService.js";
import { generateOfficialMuballigaIndividualMarksheets } from "../services/officialMarksheetGenerationService.js";

const EXAM_TYPES = ["Quarterly", "Half Yearly", "Annual"];
const ADMIN_EXAM_TYPES = ["Quarterly", "Half Yearly"];

const normalizeRole = (role) => String(role || "").trim().toLowerCase();
const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const cleanString = (value) => (value === undefined || value === null ? "" : String(value).trim());
const getOverallGrade = (grade, result) => (cleanString(result) === "Fail" ? "F" : cleanString(grade));

const getYearLabel = (year) => {
  const value = Number(year || 0);
  if (!Number.isFinite(value) || value <= 0) return "-";
  if (value === 1) return "1st Year";
  if (value === 2) return "2nd Year";
  if (value === 3) return "3rd Year";
  return `${value}th Year`;
};
const toNumber = (value, fallback = 0) => {
  if (value === "" || value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeExamType = (examType) => {
  const value = cleanString(examType).toLowerCase().replace(/[-_\s]+/g, "");
  if (value === "quarterly") return "Quarterly";
  if (value === "halfyearly") return "Half Yearly";
  if (value === "annual") return "Annual";
  return "";
};

const deny = (res, message = "You are not authorized to access marksheet module.") =>
  res.status(403).json({ success: false, error: message });

const getAdminSchool = async (userId) => {
  if (!userId) return null;
  const employee = await Employee.findOne({ userId })
    .select("_id schoolId active")
    .lean();

  if (!employee?._id || cleanString(employee.active).toLowerCase() !== "active" || !employee.schoolId) {
    return null;
  }

  return String(employee.schoolId);
};

const getMarksheetAccess = async (req) => {
  const role = normalizeRole(req.user?.role);
  const userId = req.user?._id;

  if (role === "superadmin") {
    return {
      role,
      isSuperadmin: true,
      isAdmin: false,
      schoolIds: [],
      canUseModule: true,
      examTypes: EXAM_TYPES,
      canAnnual: true,
      canConsolidated: true,
    };
  }

  if (role === "admin") {
    const schoolId = await getAdminSchool(userId);
    return {
      role,
      isSuperadmin: false,
      isAdmin: true,
      schoolIds: schoolId ? [schoolId] : [],
      canUseModule: Boolean(schoolId),
      examTypes: ADMIN_EXAM_TYPES,
      canAnnual: false,
      canConsolidated: false,
    };
  }

  return {
    role,
    isSuperadmin: false,
    isAdmin: false,
    schoolIds: [],
    canUseModule: false,
    examTypes: [],
    canAnnual: false,
    canConsolidated: false,
  };
};

const assertSchoolAccess = (access, schoolId) => {
  const sid = String(schoolId || "");
  if (access.isSuperadmin) return true;
  return Boolean(sid && access.schoolIds.includes(sid));
};

const assertExamTypeAccess = (access, examType) => {
  const normalized = normalizeExamType(examType);
  return Boolean(normalized && access.examTypes.includes(normalized));
};

export const getCourseSubjectsForMarksheet = (course = {}) => {
  const subjects = [];
  const courseCode = cleanString(course?.code) || "SUB";

  for (let i = 1; i <= 10; i++) {
    const title = cleanString(course[`subject${i}`]);
    const maxMarks = toNumber(course[`subject${i}MaxMark`], 0);
    const passMarks = toNumber(course[`subject${i}PassMark`], 0);
    const subjectCode = cleanString(course[`subject${i}Code`]) || `${courseCode}-${String(i).padStart(2, "0")}`;

    if (title && maxMarks > 0) {
      subjects.push({
        subjectNo: i,
        subjectCode,
        titleOfPaper: title,
        maxMarks,
        passMarks,
      });
    }
  }

  if (subjects.length === 0 && course?.name) {
    subjects.push({
      subjectNo: 1,
      subjectCode: courseCode,
      titleOfPaper: cleanString(course.name),
      maxMarks: toNumber(course.maxMarks || course.subject1MaxMark, 0),
      passMarks: toNumber(course.passMarks || course.subject1PassMark, 0),
    });
  }

  return subjects;
};

const getAcademicCourseSlot = (academic = {}, courseId, studyingYear) => {
  const cid = String(courseId || "");
  const year = Number(studyingYear);

  for (let i = 1; i <= 5; i++) {
    if (String(academic[`courseId${i}`] || "") === cid && Number(academic[`year${i}`]) === year) {
      return {
        slot: i,
        refNumber: academic[`refNumber${i}`] || "",
        status: academic[`status${i}`] || "",
        grade: academic[`grade${i}`] || "",
      };
    }
  }

  return null;
};

const buildAcademicCourseQuery = (courseId, studyingYear) => ({
  $or: [1, 2, 3, 4, 5].map((i) => ({
    [`courseId${i}`]: courseId,
    [`year${i}`]: Number(studyingYear),
  })),
});

const normalizeAttendancePercentage = (value, { required = false } = {}) => {
  const isBlank = value === "" || value === null || value === undefined;
  if (isBlank) {
    if (required) throw new Error("Attendance Percentage is required before finalizing.");
    return null;
  }

  const attendance = Number(value);
  if (!Number.isFinite(attendance) || attendance < 0 || attendance > 100) {
    throw new Error("Attendance Percentage must be between 0 and 100.");
  }
  return Number(attendance.toFixed(2));
};

const mergeCurrentCoursePapers = (coursePapers = [], existingPapers = []) => {
  const existingMap = new Map(
    (Array.isArray(existingPapers) ? existingPapers : []).map((paper) => [Number(paper.subjectNo), paper])
  );

  return coursePapers.map((paper) => {
    const existing = existingMap.get(Number(paper.subjectNo));
    return {
      ...paper,
      obtainedMarks:
        existing?.obtainedMarks === null || existing?.obtainedMarks === undefined
          ? ""
          : existing.obtainedMarks,
      result: existing?.result || "",
    };
  });
};

const calculateMarksheetTotals = ({
  papers = [],
  status = "Draft",
  attendancePercentage = null,
  conduct = "",
  gradeRules = [],
} = {}) => {
  let totalMaxMarks = 0;
  let totalPassMarks = 0;
  let totalObtainedMarks = 0;
  let allMarksEntered = true;
  let hasFail = false;

  const normalizedPapers = papers.map((paper) => {
    const maxMarks = toNumber(paper.maxMarks, 0);
    const passMarks = toNumber(paper.passMarks, 0);
    const rawObtained = paper.obtainedMarks;
    const hasMark = rawObtained !== "" && rawObtained !== null && rawObtained !== undefined;
    const obtainedMarks = hasMark ? toNumber(rawObtained, 0) : null;

    totalMaxMarks += maxMarks;
    totalPassMarks += passMarks;

    let paperResult = "";
    if (hasMark) {
      totalObtainedMarks += obtainedMarks;
      paperResult = obtainedMarks >= passMarks ? "P" : "F";
      if (paperResult === "F") hasFail = true;
    } else {
      allMarksEntered = false;
      if (status === "Finalized") hasFail = true;
    }

    return {
      subjectNo: Number(paper.subjectNo || 0),
      subjectCode: cleanString(paper.subjectCode),
      titleOfPaper: cleanString(paper.titleOfPaper),
      maxMarks,
      passMarks,
      obtainedMarks,
      result: paperResult,
    };
  });

  const percentage = totalMaxMarks > 0 ? Number(((totalObtainedMarks / totalMaxMarks) * 100).toFixed(2)) : 0;
  const result = status === "Finalized" || allMarksEntered ? (hasFail || !allMarksEntered ? "Fail" : "Pass") : "";
  const grade = calculateGradeFromRules({
    markPercentage: percentage,
    attendancePercentage,
    result,
    conduct,
    rules: gradeRules,
  });

  return {
    papers: normalizedPapers,
    totalMaxMarks,
    totalPassMarks,
    totalObtainedMarks,
    percentage,
    attendancePercentage,
    conduct: cleanString(conduct),
    result,
    grade,
  };
};

const validateStudentMarks = ({
  marks = [],
  coursePapers = [],
  status = "Draft",
  attendancePercentage,
  conduct = "",
  gradeRules = [],
}) => {
  const markMap = new Map((Array.isArray(marks) ? marks : []).map((m) => [Number(m.subjectNo), m]));
  const papers = [];

  for (const paper of coursePapers) {
    const input = markMap.get(Number(paper.subjectNo)) || {};
    const rawValue = input.obtainedMarks;
    const hasValue = rawValue !== "" && rawValue !== null && rawValue !== undefined;

    if (status === "Finalized" && !hasValue) {
      throw new Error(`${paper.titleOfPaper}: marks required before finalizing.`);
    }

    const obtainedMarks = hasValue ? toNumber(rawValue, NaN) : null;
    if (hasValue && (!Number.isFinite(obtainedMarks) || obtainedMarks < 0)) {
      throw new Error(`${paper.titleOfPaper}: invalid marks.`);
    }

    if (hasValue && obtainedMarks > Number(paper.maxMarks || 0)) {
      throw new Error(`${paper.titleOfPaper}: marks cannot exceed max marks ${paper.maxMarks}.`);
    }

    papers.push({ ...paper, obtainedMarks });
  }

  const attendance = normalizeAttendancePercentage(attendancePercentage, { required: status === "Finalized" });
  const calculated = calculateMarksheetTotals({
    papers,
    status,
    attendancePercentage: attendance,
    conduct,
    gradeRules,
  });

  if (status === "Finalized" && calculated.result === "Pass" && !calculated.grade) {
    throw new Error(
      `No active Grade Master rule matches Mark ${calculated.percentage}% and Attendance ${attendance}%.` +
        (cleanString(conduct) ? ` Conduct: ${cleanString(conduct)}.` : "")
    );
  }

  return calculated;
};

export const getMarksheetOptions = async (req, res) => {
  try {
    const access = await getMarksheetAccess(req);
    if (!access.canUseModule) return deny(res);

    const schoolQuery = access.isSuperadmin
      ? { active: "Active" }
      : { _id: { $in: access.schoolIds }, active: "Active" };

    const [schools, academicYears, courses, gradeRules] = await Promise.all([
      School.find(schoolQuery).select("_id code nameEnglish address active").sort({ code: 1 }).lean(),
      AcademicYear.find().select("_id acYear active").sort({ acYear: -1 }).lean(),
      Course.find().sort({ code: 1 }).lean(),
      getActiveGradeRules(),
    ]);

    return res.status(200).json({
      success: true,
      access: {
        role: access.role,
        examTypes: access.examTypes,
        canAnnual: access.canAnnual,
        canConsolidated: access.canConsolidated,
      },
      schools,
      academicYears,
      courses,
      gradeRules,
    });
  } catch (error) {
    console.log("[marksheet] getMarksheetOptions", error);
    return res.status(500).json({ success: false, error: "Marksheet options server error." });
  }
};

export const getMarksheetEntryStudents = async (req, res) => {
  try {
    const access = await getMarksheetAccess(req);
    if (!access.canUseModule) return deny(res);

    const schoolId = cleanString(req.query.schoolId);
    const acYear = cleanString(req.query.acYear);
    const courseId = cleanString(req.query.courseId);
    const studyingYear = Number(req.query.studyingYear);
    const examType = normalizeExamType(req.query.examType);

    if (!isObjectId(schoolId) || !isObjectId(acYear) || !isObjectId(courseId) || !Number.isFinite(studyingYear)) {
      return res.status(400).json({ success: false, error: "Please select Niswan, AC Year, Course and Year." });
    }

    if (!assertSchoolAccess(access, schoolId)) return deny(res, "Selected Niswan is outside your permission.");
    if (!assertExamTypeAccess(access, examType)) return deny(res, "You are not allowed to manage this exam type.");

    const course = await Course.findById(courseId).lean();
    if (!course) return res.status(404).json({ success: false, error: "Course not found." });

    const coursePapers = getCourseSubjectsForMarksheet(course);
    if (coursePapers.length === 0) {
      return res.status(400).json({ success: false, error: "Course subjects not configured." });
    }

    const gradeRules = await getActiveGradeRules();

    const academicDocs = await Academic.find({
      acYear,
      ...buildAcademicCourseQuery(courseId, studyingYear),
    })
      .populate({
        path: "studentId",
        select: "_id rollNumber active schoolId userId address city",
        populate: { path: "userId", select: "name" },
      })
      .sort({ createdAt: 1 })
      .lean();

    const filteredAcademics = academicDocs.filter((academic) => {
      const student = academic.studentId;
      if (!student?._id || String(student.schoolId) !== String(schoolId)) return false;
      const active = cleanString(student.active).toLowerCase();
      return !["in-active", "transferred", "discontinued"].includes(active);
    });

    const existingExam = await MarksheetExam.findOne({ schoolId, acYear, courseId, studyingYear, examType }).lean();
    const existingRecords = existingExam?._id
      ? await MarksheetStudent.find({ marksheetExamId: existingExam._id }).lean()
      : [];
    const recordMap = new Map(existingRecords.map((r) => [String(r.studentId), r]));

    const students = filteredAcademics.map((academic) => {
      const student = academic.studentId;
      const slot = getAcademicCourseSlot(academic, courseId, studyingYear) || {};
      const existing = recordMap.get(String(student._id));
      const base = {
        studentId: student._id,
        academicId: academic._id,
        rollNumber: student.rollNumber,
        name: student.userId?.name || "",
        studentStatus: student.active || "",
        courseStatus: slot.status || "",
        refNumber: slot.refNumber || "",
        remarks: existing?.remarks || "",
      };

      // A finalized marksheet is an immutable historical snapshot. A Draft, however,
      // must always follow the current Course subject configuration so subjects added
      // after the first save are included in entry, totals and grade calculation.
      if (existing && existingExam?.status === "Finalized") {
        return {
          ...base,
          papers: existing.papers || [],
          totalMaxMarks: existing.totalMaxMarks || 0,
          totalPassMarks: existing.totalPassMarks || 0,
          totalObtainedMarks: existing.totalObtainedMarks || 0,
          percentage: existing.percentage || 0,
          attendancePercentage: existing.attendancePercentage ?? null,
          conduct: existing.conduct || "",
          grade: getOverallGrade(existing.grade, existing.result),
          result: existing.result || "",
        };
      }

      const papers = mergeCurrentCoursePapers(coursePapers, existing?.papers || []);
      const calculated = calculateMarksheetTotals({
        papers,
        status: "Draft",
        attendancePercentage: normalizeAttendancePercentage(existing?.attendancePercentage),
        conduct: existing?.conduct || "",
        gradeRules,
      });

      return { ...base, ...calculated };
    });

    const responseCoursePapers =
      existingExam?.status === "Finalized" && Array.isArray(existingRecords[0]?.papers) && existingRecords[0].papers.length > 0
        ? existingRecords[0].papers.map((paper) => ({
            subjectNo: Number(paper.subjectNo || 0),
            subjectCode: cleanString(paper.subjectCode),
            titleOfPaper: cleanString(paper.titleOfPaper),
            maxMarks: toNumber(paper.maxMarks, 0),
            passMarks: toNumber(paper.passMarks, 0),
          }))
        : coursePapers;

    const templateInfo = existingExam ? await getNormalMarksheetTemplateInfo(courseId) : null;
    const responseExam = existingExam ? sanitizeMarksheetExam(existingExam, templateInfo || {}) : null;

    return res.status(200).json({
      success: true,
      exam: responseExam,
      coursePapers: responseCoursePapers,
      gradeRules,
      students,
    });
  } catch (error) {
    console.log("[marksheet] getMarksheetEntryStudents", error);
    return res.status(500).json({ success: false, error: error.message || "Load marksheet students failed." });
  }
};

export const saveBulkMarksheet = async (req, res) => {
  try {
    const access = await getMarksheetAccess(req);
    if (!access.canUseModule) return deny(res);

    const schoolId = cleanString(req.body.schoolId);
    const acYear = cleanString(req.body.acYear);
    const courseId = cleanString(req.body.courseId);
    const studyingYear = Number(req.body.studyingYear);
    const examType = normalizeExamType(req.body.examType);
    const status = cleanString(req.body.status) === "Finalized" ? "Finalized" : "Draft";
    const students = Array.isArray(req.body.students) ? req.body.students : [];

    if (!isObjectId(schoolId) || !isObjectId(acYear) || !isObjectId(courseId) || !Number.isFinite(studyingYear)) {
      return res.status(400).json({ success: false, error: "Please select Niswan, AC Year, Course and Year." });
    }

    if (!assertSchoolAccess(access, schoolId)) return deny(res, "Selected Niswan is outside your permission.");
    if (!assertExamTypeAccess(access, examType)) return deny(res, "You are not allowed to manage this exam type.");
    if (students.length === 0) return res.status(400).json({ success: false, error: "No student marks received." });

    const [course, gradeRules] = await Promise.all([Course.findById(courseId).lean(), getActiveGradeRules()]);
    if (!course) return res.status(404).json({ success: false, error: "Course not found." });

    const coursePapers = getCourseSubjectsForMarksheet(course);
    if (coursePapers.length === 0) {
      return res.status(400).json({ success: false, error: "Course subjects not configured." });
    }

    if (status === "Finalized" && gradeRules.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Please configure at least one Active Grade in Grade Master before finalizing marksheets.",
      });
    }

    const existingExam = await MarksheetExam.findOne({ schoolId, acYear, courseId, studyingYear, examType })
      .select("_id status")
      .lean();

    if (existingExam?.status === "Finalized") {
      return res.status(400).json({
        success: false,
        error: "Finalized marksheet cannot be edited. Draft marksheets only can be edited.",
      });
    }

    // Validate all rows before changing the exam status. This is especially important
    // for Finalize: one bad row must not lock a partially saved marksheet.
    const validatedRows = [];
    const validationErrors = [];

    for (const row of students) {
      try {
        const studentId = cleanString(row.studentId);
        const academicId = cleanString(row.academicId);
        if (!isObjectId(studentId) || !isObjectId(academicId)) {
          throw new Error("Invalid student/academic id.");
        }

        const [student, academic] = await Promise.all([
          Student.findOne({ _id: studentId, schoolId }).select("_id").lean(),
          Academic.findOne({ _id: academicId, studentId, acYear, ...buildAcademicCourseQuery(courseId, studyingYear) })
            .select("_id")
            .lean(),
        ]);

        if (!student) throw new Error("Student is outside selected Niswan.");
        if (!academic) throw new Error("Academic course/year not found for this student.");

        const calculated = validateStudentMarks({
          marks: row.papers || row.marks || [],
          coursePapers,
          status,
          attendancePercentage: row.attendancePercentage,
          conduct: row.conduct,
          gradeRules,
        });

        validatedRows.push({ row, studentId, academicId, calculated });
      } catch (rowError) {
        validationErrors.push({
          studentId: row.studentId,
          name: row.name || "",
          reason: rowError.message || "Validation failed",
        });
      }
    }

    if (status === "Finalized" && validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Marksheet not finalized. Please correct ${validationErrors.length} student row(s).`,
        errors: validationErrors,
      });
    }

    const now = new Date();
    const exam = await MarksheetExam.findOneAndUpdate(
      { schoolId, acYear, courseId, studyingYear, examType },
      {
        $set: {
          status: "Draft",
          updatedBy: req.user?._id,
          updatedAt: now,
        },
        $unset: { finalizedBy: "", finalizedAt: "", marksheetPdf: "" },
        $setOnInsert: { createdBy: req.user?._id, createdAt: now },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    let savedCount = 0;
    const saveErrors = [...validationErrors];

    for (const item of validatedRows) {
      try {
        const { row, studentId, academicId, calculated } = item;
        await MarksheetStudent.findOneAndUpdate(
          { marksheetExamId: exam._id, studentId },
          {
            $set: {
              schoolId,
              studentId,
              academicId,
              acYear,
              courseId,
              studyingYear,
              examType,
              papers: calculated.papers,
              totalMaxMarks: calculated.totalMaxMarks,
              totalPassMarks: calculated.totalPassMarks,
              totalObtainedMarks: calculated.totalObtainedMarks,
              percentage: calculated.percentage,
              attendancePercentage: calculated.attendancePercentage,
              conduct: calculated.conduct,
              grade: calculated.grade,
              result: calculated.result,
              status: "Draft",
              remarks: cleanString(row.remarks),
              updatedBy: req.user?._id,
              updatedAt: now,
            },
            $unset: { finalizedBy: "", finalizedAt: "", marksheetPdf: "" },
            $setOnInsert: { createdBy: req.user?._id, createdAt: now },
          },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        savedCount++;
      } catch (rowError) {
        saveErrors.push({
          studentId: item.row.studentId,
          name: item.row.name || "",
          reason: rowError.message || "Save failed",
        });
      }
    }

    const totalStudents = await MarksheetStudent.countDocuments({ marksheetExamId: exam._id });
    let finalizedPdfState = null;
    let finalizedAtForResponse = null;

    if (status === "Finalized") {
      if (saveErrors.length > 0 || savedCount !== validatedRows.length) {
        await MarksheetExam.findByIdAndUpdate(exam._id, {
          $set: {
            status: "Draft",
            totalStudents,
            updatedBy: req.user?._id,
            updatedAt: new Date(),
          },
          $unset: { finalizedBy: "", finalizedAt: "", marksheetPdf: "" },
        });
        return res.status(500).json({
          success: false,
          error: "Marksheet was not finalized because one or more student records could not be saved. It remains Draft.",
          savedCount,
          errors: saveErrors,
        });
      }

      const finalizedAt = new Date();
      await MarksheetStudent.updateMany(
        { marksheetExamId: exam._id },
        {
          $set: {
            status: "Finalized",
            finalizedBy: req.user?._id,
            finalizedAt,
            updatedBy: req.user?._id,
            updatedAt: finalizedAt,
          },
          $unset: { marksheetPdf: "" },
        }
      );

      // Academic finalization is committed first. Official PDF generation is a separate
      // artifact lifecycle so template/Drive failures can never roll back finalized marks.
      const pendingPdfState = buildPendingMarksheetPdfState({
        requestedBy: req.user?._id,
        requestedAt: finalizedAt,
      });
      finalizedPdfState = pendingPdfState;
      finalizedAtForResponse = finalizedAt;

      await MarksheetExam.findByIdAndUpdate(exam._id, {
        $set: {
          status: "Finalized",
          totalStudents,
          finalizedBy: req.user?._id,
          finalizedAt,
          marksheetPdf: pendingPdfState,
          updatedBy: req.user?._id,
          updatedAt: finalizedAt,
        },
      });
    } else {
      await MarksheetExam.findByIdAndUpdate(exam._id, {
        $set: { status: "Draft", totalStudents, updatedBy: req.user?._id, updatedAt: new Date() },
        $unset: { finalizedBy: "", finalizedAt: "", marksheetPdf: "" },
      });
    }

    const templateInfo = status === "Finalized" ? await getNormalMarksheetTemplateInfo(courseId) : null;
    const marksheetPdf =
      status === "Finalized"
        ? getMarksheetPdfSummary(
            {
              status: "Finalized",
              totalStudents,
              finalizedAt: finalizedAtForResponse,
              marksheetPdf: finalizedPdfState,
            },
            templateInfo || {}
          )
        : null;

    return res.status(200).json({
      success: true,
      message: `${status} marks saved. Saved: ${savedCount}, Errors: ${saveErrors.length}`,
      examId: exam._id,
      savedCount,
      errors: saveErrors,
      marksheetPdf,
    });
  } catch (error) {
    console.log("[marksheet] saveBulkMarksheet", error);
    return res.status(500).json({ success: false, error: error.message || "Save marksheet failed." });
  }
};

export const listMarksheetExams = async (req, res) => {
  try {
    const access = await getMarksheetAccess(req);
    if (!access.canUseModule) return deny(res);

    const query = {};
    if (!access.isSuperadmin) query.schoolId = { $in: access.schoolIds };

    const schoolId = cleanString(req.query.schoolId);
    const acYear = cleanString(req.query.acYear);
    const courseId = cleanString(req.query.courseId);
    const studyingYear = Number(req.query.studyingYear);
    const examType = normalizeExamType(req.query.examType);

    if (schoolId && isObjectId(schoolId)) {
      if (!assertSchoolAccess(access, schoolId)) return deny(res, "Selected Niswan is outside your permission.");
      query.schoolId = schoolId;
    }
    if (acYear && isObjectId(acYear)) query.acYear = acYear;
    if (courseId && isObjectId(courseId)) query.courseId = courseId;
    if (Number.isFinite(studyingYear) && studyingYear > 0) query.studyingYear = studyingYear;
    if (examType) query.examType = examType;

    const exams = await MarksheetExam.find(query)
      .populate("schoolId", "code nameEnglish")
      .populate("acYear", "acYear active")
      .populate("courseId", "code name years")
      .sort({ updatedAt: -1 })
      .lean();

    const templateMap = await getNormalMarksheetTemplateMap(
      exams
        .filter((exam) => exam.status === "Finalized")
        .map((exam) => exam.courseId?._id || exam.courseId)
    );
    const responseExams = exams.map((exam) =>
      sanitizeMarksheetExam(exam, templateMap.get(String(exam.courseId?._id || exam.courseId || "")) || {})
    );

    return res.status(200).json({ success: true, exams: responseExams });
  } catch (error) {
    console.log("[marksheet] listMarksheetExams", error);
    return res.status(500).json({ success: false, error: "Load marksheet list failed." });
  }
};

export const getMarksheetExam = async (req, res) => {
  try {
    const access = await getMarksheetAccess(req);
    if (!access.canUseModule) return deny(res);

    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ success: false, error: "Invalid marksheet exam id." });

    const exam = await MarksheetExam.findById(id)
      .populate("schoolId", "code nameEnglish address")
      .populate("acYear", "acYear active")
      .populate("courseId")
      .lean();

    if (!exam) return res.status(404).json({ success: false, error: "Marksheet exam not found." });
    if (!assertSchoolAccess(access, exam.schoolId?._id || exam.schoolId)) return deny(res, "Selected Niswan is outside your permission.");

    const records = await MarksheetStudent.find({ marksheetExamId: id })
      .populate({ path: "studentId", select: "rollNumber userId active", populate: { path: "userId", select: "name" } })
      .sort({ createdAt: 1 })
      .lean();
    const normalizedRecords = records.map((record) => ({
      ...sanitizeMarksheetStudent(record),
      grade: getOverallGrade(record.grade, record.result),
    }));
    const templateInfo = await getNormalMarksheetTemplateInfo(exam.courseId?._id || exam.courseId);
    const responseExam = sanitizeMarksheetExam(exam, templateInfo);

    return res.status(200).json({ success: true, exam: responseExam, records: normalizedRecords });
  } catch (error) {
    console.log("[marksheet] getMarksheetExam", error);
    return res.status(500).json({ success: false, error: "Load marksheet exam failed." });
  }
};

export const requestMarksheetPdfGeneration = async (req, res) => {
  try {
    const access = await getMarksheetAccess(req);
    if (!access.canUseModule) return deny(res);

    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ success: false, error: "Invalid marksheet exam id." });

    const exam = await MarksheetExam.findById(id).lean();
    if (!exam) return res.status(404).json({ success: false, error: "Marksheet exam not found." });
    if (!assertSchoolAccess(access, exam.schoolId)) return deny(res, "Selected Niswan is outside your permission.");
    if (exam.status !== "Finalized") {
      return res.status(400).json({ success: false, error: "Official marksheet PDF can be generated only after finalization." });
    }

    const templateInfo = await getNormalMarksheetTemplateInfo(exam.courseId);
    if (!templateInfo.ready) {
      return res.status(409).json({
        success: false,
        error: "Normal marksheet PDF template is not uploaded for this course.",
        marksheetPdf: getMarksheetPdfSummary(exam, templateInfo),
      });
    }

    await generateOfficialMuballigaIndividualMarksheets({
      examId: id,
      requestedBy: req.user?._id || null,
    });

    const updatedExam = await MarksheetExam.findById(id).lean();
    const marksheetPdf = getMarksheetPdfSummary(updatedExam || exam, templateInfo);

    return res.status(200).json({
      success: true,
      message: "Official Muballiga Individual marksheet PDFs generated successfully.",
      marksheetPdf,
    });
  } catch (error) {
    console.log("[marksheet] requestMarksheetPdfGeneration", error);

    const examId = req.params?.id;
    let marksheetPdf = null;
    if (isObjectId(examId)) {
      const failedExam = await MarksheetExam.findById(examId).lean().catch(() => null);
      if (failedExam) {
        const templateInfo = await getNormalMarksheetTemplateInfo(failedExam.courseId).catch(() => ({}));
        marksheetPdf = getMarksheetPdfSummary(failedExam, templateInfo);
      }
    }

    const message = error?.message || "Generate marksheet PDF failed.";
    const status = /already in progress/i.test(message) ? 409 : 500;
    return res.status(status).json({ success: false, error: message, marksheetPdf });
  }
};

export const listMarksheetPdfFiles = async (req, res) => {
  try {
    const access = await getMarksheetAccess(req);
    if (!access.canUseModule) return deny(res);

    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ success: false, error: "Invalid marksheet exam id." });

    const exam = await MarksheetExam.findById(id).lean();
    if (!exam) return res.status(404).json({ success: false, error: "Marksheet exam not found." });
    if (!assertSchoolAccess(access, exam.schoolId)) return deny(res, "Selected Niswan is outside your permission.");
    if (exam.status !== "Finalized") {
      return res.status(400).json({ success: false, error: "Official marksheet PDFs are available only for finalized exams." });
    }

    const [records, templateInfo] = await Promise.all([
      MarksheetStudent.find({ marksheetExamId: id })
        .select("_id studentId marksheetPdf")
        .populate({ path: "studentId", select: "rollNumber userId", populate: { path: "userId", select: "name" } })
        .sort({ createdAt: 1 })
        .lean(),
      getNormalMarksheetTemplateInfo(exam.courseId),
    ]);

    return res.status(200).json({
      success: true,
      marksheetPdf: getMarksheetPdfSummary(exam, templateInfo),
      students: records.map((record) => ({
        recordId: record._id,
        studentId: record.studentId?._id || record.studentId || null,
        rollNumber: record.studentId?.rollNumber || "",
        name: record.studentId?.userId?.name || "",
        marksheetPdf: sanitizeMarksheetStudent(record).marksheetPdf,
      })),
    });
  } catch (error) {
    console.log("[marksheet] listMarksheetPdfFiles", error);
    return res.status(500).json({ success: false, error: error.message || "Load marksheet PDF files failed." });
  }
};

export const downloadCombinedOfficialMarksheetPdf = async (req, res) => {
  try {
    const access = await getMarksheetAccess(req);
    if (!access.canUseModule) return deny(res);

    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ success: false, error: "Invalid marksheet exam id." });

    const exam = await MarksheetExam.findById(id).lean();
    if (!exam) return res.status(404).json({ success: false, error: "Marksheet exam not found." });
    if (!assertSchoolAccess(access, exam.schoolId)) return deny(res, "Selected Niswan is outside your permission.");
    if (
      exam.status !== "Finalized" ||
      exam.marksheetPdf?.status !== "Generated" ||
      !exam.marksheetPdf?.combinedDriveFileId
    ) {
      return res.status(409).json({ success: false, error: "Official combined marksheet PDF is not generated yet." });
    }

    const currentTemplate = await Template.findOne({
      courseId: exam.courseId,
      templateModule: "MARKSHEET",
      marksheetType: "NORMAL",
    })
      .select("version")
      .lean();
    if (
      currentTemplate &&
      Number(currentTemplate.version || 1) !== Number(exam.marksheetPdf?.templateVersion || 0)
    ) {
      return res.status(409).json({
        success: false,
        error: "The marksheet template was updated. Regenerate the official PDF before downloading.",
      });
    }

    const buffer = await downloadGeneratedMarksheetPdfFromDrive(exam.marksheetPdf.combinedDriveFileId);
    const fileName = cleanString(exam.marksheetPdf.combinedFileName) || "marksheets.pdf";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName.replace(/["\r\n]/g, "_")}"`);
    res.setHeader("Content-Length", String(buffer.length));
    return res.status(200).send(buffer);
  } catch (error) {
    console.log("[marksheet] downloadCombinedOfficialMarksheetPdf", error);
    return res.status(500).json({ success: false, error: error.message || "Download combined marksheet PDF failed." });
  }
};

export const downloadStudentOfficialMarksheetPdf = async (req, res) => {
  try {
    const access = await getMarksheetAccess(req);
    if (!access.canUseModule) return deny(res);

    const { id, recordId } = req.params;
    if (!isObjectId(id) || !isObjectId(recordId)) {
      return res.status(400).json({ success: false, error: "Invalid marksheet PDF request." });
    }

    const exam = await MarksheetExam.findById(id).lean();
    if (!exam) return res.status(404).json({ success: false, error: "Marksheet exam not found." });
    if (!assertSchoolAccess(access, exam.schoolId)) return deny(res, "Selected Niswan is outside your permission.");
    if (exam.status !== "Finalized" || exam.marksheetPdf?.status !== "Generated") {
      return res.status(409).json({ success: false, error: "Official marksheet PDF is not generated yet." });
    }

    const currentTemplate = await Template.findOne({
      courseId: exam.courseId,
      templateModule: "MARKSHEET",
      marksheetType: "NORMAL",
    })
      .select("version")
      .lean();
    if (
      currentTemplate &&
      Number(currentTemplate.version || 1) !== Number(exam.marksheetPdf?.templateVersion || 0)
    ) {
      return res.status(409).json({
        success: false,
        error: "The marksheet template was updated. Regenerate the official PDF before downloading.",
      });
    }

    const record = await MarksheetStudent.findOne({ _id: recordId, marksheetExamId: id }).lean();
    if (!record) return res.status(404).json({ success: false, error: "Student marksheet record not found." });
    if (!record.marksheetPdf?.driveFileId) {
      return res.status(409).json({ success: false, error: "Official student marksheet PDF is not generated yet." });
    }

    const buffer = await downloadGeneratedMarksheetPdfFromDrive(record.marksheetPdf.driveFileId);
    const fileName = cleanString(record.marksheetPdf.fileName) || "marksheet.pdf";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName.replace(/["\r\n]/g, "_")}"`);
    res.setHeader("Content-Length", String(buffer.length));
    return res.status(200).send(buffer);
  } catch (error) {
    console.log("[marksheet] downloadStudentOfficialMarksheetPdf", error);
    return res.status(500).json({ success: false, error: error.message || "Download student marksheet PDF failed." });
  }
};

const isStudentCourseCompleted = (_student, academics, courseId) => {
  for (const academic of academics) {
    for (let i = 1; i <= 5; i++) {
      if (
        String(academic[`courseId${i}`] || "") === String(courseId) &&
        cleanString(academic[`status${i}`]).toLowerCase() === "completed"
      ) {
        return true;
      }
    }
  }

  return false;
};

export const listConsolidatedStudents = async (req, res) => {
  try {
    const access = await getMarksheetAccess(req);
    if (!access.canConsolidated) return deny(res, "Consolidated marksheet is available only to Superadmin.");

    const courseId = cleanString(req.query.courseId);
    const schoolId = cleanString(req.query.schoolId);

    if (!isObjectId(courseId)) {
      return res.status(400).json({ success: false, error: "Please select a valid course." });
    }

    if (schoolId && !isObjectId(schoolId)) {
      return res.status(400).json({ success: false, error: "Invalid Niswan." });
    }
    if (schoolId && !assertSchoolAccess(access, schoolId)) {
      return deny(res, "Selected Niswan is outside your permission.");
    }

    const courseExists = await Course.exists({ _id: courseId });
    if (!courseExists) {
      return res.status(404).json({ success: false, error: "Course not found." });
    }

    const completedQuery = {
      $or: [1, 2, 3, 4, 5].map((i) => ({
        [`courseId${i}`]: courseId,
        [`status${i}`]: "Completed",
      })),
    };

    const academics = await Academic.find(completedQuery).select("studentId").lean();
    const studentIds = [...new Set(academics.map((academic) => String(academic.studentId || "")).filter(Boolean))];

    if (studentIds.length === 0) {
      return res.status(200).json({ success: true, students: [] });
    }

    const studentQuery = { _id: { $in: studentIds } };
    if (schoolId) studentQuery.schoolId = schoolId;

    const students = await Student.find(studentQuery)
      .select("_id rollNumber active schoolId userId")
      .populate("userId", "name")
      .populate("schoolId", "code nameEnglish")
      .sort({ rollNumber: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      students: students.map((student) => ({
        studentId: student._id,
        rollNumber: student.rollNumber || "",
        name: student.userId?.name || "",
        studentStatus: student.active || "",
        schoolId: student.schoolId?._id || student.schoolId || null,
        schoolCode: student.schoolId?.code || "",
        schoolName: student.schoolId?.nameEnglish || "",
      })),
    });
  } catch (error) {
    console.log("[marksheet] listConsolidatedStudents", error);
    return res.status(500).json({ success: false, error: "Load completed students failed." });
  }
};

export const getConsolidatedMarksheet = async (req, res) => {
  try {
    const access = await getMarksheetAccess(req);
    if (!access.canConsolidated) return deny(res, "Consolidated marksheet is available only to Superadmin.");

    const studentId = cleanString(req.query.studentId);
    const courseId = cleanString(req.query.courseId);
    if (!isObjectId(studentId) || !isObjectId(courseId)) {
      return res.status(400).json({ success: false, error: "Please select student and course." });
    }

    const [student, course] = await Promise.all([
      Student.findById(studentId)
        .populate("schoolId", "code nameEnglish address")
        .populate("userId", "name")
        .lean(),
      Course.findById(courseId).lean(),
    ]);

    if (!student || !course) return res.status(404).json({ success: false, error: "Student or course not found." });

    const academics = await Academic.find({ studentId }).populate("acYear", "acYear").sort({ createdAt: 1 }).lean();
    if (!isStudentCourseCompleted(student, academics, courseId)) {
      return res.status(400).json({ success: false, error: "Consolidated marksheet can be generated only for completed students." });
    }

    const yearsCount = Number(course.years || 3) > 0 ? Number(course.years || 3) : 3;
    const requiredYears = Array.from({ length: yearsCount }, (_, idx) => idx + 1);

    const records = await MarksheetStudent.find({
      studentId,
      courseId,
      studyingYear: { $in: requiredYears },
      examType: { $in: EXAM_TYPES },
      status: "Finalized",
    })
      .populate("acYear", "acYear")
      .sort({ studyingYear: 1, examType: 1 })
      .lean();

    const recordMap = new Map(
      records.map((record) => [
        `${record.studyingYear}__${record.examType}`,
        { ...sanitizeMarksheetStudent(record), grade: getOverallGrade(record.grade, record.result) },
      ])
    );
    const consolidatedRows = requiredYears.map((year) => ({
      year,
      exams: EXAM_TYPES.map((examType) => ({
        examType,
        record: recordMap.get(`${year}__${examType}`) || null,
      })),
    }));

    return res.status(200).json({
      success: true,
      student,
      course,
      years: consolidatedRows,
      missingCount: consolidatedRows.reduce((count, y) => count + y.exams.filter((exam) => !exam.record).length, 0),
    });
  } catch (error) {
    console.log("[marksheet] getConsolidatedMarksheet", error);
    return res.status(500).json({ success: false, error: error.message || "Load consolidated marksheet failed." });
  }
};

// ---------------- Marksheet PDF printing ----------------
const PDF_BLACK = rgb(0.05, 0.05, 0.05);
const PDF_BLUE = rgb(0.05, 0.16, 0.42);

const fetchBinary = async (url) => {
  const response = await fetch(String(url || ""));
  if (!response.ok) {
    throw new Error(`Unable to load template PDF. Status: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
};

const loadMarksheetTemplatePdf = async ({ courseId, marksheetType }) => {
  const template = await Template.findOne({
    courseId,
    templateModule: "MARKSHEET",
    marksheetType,
  }).lean();

  if (!template || !template.template || template.template === "-") {
    throw new Error(
      marksheetType === "CONSOLIDATED"
        ? "Consolidated marksheet PDF template not found for this course. Please upload it in Templates module."
        : "Normal marksheet PDF template not found for this course. Please upload it in Templates module."
    );
  }

  if (!String(template.template).toLowerCase().includes(".pdf")) {
    throw new Error("Marksheet template must be a PDF file.");
  }

  const bytes = await fetchBinary(String(template.template).replace("?download=1", ""));
  return PDFDocument.load(bytes);
};

const pdfY = (page, yFromTop) => page.getHeight() - Number(yFromTop || 0);

const drawPdfText = ({ page, text, x, yFromTop, size = 9, font, color = PDF_BLACK, maxWidth = 500 }) => {
  const safeText = cleanString(text);
  if (!safeText) return;
  page.drawText(safeText.slice(0, 180), {
    x,
    y: pdfY(page, yFromTop),
    size,
    font,
    color,
    maxWidth,
  });
};

const drawPdfCentered = ({ page, text, yFromTop, size = 12, font, color = PDF_BLACK }) => {
  const safeText = cleanString(text);
  if (!safeText) return;
  const width = font.widthOfTextAtSize(safeText, size);
  page.drawText(safeText, {
    x: Math.max(25, (page.getWidth() - width) / 2),
    y: pdfY(page, yFromTop),
    size,
    font,
    color,
  });
};

const getFileSafeText = (value, fallback = "marksheet") =>
  cleanString(value || fallback)
    .replace(/\s+/g, "_")
    .replace(/[^\w.-]/g, "")
    .slice(0, 80) || fallback;


export const printMarksheetExam = async (req, res) => {
  try {
    const access = await getMarksheetAccess(req);
    if (!access.canUseModule) return deny(res);

    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ success: false, error: "Invalid marksheet exam id." });

    const exam = await MarksheetExam.findById(id)
      .populate("schoolId", "code nameEnglish address pincode")
      .populate("acYear", "acYear active")
      .populate("courseId")
      .lean();

    if (!exam) return res.status(404).json({ success: false, error: "Marksheet exam not found." });
    if (!assertSchoolAccess(access, exam.schoolId?._id || exam.schoolId)) return deny(res, "Selected Niswan is outside your permission.");
    if (exam.status !== "Finalized") {
      return res.status(409).json({ success: false, error: "Finalized marksheets only can be printed." });
    }

    const records = await MarksheetStudent.find({ marksheetExamId: id, status: "Finalized" })
      .populate({ path: "studentId", select: "rollNumber userId active", populate: { path: "userId", select: "name" } })
      .sort({ createdAt: 1 })
      .lean();

    if (records.length === 0) {
      return res.status(400).json({ success: false, error: "No finalized marksheet records found to print." });
    }

    if (Number(exam.totalStudents || 0) > 0 && records.length !== Number(exam.totalStudents || 0)) {
      return res.status(409).json({
        success: false,
        error: "Finalized student count does not match the exam total. Printing stopped for safety.",
      });
    }

    const template = await Template.findOne({
      courseId: exam.courseId?._id || exam.courseId,
      templateModule: "MARKSHEET",
      marksheetType: "NORMAL",
    })
      .select("template version")
      .lean();

    if (!template || !cleanString(template.template) || template.template === "-") {
      return res.status(409).json({
        success: false,
        error: "Normal marksheet PDF template not found for this course. Please upload it in Templates module.",
      });
    }

    const templateBuffer = await fetchTemplatePdfBuffer(template.template);
    const rendered = await renderMuballigaIndividualExamPdfs({ templateBuffer, exam, records });
    const pdfBytes = rendered.combinedBuffer;
    const fileName = `${getFileSafeText(exam.courseId?.code || exam.courseId?.name)}_${getFileSafeText(exam.examType)}_${getFileSafeText(exam.acYear?.acYear)}_ALL.pdf`;

    return res.status(200).json({
      success: true,
      type: "base64pdf",
      file: pdfBytes.toString("base64"),
      fileName,
      mimeType: "application/pdf",
      templateVersion: Number(template.version || 1),
    });
  } catch (error) {
    console.log("[marksheet] printMarksheetExam", error);
    return res.status(500).json({ success: false, error: error.message || "Print marksheet failed." });
  }
};

const drawConsolidatedMarksheet = ({ page, fonts, data }) => {
  const student = data.student || {};
  const course = data.course || {};
  const school = student.schoolId || {};
  const years = Array.isArray(data.years) ? data.years : [];

  drawPdfCentered({ page, text: "CONSOLIDATED STATEMENT OF MARKS", yFromTop: 62, size: 12, font: fonts.bold, color: PDF_BLUE });
  drawPdfText({ page, text: `Name of the Student: ${student.userId?.name || "-"}`, x: 42, yFromTop: 100, size: 8, font: fonts.bold });
  drawPdfText({ page, text: `Register Number: ${student.rollNumber || "-"}`, x: 335, yFromTop: 100, size: 8, font: fonts.bold });
  drawPdfText({ page, text: `Name of the Course: ${course.name || "-"}`, x: 42, yFromTop: 118, size: 8, font: fonts.regular });
  drawPdfText({ page, text: `Niswan Code: ${school.code || "-"}`, x: 335, yFromTop: 118, size: 8, font: fonts.regular });
  drawPdfText({ page, text: `Name of the Niswan: ${school.nameEnglish || "-"}`, x: 42, yFromTop: 136, size: 8, font: fonts.regular });
  drawPdfText({ page, text: `Date of Issue: ${new Date().toLocaleDateString("en-GB")}`, x: 335, yFromTop: 136, size: 8, font: fonts.regular });

  let y = 172;
  drawPdfText({ page, text: "Year", x: 35, yFromTop: y, size: 6.5, font: fonts.bold, color: PDF_BLUE });
  drawPdfText({ page, text: "Exam", x: 78, yFromTop: y, size: 6.5, font: fonts.bold, color: PDF_BLUE });
  drawPdfText({ page, text: "Subject Code", x: 150, yFromTop: y, size: 6.5, font: fonts.bold, color: PDF_BLUE });
  drawPdfText({ page, text: "Title of the Paper", x: 235, yFromTop: y, size: 6.5, font: fonts.bold, color: PDF_BLUE });
  drawPdfText({ page, text: "Marks", x: 430, yFromTop: y, size: 6.5, font: fonts.bold, color: PDF_BLUE });
  drawPdfText({ page, text: "P/F", x: 505, yFromTop: y, size: 6.5, font: fonts.bold, color: PDF_BLUE });
  y += 12;

  years.forEach((yearBlock) => {
    (yearBlock.exams || []).forEach((examBlock) => {
      const record = examBlock.record;
      const papers = record?.papers?.length ? record.papers : [{ subjectCode: "-", titleOfPaper: "Not Entered", obtainedMarks: "", maxMarks: "", result: "" }];
      papers.forEach((paper, paperIndex) => {
        if (y > 760) return;
        if (paperIndex === 0) {
          drawPdfText({ page, text: getYearLabel(yearBlock.year), x: 35, yFromTop: y, size: 6.2, font: fonts.bold });
          drawPdfText({ page, text: examBlock.examType, x: 78, yFromTop: y, size: 6.2, font: fonts.bold });
        }
        drawPdfText({ page, text: paper.subjectCode || "-", x: 150, yFromTop: y, size: 6.2, font: fonts.regular });
        drawPdfText({ page, text: paper.titleOfPaper || "-", x: 235, yFromTop: y, size: 6.2, font: fonts.regular, maxWidth: 180 });
        drawPdfText({ page, text: paper.obtainedMarks !== "" && paper.obtainedMarks !== null ? `${paper.obtainedMarks} / ${paper.maxMarks}` : "-", x: 430, yFromTop: y, size: 6.2, font: fonts.regular });
        drawPdfText({ page, text: paper.result || "-", x: 512, yFromTop: y, size: 6.2, font: fonts.bold });
        y += 8;
      });
      if (record) {
        drawPdfText({ page, text: `Total: ${record.totalObtainedMarks}/${record.totalMaxMarks} | Mark ${record.percentage}% | Att ${record.attendancePercentage === null || record.attendancePercentage === undefined ? "-" : `${record.attendancePercentage}%`} | ${getOverallGrade(record.grade, record.result) || "-"} | ${record.result}`, x: 78, yFromTop: y, size: 6.2, font: fonts.bold });
        y += 9;
      }
    });
    y += 4;
  });

  drawPdfText({ page, text: "Signature of the Student", x: 75, yFromTop: page.getHeight() - 56, size: 8, font: fonts.bold });
  drawPdfText({ page, text: "Controller of Examinations", x: 365, yFromTop: page.getHeight() - 56, size: 8, font: fonts.bold });
};

const getConsolidatedData = async ({ studentId, courseId }) => {
  const [student, course] = await Promise.all([
    Student.findById(studentId)
      .populate("schoolId", "code nameEnglish address")
      .populate("userId", "name")
      .lean(),
    Course.findById(courseId).lean(),
  ]);

  if (!student || !course) throw new Error("Student or course not found.");

  const academics = await Academic.find({ studentId }).populate("acYear", "acYear").sort({ createdAt: 1 }).lean();
  if (!isStudentCourseCompleted(student, academics, courseId)) {
    throw new Error("Consolidated marksheet can be generated only for completed students.");
  }

  const yearsCount = Number(course.years || 3) > 0 ? Number(course.years || 3) : 3;
  const requiredYears = Array.from({ length: yearsCount }, (_, idx) => idx + 1);

  const records = await MarksheetStudent.find({
    studentId,
    courseId,
    studyingYear: { $in: requiredYears },
    examType: { $in: EXAM_TYPES },
    status: "Finalized",
  })
    .populate("acYear", "acYear")
    .sort({ studyingYear: 1, examType: 1 })
    .lean();

  const recordMap = new Map(
    records.map((record) => [
      `${record.studyingYear}__${record.examType}`,
      { ...sanitizeMarksheetStudent(record), grade: getOverallGrade(record.grade, record.result) },
    ])
  );
  const consolidatedRows = requiredYears.map((year) => ({
    year,
    exams: EXAM_TYPES.map((examType) => ({
      examType,
      record: recordMap.get(`${year}__${examType}`) || null,
    })),
  }));

  return {
    success: true,
    student,
    course,
    years: consolidatedRows,
    missingCount: consolidatedRows.reduce((count, y) => count + y.exams.filter((exam) => !exam.record).length, 0),
  };
};

export const printConsolidatedMarksheet = async (req, res) => {
  try {
    const access = await getMarksheetAccess(req);
    if (!access.canConsolidated) return deny(res, "Consolidated marksheet is available only to Superadmin.");

    const studentId = cleanString(req.query.studentId);
    const courseId = cleanString(req.query.courseId);
    if (!isObjectId(studentId) || !isObjectId(courseId)) {
      return res.status(400).json({ success: false, error: "Please select student and course." });
    }

    const data = await getConsolidatedData({ studentId, courseId });
    const templatePdf = await loadMarksheetTemplatePdf({ courseId, marksheetType: "CONSOLIDATED" });
    const outputPdf = await PDFDocument.create();
    const fonts = {
      regular: await outputPdf.embedFont(StandardFonts.Helvetica),
      bold: await outputPdf.embedFont(StandardFonts.HelveticaBold),
    };

    const [basePage] = await outputPdf.copyPages(templatePdf, [0]);
    outputPdf.addPage(basePage);
    drawConsolidatedMarksheet({ page: basePage, fonts, data });

    const pdfBytes = Buffer.from(await outputPdf.save());
    const fileName = `${getFileSafeText(data.course?.code || data.course?.name)}_${getFileSafeText(data.student?.rollNumber)}_CONSOLIDATED.pdf`;

    return res.status(200).json({
      success: true,
      type: "base64pdf",
      file: pdfBytes.toString("base64"),
      fileName,
      mimeType: "application/pdf",
    });
  } catch (error) {
    console.log("[marksheet] printConsolidatedMarksheet", error);
    return res.status(500).json({ success: false, error: error.message || "Print consolidated marksheet failed." });
  }
};
