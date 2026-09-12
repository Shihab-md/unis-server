import mongoose from "mongoose";
import Academic from "../models/Academic.js";
import AcademicYear from "../models/AcademicYear.js";
import Course from "../models/Course.js";
import Employee from "../models/Employee.js";
import PayrollRun from "../models/PayrollRun.js";
import School from "../models/School.js";
import StaffAttendance from "../models/StaffAttendance.js";
import StaffLeave from "../models/StaffLeave.js";
import Student from "../models/Student.js";
import StudentAttendance from "../models/StudentAttendance.js";
import StudentLeave from "../models/StudentLeave.js";
import Supervisor from "../models/Supervisor.js";
import {
  canApproveStaffLeave,
  getAttendanceAccess,
  getActorStaff,
  getHqSchool,
  isObjectId,
  loadStaffByRef,
  normalizeRole,
  normalizeScopeType,
  resolveStaffScope,
  resolveStudentScope,
  staffBelongsToScope,
} from "../services/attendanceAccessService.js";
import { validateNotFutureDateKey } from "../utils/dateRules.js";

const STUDENT_STATUSES = new Set(["Present", "Absent", "Leave", "Late", "Half Day", "Holiday", "Weekly Off"]);
const STAFF_STATUSES = new Set(["Present", "Absent", "Leave", "Late", "Half Day", "Holiday", "Weekly Off"]);
const LEAVE_STATUSES = new Set(["Pending", "Approved", "Rejected", "Cancelled"]);
const PAYROLL_STATUSES = new Set(["Draft", "Reviewed", "Finalized", "Paid"]);

const sendError = (res, error) => {
  const status = Number(error?.status || 500);
  if (status >= 500) console.log("[attendance]", error?.stack || error?.message || error);
  return res.status(status).json({
    success: false,
    error: error?.message || "Attendance operation failed.",
  });
};

const cleanText = (value, max = 1000) => String(value ?? "").trim().slice(0, max);

const validDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
const validMonthKey = (value) => /^\d{4}-\d{2}$/.test(String(value || ""));

const requireDateKey = (value, label = "Date") => {
  const key = String(value || "").trim();
  if (!validDateKey(key)) {
    const error = new Error(`${label} must use YYYY-MM-DD format.`);
    error.status = 400;
    throw error;
  }
  return key;
};

const requireAttendanceDateKey = (value, label = "Attendance date") => {
  const key = requireDateKey(value, label);
  const validation = validateNotFutureDateKey(key, label);
  if (!validation.ok) {
    const error = new Error(validation.error);
    error.status = 400;
    throw error;
  }
  return key;
};

const requireMonthKey = (value) => {
  const key = String(value || "").trim();
  if (!validMonthKey(key)) {
    const error = new Error("Month must use YYYY-MM format.");
    error.status = 400;
    throw error;
  }
  return key;
};

const monthRange = (monthKey) => {
  const safe = requireMonthKey(monthKey);
  const [year, month] = safe.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    fromDateKey: `${safe}-01`,
    toDateKey: `${safe}-${String(lastDay).padStart(2, "0")}`,
    lastDay,
  };
};

const enumerateDateKeys = (fromDateKey, toDateKey) => {
  const from = requireDateKey(fromDateKey, "From date");
  const to = requireDateKey(toDateKey, "To date");
  if (from > to) {
    const error = new Error("From date cannot be after To date.");
    error.status = 400;
    throw error;
  }

  const result = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end && result.length <= 370) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (result.length > 370) {
    const error = new Error("Leave duration is too long.");
    error.status = 400;
    throw error;
  }
  return result;
};

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const getCourseQuery = (courseId) => ({
  $or: [1, 2, 3, 4, 5].map((slot) => ({ [`courseId${slot}`]: courseId })),
});

const loadStudentRoster = async ({ schoolId, academicYearId, courseId }) => {
  if (!isObjectId(academicYearId) || !isObjectId(courseId)) {
    const error = new Error("Academic Year and Course are required.");
    error.status = 400;
    throw error;
  }

  const academics = await Academic.find({
    acYear: academicYearId,
    ...getCourseQuery(courseId),
  })
    .select("studentId")
    .lean();

  const studentIds = [...new Set(academics.map((item) => String(item.studentId || "")).filter(Boolean))];
  if (!studentIds.length) return [];

  return Student.find({
    _id: { $in: studentIds },
    schoolId,
    active: "Active",
  })
    .select("_id userId schoolId rollNumber active")
    .populate({ path: "userId", select: "_id name email" })
    .sort({ rollNumber: 1 })
    .lean();
};

const normalizeHqStaffCategory = (value) =>
  String(value || "").trim().toUpperCase() === "MUAVIN" ? "MUAVIN" : "HQ_STAFF";

const loadStaffRoster = async ({
  organizationType,
  schoolId,
  includeInactive = false,
  staffCategory = "ALL",
}) => {
  const category = String(staffCategory || "ALL").trim().toUpperCase();
  const includeEmployees = organizationType !== "HQ" || ["ALL", "HQ_STAFF"].includes(category);
  const includeMuavins = organizationType === "HQ" && ["ALL", "MUAVIN"].includes(category);
  const rows = [];

  if (includeEmployees) {
    const employeeFilter = { schoolId };
    if (!includeInactive) employeeFilter.active = "Active";
    const employees = await Employee.find(employeeFilter)
      .select("_id userId schoolId employeeId designation salary travellingAllowance active")
      .populate({ path: "userId", select: "_id name email role" })
      .sort({ employeeId: 1 })
      .lean();
    rows.push(...employees.map((record) => ({
      staffType: "Employee", staffId: String(record._id),
      userId: String(record.userId?._id || ""), staffCode: record.employeeId,
      name: record.userId?.name || "", email: record.userId?.email || "",
      role: normalizeRole(record.userId?.role), designation: record.designation || "",
      salary: Number(record.salary || 0), travellingAllowance: Number(record.travellingAllowance || 0),
      active: record.active, schoolId: String(record.schoolId || ""),
    })));
  }

  if (includeMuavins) {
    const supervisorFilter = includeInactive ? {} : { active: "Active" };
    const supervisors = await Supervisor.find(supervisorFilter)
      .select("_id userId supervisorId salary travellingAllowance active jobType routeName")
      .populate({ path: "userId", select: "_id name email role" })
      .sort({ supervisorId: 1 })
      .lean();
    rows.push(...supervisors.map((record) => ({
      staffType: "Supervisor", staffId: String(record._id),
      userId: String(record.userId?._id || ""), staffCode: record.supervisorId,
      name: record.userId?.name || "", email: record.userId?.email || "",
      role: normalizeRole(record.userId?.role || "supervisor"), designation: "Muavin",
      salary: Number(record.salary || 0), travellingAllowance: Number(record.travellingAllowance || 0),
      active: record.active, schoolId: String(schoolId || ""),
    })));
  }

  return rows.sort((a, b) => {
    const roleCompare = String(a.role).localeCompare(String(b.role));
    if (roleCompare !== 0) return roleCompare;
    return String(a.name).localeCompare(String(b.name));
  });
};

const getApprovedStudentLeaveMap = async ({ studentIds, dateKey }) => {
  if (!studentIds.length) return new Map();
  const leaves = await StudentLeave.find({
    studentId: { $in: studentIds },
    status: "Approved",
    fromDateKey: { $lte: dateKey },
    toDateKey: { $gte: dateKey },
  })
    .select("_id studentId reason")
    .lean();
  return new Map(leaves.map((leave) => [String(leave.studentId), leave]));
};

const getApprovedStaffLeaveMap = async ({ staffRows, dateKey }) => {
  if (!staffRows.length) return new Map();
  const employeeIds = staffRows.filter((row) => row.staffType === "Employee").map((row) => row.staffId);
  const supervisorIds = staffRows.filter((row) => row.staffType === "Supervisor").map((row) => row.staffId);
  const or = [];
  if (employeeIds.length) or.push({ staffType: "Employee", staffId: { $in: employeeIds } });
  if (supervisorIds.length) or.push({ staffType: "Supervisor", staffId: { $in: supervisorIds } });
  if (!or.length) return new Map();

  const leaves = await StaffLeave.find({
    $or: or,
    status: "Approved",
    fromDateKey: { $lte: dateKey },
    toDateKey: { $gte: dateKey },
  })
    .select("_id staffType staffId leaveType isPaid dayType reason")
    .lean();

  return new Map(leaves.map((leave) => [`${leave.staffType}:${String(leave.staffId)}`, leave]));
};

const assertNoFinalizedStudentAttendanceInRange = async ({ studentId, fromDateKey, toDateKey }) => {
  const finalized = await StudentAttendance.findOne({
    studentId, dateKey: { $gte: fromDateKey, $lte: toDateKey }, isFinalized: true,
  }).select("_id dateKey").lean();
  if (finalized) {
    const error = new Error(`Leave cannot be changed because student attendance for ${finalized.dateKey} is already finalized.`);
    error.status = 409; throw error;
  }
};

const assertNoFinalizedStaffAttendanceInRange = async ({ staffType, staffId, fromDateKey, toDateKey }) => {
  const finalized = await StaffAttendance.findOne({
    staffType, staffId, dateKey: { $gte: fromDateKey, $lte: toDateKey }, isFinalized: true,
  }).select("_id dateKey").lean();
  if (finalized) {
    const error = new Error(`Leave cannot be changed because staff attendance for ${finalized.dateKey} is already finalized.`);
    error.status = 409; throw error;
  }
};

const countStatuses = (rows = []) => {
  const counts = {
    total: rows.length,
    Present: 0,
    Absent: 0,
    Leave: 0,
    Late: 0,
    "Half Day": 0,
    Holiday: 0,
    "Weekly Off": 0,
    "Not Marked": 0,
  };
  rows.forEach((row) => {
    const status = row?.attendance?.status || row?.status || "Not Marked";
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
    else counts["Not Marked"] += 1;
  });
  return counts;
};

export const getAttendanceMeta = async (req, res) => {
  try {
    const access = await getAttendanceAccess(req.user);
    const [academicYears, courses, schools] = await Promise.all([
      AcademicYear.find({}).select("_id acYear active").sort({ acYear: -1 }).lean(),
      Course.find({}).select("_id code name type years").sort({ promotionOrder: 1, code: 1 }).lean(),
      access.isSuperAdmin
        ? School.find({ active: "Active" }).select("_id code nameEnglish active").sort({ code: 1 }).lean()
        : Promise.resolve([]),
    ]);

    let defaultScopeType = "SELF";
    let defaultSchoolId = access.actorSchoolId || "";
    if (access.canManageHqStaff && !access.canManageOwnNiswanStaff) defaultScopeType = "HQ";
    if (access.canManageOwnNiswanStaff || access.canManageOwnNiswanStudents) defaultScopeType = "NISWAN";
    if (access.isSuperAdmin) {
      defaultScopeType = "NISWAN";
      defaultSchoolId = "";
    }

    return res.json({
      success: true,
      access: {
        role: access.role,
        isSuperAdmin: access.isSuperAdmin,
        isHqUser: access.isHqUser,
        isHqAdmin: access.isHqAdmin,
        canManageHqStaff: access.canManageHqStaff,
        canManageOwnNiswanStaff: access.canManageOwnNiswanStaff,
        canManageOwnNiswanStudents: access.canManageOwnNiswanStudents,
        canManageAnyStudents: access.canManageAnyStudents,
        canViewOwnStaffAttendance: access.canViewOwnStaffAttendance,
        canApplyOwnStaffLeave: access.canApplyOwnStaffLeave,
        actorSchoolId: access.actorSchoolId,
        actorStaff: access.actorStaff
          ? {
              staffType: access.actorStaff.staffType,
              staffId: access.actorStaff.staffId,
              userId: access.actorStaff.userId,
              schoolId: access.actorStaff.schoolId,
              role: access.actorStaff.role,
            }
          : null,
      },
      hqSchool: access.hqSchool,
      defaultScopeType,
      defaultSchoolId,
      schools: schools.map((school) => ({
        _id: String(school._id),
        code: school.code,
        nameEnglish: school.nameEnglish,
        active: school.active,
      })),
      academicYears: academicYears.map((year) => ({
        _id: String(year._id),
        acYear: year.acYear,
        active: year.active,
      })),
      courses: courses.map((course) => ({
        _id: String(course._id),
        code: course.code,
        name: course.name,
        type: course.type,
        years: course.years,
      })),
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getStudentRoster = async (req, res) => {
  try {
    const dateKey = requireAttendanceDateKey(req.query.date);
    const { schoolId, school } = await resolveStudentScope({
      user: req.user,
      schoolId: req.query.schoolId,
      requireManage: true,
    });
    const academicYearId = String(req.query.academicYearId || "");
    const courseId = String(req.query.courseId || "");
    const students = await loadStudentRoster({ schoolId, academicYearId, courseId });
    const studentIds = students.map((student) => student._id);

    const [attendanceRecords, leaveMap, finalizedSheetRecord] = await Promise.all([
      StudentAttendance.find({ studentId: { $in: studentIds }, dateKey }).lean(),
      getApprovedStudentLeaveMap({ studentIds, dateKey }),
      StudentAttendance.findOne({ schoolId, academicYearId, courseId, dateKey, isFinalized: true })
        .select("_id").lean(),
    ]);
    const attendanceMap = new Map(attendanceRecords.map((record) => [String(record.studentId), record]));

    const rows = students.map((student) => {
      const id = String(student._id);
      const attendance = attendanceMap.get(id);
      const leave = leaveMap.get(id);
      const effectiveStatus = attendance?.isFinalized
        ? attendance.status
        : leave ? "Leave" : attendance?.status || "Not Marked";
      return {
        studentId: id,
        rollNumber: student.rollNumber,
        name: student.userId?.name || "",
        email: student.userId?.email || "",
        active: student.active,
        approvedLeave: leave
          ? { leaveId: String(leave._id), reason: leave.reason || "" }
          : null,
        attendance: attendance
          ? {
              _id: String(attendance._id),
              status: attendance.status,
              remarks: attendance.remarks || "",
              isFinalized: Boolean(attendance.isFinalized),
            }
          : null,
        status: effectiveStatus,
        remarks: attendance?.remarks || (leave?.reason ? `Approved leave: ${leave.reason}` : ""),
      };
    });

    return res.json({
      success: true,
      school,
      dateKey,
      academicYearId,
      courseId,
      isFinalized: Boolean(finalizedSheetRecord),
      counts: countStatuses(rows),
      students: rows,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const saveStudentAttendance = async (req, res) => {
  try {
    const dateKey = requireAttendanceDateKey(req.body?.date);
    const academicYearId = String(req.body?.academicYearId || "");
    const courseId = String(req.body?.courseId || "");
    if (!isObjectId(academicYearId) || !isObjectId(courseId)) {
      const error = new Error("Academic Year and Course are required.");
      error.status = 400;
      throw error;
    }

    const { schoolId, access } = await resolveStudentScope({
      user: req.user,
      schoolId: req.body?.schoolId,
      requireManage: true,
    });

    const roster = await loadStudentRoster({ schoolId, academicYearId, courseId });
    const rosterMap = new Map(roster.map((student) => [String(student._id), student]));
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      const error = new Error("No student attendance rows were provided.");
      error.status = 400;
      throw error;
    }

    const rawSubmittedIds = rows.map((row) => String(row?.studentId || "")).filter(Boolean);
    const submittedIds = [...new Set(rawSubmittedIds)];
    if (submittedIds.length !== rows.length) {
      const error = new Error("Duplicate or missing student attendance rows were submitted.");
      error.status = 400;
      throw error;
    }
    for (const studentId of submittedIds) {
      if (!rosterMap.has(studentId)) {
        const error = new Error("One or more students are outside the selected Niswan/Course/Academic Year.");
        error.status = 403;
        throw error;
      }
    }

    const finalize = Boolean(req.body?.finalize);
    if (finalize) {
      const rosterIds = roster.map((student) => String(student._id));
      const submittedSet = new Set(submittedIds);
      if (submittedIds.length !== rosterIds.length || rosterIds.some((id) => !submittedSet.has(id))) {
        const error = new Error("Every active student in the selected attendance sheet must be marked before finalizing.");
        error.status = 400; throw error;
      }
    }

    const finalizedRecord = await StudentAttendance.findOne({
      schoolId, academicYearId, courseId, dateKey, isFinalized: true,
    }).select("_id").lean();
    if (finalizedRecord) {
      const error = new Error("Finalized student attendance is locked and cannot be edited.");
      error.status = 409; throw error;
    }

    const leaveMap = await getApprovedStudentLeaveMap({ studentIds: submittedIds, dateKey });
    const operations = [];

    for (const row of rows) {
      const studentId = String(row?.studentId || "");
      if (!rosterMap.has(studentId)) {
        const error = new Error("One or more students are outside the selected Niswan/Course/Academic Year.");
        error.status = 403;
        throw error;
      }

      const approvedLeave = leaveMap.get(studentId);
      const requestedStatus = approvedLeave ? "Leave" : String(row?.status || "");
      if (!STUDENT_STATUSES.has(requestedStatus)) {
        const error = new Error(`Invalid student attendance status: ${requestedStatus}`);
        error.status = 400;
        throw error;
      }

      const setData = {
        studentId,
        schoolId,
        academicYearId,
        courseId,
        dateKey,
        status: requestedStatus,
        remarks: cleanText(row?.remarks, 500),
        markedBy: req.user._id,
        updatedAt: new Date(),
      };

      if (finalize) {
        setData.isFinalized = true;
        setData.finalizedBy = req.user._id;
        setData.finalizedAt = new Date();
      }

      const update = {
        $set: setData,
        $setOnInsert: { createdAt: new Date() },
      };

      operations.push({
        updateOne: {
          filter: { studentId, dateKey },
          update,
          upsert: true,
        },
      });
    }

    if (operations.length) await StudentAttendance.bulkWrite(operations, { ordered: true });

    return res.json({
      success: true,
      message: finalize ? "Student attendance finalized successfully." : "Student attendance saved successfully.",
      savedCount: operations.length,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getStudentMonthlyAttendance = async (req, res) => {
  try {
    const studentId = String(req.query.studentId || "");
    if (!isObjectId(studentId)) {
      const error = new Error("Valid student is required.");
      error.status = 400;
      throw error;
    }
    const monthKey = requireMonthKey(req.query.month);
    const { fromDateKey, toDateKey } = monthRange(monthKey);

    const student = await Student.findById(studentId)
      .select("_id schoolId rollNumber userId")
      .populate({ path: "userId", select: "_id name" })
      .lean();
    if (!student?._id) {
      const error = new Error("Student was not found.");
      error.status = 404;
      throw error;
    }

    await resolveStudentScope({
      user: req.user,
      schoolId: String(student.schoolId),
      requireManage: true,
    });

    const records = await StudentAttendance.find({
      studentId,
      dateKey: { $gte: fromDateKey, $lte: toDateKey },
    })
      .sort({ dateKey: 1 })
      .lean();

    const counts = {
      Present: 0,
      Absent: 0,
      Leave: 0,
      Late: 0,
      "Half Day": 0,
      Holiday: 0,
      "Weekly Off": 0,
    };
    records.forEach((record) => {
      if (Object.prototype.hasOwnProperty.call(counts, record.status)) counts[record.status] += 1;
    });

    const attendanceUnits = counts.Present + counts.Late + counts["Half Day"] * 0.5;
    const workingUnits = counts.Present + counts.Late + counts.Leave + counts.Absent + counts["Half Day"];
    const attendancePercent = workingUnits > 0 ? roundMoney((attendanceUnits / workingUnits) * 100) : 0;

    return res.json({
      success: true,
      student: {
        _id: String(student._id),
        rollNumber: student.rollNumber,
        name: student.userId?.name || "",
      },
      monthKey,
      counts,
      attendancePercent,
      records,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const createStudentLeave = async (req, res) => {
  try {
    const studentId = String(req.body?.studentId || "");
    if (!isObjectId(studentId)) {
      const error = new Error("Please select a valid student.");
      error.status = 400;
      throw error;
    }
    const student = await Student.findById(studentId).select("_id schoolId active").lean();
    if (!student?._id) {
      const error = new Error("Student was not found.");
      error.status = 404;
      throw error;
    }

    const { schoolId } = await resolveStudentScope({
      user: req.user,
      schoolId: String(student.schoolId),
      requireManage: true,
    });

    const fromDateKey = requireDateKey(req.body?.fromDateKey, "From date");
    const toDateKey = requireDateKey(req.body?.toDateKey, "To date");
    enumerateDateKeys(fromDateKey, toDateKey);

    const reason = cleanText(req.body?.reason, 1000);
    if (!reason) {
      const error = new Error("Leave reason is required.");
      error.status = 400;
      throw error;
    }

    const overlapping = await StudentLeave.findOne({
      studentId,
      status: { $in: ["Pending", "Approved"] },
      fromDateKey: { $lte: toDateKey },
      toDateKey: { $gte: fromDateKey },
    }).lean();
    if (overlapping) {
      const error = new Error("An overlapping Pending/Approved student leave already exists.");
      error.status = 409;
      throw error;
    }

    const role = normalizeRole(req.user?.role);
    const autoApprove = ["superadmin", "admin", "teacher", "usthadh"].includes(role);
    if (autoApprove) {
      await assertNoFinalizedStudentAttendanceInRange({ studentId, fromDateKey, toDateKey });
    }

    const leave = await StudentLeave.create({
      studentId,
      schoolId,
      fromDateKey,
      toDateKey,
      reason,
      remarks: cleanText(req.body?.remarks, 1000),
      status: autoApprove ? "Approved" : "Pending",
      requestedBy: req.user._id,
      decidedBy: autoApprove ? req.user._id : undefined,
      decidedAt: autoApprove ? new Date() : undefined,
    });

    return res.status(201).json({
      success: true,
      message: autoApprove ? "Student leave recorded and approved." : "Student leave request created.",
      leave,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const listStudentLeaves = async (req, res) => {
  try {
    const { schoolId } = await resolveStudentScope({
      user: req.user,
      schoolId: req.query.schoolId,
      requireManage: true,
    });

    const filter = { schoolId };
    if (LEAVE_STATUSES.has(String(req.query.status || ""))) filter.status = String(req.query.status);
    if (validMonthKey(req.query.month)) {
      const { fromDateKey, toDateKey } = monthRange(req.query.month);
      filter.fromDateKey = { $lte: toDateKey };
      filter.toDateKey = { $gte: fromDateKey };
    }

    const leaves = await StudentLeave.find(filter)
      .populate({
        path: "studentId",
        select: "_id rollNumber userId",
        populate: { path: "userId", select: "_id name" },
      })
      .populate({ path: "requestedBy", select: "_id name role" })
      .populate({ path: "decidedBy", select: "_id name role" })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    return res.json({ success: true, leaves });
  } catch (error) {
    return sendError(res, error);
  }
};

export const updateStudentLeaveStatus = async (req, res) => {
  try {
    const leaveId = String(req.params.id || "");
    const nextStatus = String(req.body?.status || "");
    if (!isObjectId(leaveId) || !["Approved", "Rejected", "Cancelled"].includes(nextStatus)) {
      const error = new Error("Invalid student leave status update.");
      error.status = 400;
      throw error;
    }

    const leave = await StudentLeave.findById(leaveId);
    if (!leave) {
      const error = new Error("Student leave was not found.");
      error.status = 404;
      throw error;
    }

    await resolveStudentScope({
      user: req.user,
      schoolId: String(leave.schoolId),
      requireManage: true,
    });

    if (nextStatus === "Approved" || (leave.status === "Approved" && nextStatus !== "Approved")) {
      await assertNoFinalizedStudentAttendanceInRange({
        studentId: leave.studentId, fromDateKey: leave.fromDateKey, toDateKey: leave.toDateKey,
      });
    }

    leave.status = nextStatus;
    leave.remarks = cleanText(req.body?.remarks ?? leave.remarks, 1000);
    leave.decidedBy = req.user._id;
    leave.decidedAt = new Date();
    leave.updatedAt = new Date();
    await leave.save();

    return res.json({ success: true, message: `Student leave ${nextStatus.toLowerCase()}.`, leave });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getStaffRoster = async (req, res) => {
  try {
    const dateKey = requireAttendanceDateKey(req.query.date);
    const scope = await resolveStaffScope({
      user: req.user,
      scopeType: req.query.scopeType,
      schoolId: req.query.schoolId,
      requireManage: true,
    });

    const staffCategory =
      scope.organizationType === "HQ" ? normalizeHqStaffCategory(req.query.staffCategory) : "NISWAN_STAFF";
    const staff = await loadStaffRoster({ ...scope, staffCategory });
    const or = staff.map((row) => ({
      staffType: row.staffType,
      staffId: row.staffId,
    }));

    const finalizedFilter = {
      organizationType: scope.organizationType, schoolId: scope.schoolId, dateKey, isFinalized: true,
      ...(scope.organizationType === "HQ"
        ? { staffType: staffCategory === "MUAVIN" ? "Supervisor" : "Employee" }
        : { staffType: "Employee" }),
    };
    const [attendanceRecords, leaveMap, finalizedSheetRecord] = await Promise.all([
      or.length ? StaffAttendance.find({ dateKey, $or: or }).lean() : Promise.resolve([]),
      getApprovedStaffLeaveMap({ staffRows: staff, dateKey }),
      StaffAttendance.findOne(finalizedFilter).select("_id").lean(),
    ]);
    const attendanceMap = new Map(
      attendanceRecords.map((record) => [`${record.staffType}:${String(record.staffId)}`, record])
    );

    const rows = staff.map((row) => {
      const key = `${row.staffType}:${row.staffId}`;
      const attendance = attendanceMap.get(key);
      const leave = leaveMap.get(key);
      const effectiveStatus = attendance?.isFinalized
        ? attendance.status
        : leave
          ? leave.dayType === "Half Day" ? "Half Day" : "Leave"
          : attendance?.status || "Not Marked";
      return {
        ...row,
        approvedLeave: leave
          ? {
              leaveId: String(leave._id),
              leaveType: leave.leaveType,
              isPaid: Boolean(leave.isPaid),
              dayType: leave.dayType,
              reason: leave.reason || "",
            }
          : null,
        attendance: attendance
          ? {
              _id: String(attendance._id),
              status: attendance.status,
              inTime: attendance.inTime || "",
              outTime: attendance.outTime || "",
              remarks: attendance.remarks || "",
              isFinalized: Boolean(attendance.isFinalized),
            }
          : null,
        status: effectiveStatus,
        inTime: attendance?.inTime || "",
        outTime: attendance?.outTime || "",
        remarks: attendance?.remarks || (leave?.reason ? `Approved leave: ${leave.reason}` : ""),
      };
    });

    return res.json({
      success: true,
      scope: {
        organizationType: scope.organizationType,
        schoolId: scope.schoolId,
        school: scope.school,
      },
      dateKey,
      staffCategory,
      isFinalized: Boolean(finalizedSheetRecord),
      counts: countStatuses(rows),
      staff: rows,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const saveStaffAttendance = async (req, res) => {
  try {
    const dateKey = requireAttendanceDateKey(req.body?.date);
    const scope = await resolveStaffScope({
      user: req.user,
      scopeType: req.body?.scopeType,
      schoolId: req.body?.schoolId,
      requireManage: true,
    });

    const staffCategory =
      scope.organizationType === "HQ" ? normalizeHqStaffCategory(req.body?.staffCategory) : "NISWAN_STAFF";
    const roster = await loadStaffRoster({ ...scope, staffCategory });
    const rosterMap = new Map(roster.map((row) => [`${row.staffType}:${row.staffId}`, row]));
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      const error = new Error("No staff attendance rows were provided.");
      error.status = 400;
      throw error;
    }

    const submittedKeys = rows.map((row) => `${String(row?.staffType || "")}:${String(row?.staffId || "")}`);
    if (new Set(submittedKeys).size !== rows.length) {
      const error = new Error("Duplicate or missing staff attendance rows were submitted.");
      error.status = 400; throw error;
    }
    const finalize = Boolean(req.body?.finalize);
    if (finalize) {
      const rosterKeys = [...rosterMap.keys()];
      const submittedSet = new Set(submittedKeys);
      if (submittedKeys.length !== rosterKeys.length || rosterKeys.some((key) => !submittedSet.has(key))) {
        const error = new Error("Every active staff member in the selected attendance sheet must be marked before finalizing.");
        error.status = 400; throw error;
      }
    }
    const finalizedRecord = await StaffAttendance.findOne({
      organizationType: scope.organizationType, schoolId: scope.schoolId, dateKey, isFinalized: true,
      ...(scope.organizationType === "HQ"
        ? { staffType: staffCategory === "MUAVIN" ? "Supervisor" : "Employee" }
        : { staffType: "Employee" }),
    }).select("_id").lean();
    if (finalizedRecord) {
      const error = new Error("Finalized staff attendance is locked and cannot be edited.");
      error.status = 409; throw error;
    }
    const leaveMap = await getApprovedStaffLeaveMap({ staffRows: roster, dateKey });
    const operations = [];

    for (const row of rows) {
      const staffType = String(row?.staffType || "");
      const staffId = String(row?.staffId || "");
      const key = `${staffType}:${staffId}`;
      const staff = rosterMap.get(key);
      if (!staff) {
        const error = new Error("One or more staff records are outside the selected Attendance scope.");
        error.status = 403;
        throw error;
      }

      const approvedLeave = leaveMap.get(key);
      const requestedStatus = approvedLeave
        ? approvedLeave.dayType === "Half Day"
          ? "Half Day"
          : "Leave"
        : String(row?.status || "");
      if (!STAFF_STATUSES.has(requestedStatus)) {
        const error = new Error(`Invalid staff attendance status: ${requestedStatus}`);
        error.status = 400;
        throw error;
      }

      const setData = {
        staffType,
        staffId,
        userId: staff.userId,
        schoolId: scope.schoolId,
        organizationType: scope.organizationType,
        dateKey,
        status: requestedStatus,
        inTime: cleanText(row?.inTime, 20),
        outTime: cleanText(row?.outTime, 20),
        remarks: cleanText(row?.remarks, 500),
        markedBy: req.user._id,
        updatedAt: new Date(),
      };
      if (finalize) {
        setData.isFinalized = true;
        setData.finalizedBy = req.user._id;
        setData.finalizedAt = new Date();
      }

      const update = {
        $set: setData,
        $setOnInsert: { createdAt: new Date() },
      };
      operations.push({
        updateOne: {
          filter: { staffType, staffId, dateKey },
          update,
          upsert: true,
        },
      });
    }

    if (operations.length) await StaffAttendance.bulkWrite(operations, { ordered: true });

    return res.json({
      success: true,
      message: finalize ? "Staff attendance finalized successfully." : "Staff attendance saved successfully.",
      savedCount: operations.length,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getMyStaffAttendance = async (req, res) => {
  try {
    const monthKey = requireMonthKey(req.query.month);
    const { fromDateKey, toDateKey } = monthRange(monthKey);
    const actor = await getActorStaff(req.user);
    if (!actor?.staffId) {
      const error = new Error("Your login is not linked to a staff record.");
      error.status = 403;
      throw error;
    }

    const records = await StaffAttendance.find({
      staffType: actor.staffType,
      staffId: actor.staffId,
      dateKey: { $gte: fromDateKey, $lte: toDateKey },
    })
      .sort({ dateKey: 1 })
      .lean();

    return res.json({
      success: true,
      staff: {
        staffType: actor.staffType,
        staffId: actor.staffId,
        role: actor.role,
      },
      monthKey,
      counts: countStatuses(records.map((record) => ({ status: record.status }))),
      records,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getStaffMonthlyAttendance = async (req, res) => {
  try {
    const staffType = String(req.query.staffType || "");
    const staffId = String(req.query.staffId || "");
    const monthKey = requireMonthKey(req.query.month);
    if (!["Employee", "Supervisor"].includes(staffType) || !isObjectId(staffId)) {
      const error = new Error("Valid staff member is required.");
      error.status = 400;
      throw error;
    }

    const staff = await loadStaffByRef({ staffType, staffId });
    if (!staff) {
      const error = new Error("Staff record was not found.");
      error.status = 404;
      throw error;
    }

    const hq = await getHqSchool();
    const organizationType =
      staff.staffType === "Supervisor" || String(staff.schoolId || "") === String(hq?._id || "")
        ? "HQ"
        : "NISWAN";
    const schoolId = organizationType === "HQ" ? String(hq?._id || "") : String(staff.schoolId || "");

    const scope = await resolveStaffScope({
      user: req.user,
      scopeType: organizationType,
      schoolId,
      requireManage: true,
    });
    if (!(await staffBelongsToScope({ staff, organizationType: scope.organizationType, schoolId: scope.schoolId }))) {
      const error = new Error("Staff member is outside your authorized Attendance scope.");
      error.status = 403;
      throw error;
    }

    const { fromDateKey, toDateKey } = monthRange(monthKey);
    const records = await StaffAttendance.find({
      staffType,
      staffId,
      dateKey: { $gte: fromDateKey, $lte: toDateKey },
    })
      .sort({ dateKey: 1 })
      .lean();

    return res.json({
      success: true,
      monthKey,
      staff: {
        staffType,
        staffId,
        name: staff.record?.userId?.name || "",
        role: staff.role,
      },
      counts: countStatuses(records.map((record) => ({ status: record.status }))),
      records,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const createMyStaffLeave = async (req, res) => {
  try {
    const actor = await getActorStaff(req.user);
    if (!actor?.staffId || String(actor.active || "").toLowerCase() !== "active") {
      const error = new Error("Your login is not linked to an active staff record.");
      error.status = 403;
      throw error;
    }

    const hq = await getHqSchool();
    const organizationType =
      actor.staffType === "Supervisor" || String(actor.schoolId || "") === String(hq?._id || "")
        ? "HQ"
        : "NISWAN";
    const schoolId = organizationType === "HQ" ? hq?._id : actor.schoolId;
    if (!schoolId) {
      const error = new Error("Unable to resolve your Attendance organization.");
      error.status = 400;
      throw error;
    }

    const fromDateKey = requireDateKey(req.body?.fromDateKey, "From date");
    const toDateKey = requireDateKey(req.body?.toDateKey, "To date");
    enumerateDateKeys(fromDateKey, toDateKey);

    const dayType = req.body?.dayType === "Half Day" ? "Half Day" : "Full Day";
    if (dayType === "Half Day" && fromDateKey !== toDateKey) {
      const error = new Error("Half Day leave must use the same From and To date.");
      error.status = 400;
      throw error;
    }

    await assertNoFinalizedStaffAttendanceInRange({
      staffType: actor.staffType, staffId: actor.staffId, fromDateKey, toDateKey,
    });

    const leaveType = cleanText(req.body?.leaveType, 100);
    const reason = cleanText(req.body?.reason, 1000);
    if (!leaveType || !reason) {
      const error = new Error("Leave Type and Reason are required.");
      error.status = 400;
      throw error;
    }

    const overlapping = await StaffLeave.findOne({
      staffType: actor.staffType,
      staffId: actor.staffId,
      status: { $in: ["Pending", "Approved"] },
      fromDateKey: { $lte: toDateKey },
      toDateKey: { $gte: fromDateKey },
    }).lean();
    if (overlapping) {
      const error = new Error("An overlapping Pending/Approved leave already exists.");
      error.status = 409;
      throw error;
    }

    const leave = await StaffLeave.create({
      staffType: actor.staffType,
      staffId: actor.staffId,
      userId: actor.userId,
      schoolId,
      organizationType,
      leaveType,
      isPaid: true,
      fromDateKey,
      toDateKey,
      dayType,
      reason,
      remarks: cleanText(req.body?.remarks, 1000),
      status: normalizeRole(req.user?.role) === "superadmin" ? "Approved" : "Pending",
      requestedBy: req.user._id,
      decidedBy: normalizeRole(req.user?.role) === "superadmin" ? req.user._id : undefined,
      decidedAt: normalizeRole(req.user?.role) === "superadmin" ? new Date() : undefined,
    });

    return res.status(201).json({
      success: true,
      message:
        normalizeRole(req.user?.role) === "superadmin"
          ? "Leave recorded successfully."
          : "Leave application submitted successfully.",
      leave,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const listMyStaffLeaves = async (req, res) => {
  try {
    const actor = await getActorStaff(req.user);
    if (!actor?.staffId) {
      const error = new Error("Your login is not linked to a staff record.");
      error.status = 403;
      throw error;
    }

    const leaves = await StaffLeave.find({
      staffType: actor.staffType,
      staffId: actor.staffId,
    })
      .populate({ path: "decidedBy", select: "_id name role" })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.json({ success: true, leaves });
  } catch (error) {
    return sendError(res, error);
  }
};

export const listStaffLeaveApprovals = async (req, res) => {
  try {
    const access = await getAttendanceAccess(req.user);
    const role = access.role;
    if (!(access.isSuperAdmin || access.canManageHqStaff || access.canManageOwnNiswanStaff)) {
      const error = new Error("You are not authorized to approve staff leave.");
      error.status = 403;
      throw error;
    }

    const filter = {};
    if (String(req.query.status || "")) {
      const status = String(req.query.status);
      if (LEAVE_STATUSES.has(status)) filter.status = status;
    } else {
      filter.status = "Pending";
    }

    if (!access.isSuperAdmin) {
      if (access.canManageHqStaff && !access.canManageOwnNiswanStaff) {
        filter.organizationType = "HQ";
      } else if (access.canManageOwnNiswanStaff) {
        filter.organizationType = "NISWAN";
        filter.schoolId = access.actorSchoolId;
      }
    } else {
      const scopeType = String(req.query.scopeType || "").toUpperCase();
      if (scopeType === "HQ") filter.organizationType = "HQ";
      if (scopeType === "NISWAN") {
        filter.organizationType = "NISWAN";
        if (isObjectId(req.query.schoolId)) filter.schoolId = req.query.schoolId;
      }
    }

    let leaves = await StaffLeave.find(filter)
      .populate({ path: "userId", select: "_id name email role" })
      .populate({ path: "requestedBy", select: "_id name role" })
      .populate({ path: "decidedBy", select: "_id name role" })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    // Admin leave is escalated to SuperAdmin, and nobody should receive
    // their own request in the approval queue.
    leaves = leaves.filter((leave) => {
      if (String(leave.userId?._id || leave.userId || "") === String(req.user?._id || "")) return false;
      if (!access.isSuperAdmin && normalizeRole(leave.userId?.role) === "admin") return false;
      return true;
    });

    return res.json({ success: true, leaves });
  } catch (error) {
    return sendError(res, error);
  }
};

export const updateStaffLeaveStatus = async (req, res) => {
  try {
    const leaveId = String(req.params.id || "");
    const nextStatus = String(req.body?.status || "");
    if (!isObjectId(leaveId) || !["Approved", "Rejected", "Cancelled"].includes(nextStatus)) {
      const error = new Error("Invalid staff leave status update.");
      error.status = 400;
      throw error;
    }

    const leave = await StaffLeave.findById(leaveId);
    if (!leave) {
      const error = new Error("Staff leave was not found.");
      error.status = 404;
      throw error;
    }

    if (nextStatus === "Cancelled") {
      if (String(leave.userId) !== String(req.user?._id)) {
        const allowed = await canApproveStaffLeave({ approverUser: req.user, leave });
        if (!allowed) {
          const error = new Error("You are not authorized to cancel this staff leave.");
          error.status = 403;
          throw error;
        }
      }
    } else {
      const allowed = await canApproveStaffLeave({ approverUser: req.user, leave });
      if (!allowed) {
        const error = new Error("You are not authorized to approve/reject this staff leave.");
        error.status = 403;
        throw error;
      }
    }

    if (nextStatus === "Approved" || (leave.status === "Approved" && nextStatus !== "Approved")) {
      await assertNoFinalizedStaffAttendanceInRange({
        staffType: leave.staffType, staffId: leave.staffId,
        fromDateKey: leave.fromDateKey, toDateKey: leave.toDateKey,
      });
    }

    if (["Approved", "Rejected"].includes(nextStatus)) {
      leave.isPaid = req.body?.isPaid !== undefined ? Boolean(req.body.isPaid) : leave.isPaid;
      leave.decidedBy = req.user._id;
      leave.decidedAt = new Date();
    }

    leave.status = nextStatus;
    leave.remarks = cleanText(req.body?.remarks ?? leave.remarks, 1000);
    leave.updatedAt = new Date();
    await leave.save();

    return res.json({ success: true, message: `Staff leave ${nextStatus.toLowerCase()}.`, leave });
  } catch (error) {
    return sendError(res, error);
  }
};

const getApprovedLeaveUnitsByDate = async ({ staffType, staffId, fromDateKey, toDateKey }) => {
  const leaves = await StaffLeave.find({
    staffType,
    staffId,
    status: "Approved",
    fromDateKey: { $lte: toDateKey },
    toDateKey: { $gte: fromDateKey },
  })
    .select("fromDateKey toDateKey dayType isPaid")
    .lean();

  const byDate = new Map();
  leaves.forEach((leave) => {
    const dates = enumerateDateKeys(
      leave.fromDateKey < fromDateKey ? fromDateKey : leave.fromDateKey,
      leave.toDateKey > toDateKey ? toDateKey : leave.toDateKey
    );
    const unit = leave.dayType === "Half Day" ? 0.5 : 1;
    dates.forEach((date) => {
      const previous = byDate.get(date);
      // Overlaps are prevented on application; max keeps historical/legacy duplicates safe.
      if (!previous || unit > previous.unit) {
        byDate.set(date, { unit, isPaid: Boolean(leave.isPaid) });
      }
    });
  });
  return byDate;
};

export const listPayrollRuns = async (req, res) => {
  try {
    const monthKey = requireMonthKey(req.query.month);
    const scope = await resolveStaffScope({
      user: req.user,
      scopeType: req.query.scopeType,
      schoolId: req.query.schoolId,
      requireManage: true,
    });

    const run = await PayrollRun.findOne({
      monthKey,
      organizationType: scope.organizationType,
      schoolId: scope.schoolId,
    }).lean();

    return res.json({ success: true, run });
  } catch (error) {
    return sendError(res, error);
  }
};

export const generatePayroll = async (req, res) => {
  try {
    const monthKey = requireMonthKey(req.body?.month);
    const workingDays = Number(req.body?.workingDays);
    if (!Number.isInteger(workingDays) || workingDays < 1 || workingDays > 31) {
      const error = new Error("Working Days must be between 1 and 31.");
      error.status = 400;
      throw error;
    }

    const scope = await resolveStaffScope({
      user: req.user,
      scopeType: req.body?.scopeType,
      schoolId: req.body?.schoolId,
      requireManage: true,
    });
    const { fromDateKey, toDateKey } = monthRange(monthKey);
    const staff = await loadStaffRoster({ ...scope, includeInactive: false });
    const existing = await PayrollRun.findOne({
      monthKey,
      organizationType: scope.organizationType,
      schoolId: scope.schoolId,
    });
    if (existing && ["Finalized", "Paid"].includes(existing.status)) {
      const error = new Error("Finalized/Paid payroll cannot be regenerated.");
      error.status = 409;
      throw error;
    }

    const items = [];
    for (const row of staff) {
      const attendance = await StaffAttendance.find({
        staffType: row.staffType,
        staffId: row.staffId,
        dateKey: { $gte: fromDateKey, $lte: toDateKey },
        status: { $nin: ["Holiday", "Weekly Off"] },
      })
        .select("status dateKey")
        .lean();

      const approvedLeaveByDate = await getApprovedLeaveUnitsByDate({
        staffType: row.staffType,
        staffId: row.staffId,
        fromDateKey,
        toDateKey,
      });

      const attendanceByDate = new Map(attendance.map((record) => [record.dateKey, record]));
      let absentUnits = 0;
      let halfDayUnits = 0;
      attendance.forEach((record) => {
        const approvedLeave = approvedLeaveByDate.get(record.dateKey);
        if (record.status === "Absent") absentUnits += 1;
        // A Half Day generated by approved leave is handled by leave paid/unpaid rules below.
        if (record.status === "Half Day" && !approvedLeave) halfDayUnits += 0.5;
      });

      let unpaidLeaveUnits = 0;
      approvedLeaveByDate.forEach((leave, dateKey) => {
        const attendanceRecord = attendanceByDate.get(dateKey);
        if (!attendanceRecord) return;
        if (!["Leave", "Half Day"].includes(attendanceRecord.status)) return;
        if (!leave.isPaid) unpaidLeaveUnits += Number(leave.unit || 0);
      });

      // Missing/unmarked days are flagged by attendanceRecordedDays and are never silently
      // treated as absence. Approved paid leave has no deduction; approved unpaid leave does.
      const deductionUnits = Math.min(workingDays, absentUnits + halfDayUnits + unpaidLeaveUnits);
      const payableDays = Math.max(0, workingDays - deductionUnits);
      const monthlySalary = Number(row.salary || 0);
      const travellingAllowance = Number(row.travellingAllowance || 0);
      const grossSalary = monthlySalary + travellingAllowance;
      const attendanceDeduction =
        workingDays > 0 ? roundMoney((grossSalary / workingDays) * deductionUnits) : 0;
      const netSalary = roundMoney(grossSalary - attendanceDeduction);

      items.push({
        staffType: row.staffType,
        staffId: row.staffId,
        userId: row.userId,
        staffCode: row.staffCode,
        name: row.name,
        role: row.role,
        monthlySalary,
        travellingAllowance,
        grossSalary: roundMoney(grossSalary),
        workingDays,
        attendanceRecordedDays: attendance.length,
        absentUnits,
        halfDayUnits,
        unpaidLeaveUnits,
        payableDays,
        attendanceDeduction,
        manualAllowance: 0,
        manualDeduction: 0,
        netSalary,
      });
    }

    const run = await PayrollRun.findOneAndUpdate(
      {
        monthKey,
        organizationType: scope.organizationType,
        schoolId: scope.schoolId,
      },
      {
        $set: {
          workingDays,
          status: existing?.status === "Reviewed" ? "Reviewed" : "Draft",
          items,
          generatedBy: req.user._id,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, new: true }
    );

    return res.json({
      success: true,
      message: "Payroll draft generated. Review attendance coverage and adjustments before finalizing.",
      run,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const updatePayrollItem = async (req, res) => {
  try {
    const runId = String(req.params.id || "");
    const itemId = String(req.params.itemId || "");
    if (!isObjectId(runId) || !isObjectId(itemId)) {
      const error = new Error("Invalid payroll item.");
      error.status = 400;
      throw error;
    }

    const run = await PayrollRun.findById(runId);
    if (!run) {
      const error = new Error("Payroll run was not found.");
      error.status = 404;
      throw error;
    }
    if (["Finalized", "Paid"].includes(run.status)) {
      const error = new Error("Finalized/Paid payroll cannot be edited.");
      error.status = 409;
      throw error;
    }

    await resolveStaffScope({
      user: req.user,
      scopeType: run.organizationType,
      schoolId: String(run.schoolId || ""),
      requireManage: true,
    });

    const item = run.items.id(itemId);
    if (!item) {
      const error = new Error("Payroll item was not found.");
      error.status = 404;
      throw error;
    }

    item.manualAllowance = Math.max(0, Number(req.body?.manualAllowance || 0));
    item.manualDeduction = Math.max(0, Number(req.body?.manualDeduction || 0));
    item.remarks = cleanText(req.body?.remarks, 1000);
    item.netSalary = roundMoney(
      Number(item.grossSalary || 0) -
        Number(item.attendanceDeduction || 0) +
        Number(item.manualAllowance || 0) -
        Number(item.manualDeduction || 0)
    );

    run.updatedAt = new Date();
    await run.save();

    return res.json({ success: true, message: "Payroll adjustment updated.", run });
  } catch (error) {
    return sendError(res, error);
  }
};

export const updatePayrollStatus = async (req, res) => {
  try {
    const runId = String(req.params.id || "");
    const nextStatus = String(req.body?.status || "");
    if (!isObjectId(runId) || !PAYROLL_STATUSES.has(nextStatus)) {
      const error = new Error("Invalid payroll status.");
      error.status = 400;
      throw error;
    }

    const run = await PayrollRun.findById(runId);
    if (!run) {
      const error = new Error("Payroll run was not found.");
      error.status = 404;
      throw error;
    }

    await resolveStaffScope({
      user: req.user,
      scopeType: run.organizationType,
      schoolId: String(run.schoolId || ""),
      requireManage: true,
    });

    const allowedTransitions = {
      Draft: new Set(["Draft", "Reviewed"]),
      Reviewed: new Set(["Reviewed", "Draft", "Finalized"]),
      Finalized: new Set(["Finalized", "Paid"]),
      Paid: new Set(["Paid"]),
    };
    if (!allowedTransitions[run.status]?.has(nextStatus)) {
      const error = new Error(`Payroll cannot move from ${run.status} to ${nextStatus}.`);
      error.status = 409;
      throw error;
    }

    if (nextStatus === "Finalized") {
      run.finalizedBy = req.user._id;
      run.finalizedAt = new Date();
    }
    if (nextStatus === "Paid") {
      if (run.status !== "Finalized" && run.status !== "Paid") {
        const error = new Error("Payroll must be finalized before marking it paid.");
        error.status = 409;
        throw error;
      }
      run.paidBy = req.user._id;
      run.paidAt = req.body?.paidAt ? new Date(req.body.paidAt) : new Date();
      run.paymentMethod = cleanText(req.body?.paymentMethod, 100);
      run.paymentReference = cleanText(req.body?.paymentReference, 200);
    }
    if (nextStatus === "Reviewed") run.reviewedBy = req.user._id;

    run.status = nextStatus;
    run.remarks = cleanText(req.body?.remarks ?? run.remarks, 1000);
    run.updatedAt = new Date();
    await run.save();

    return res.json({ success: true, message: `Payroll status updated to ${nextStatus}.`, run });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getAttendanceOverview = async (req, res) => {
  try {
    const dateKey = requireAttendanceDateKey(req.query.date);
    const access = await getAttendanceAccess(req.user);
    const result = {
      dateKey,
      student: null,
      staff: null,
      pendingStaffLeaveApprovals: 0,
    };

    const schoolId = String(req.query.schoolId || "");
    const scopeType = normalizeScopeType(req.query.scopeType);

    if (access.canManageAnyStudents || access.canManageOwnNiswanStudents) {
      try {
        const studentScope = await resolveStudentScope({ user: req.user, schoolId, requireManage: true });
        const studentQuery = { schoolId: studentScope.schoolId, active: "Active" };
        const activeStudents = await Student.find(studentQuery).select("_id").lean();
        const studentIds = activeStudents.map((student) => student._id);
        const [records, leaveMap] = await Promise.all([
          StudentAttendance.find({
            studentId: { $in: studentIds },
            dateKey,
          })
            .select("studentId status")
            .lean(),
          getApprovedStudentLeaveMap({ studentIds, dateKey }),
        ]);
        const attendanceMap = new Map(records.map((record) => [String(record.studentId), record.status]));
        const rows = activeStudents.map((student) => {
          const id = String(student._id);
          return {
            status: leaveMap.has(id) ? "Leave" : attendanceMap.get(id) || "Not Marked",
          };
        });
        const counts = countStatuses(rows);
        result.student = { school: studentScope.school, counts };
      } catch (error) {
        if (error?.status !== 403 && error?.status !== 400) throw error;
      }
    }

    if (access.canManageHqStaff || access.canManageOwnNiswanStaff || access.isSuperAdmin) {
      try {
        const staffScope = await resolveStaffScope({
          user: req.user,
          scopeType,
          schoolId,
          requireManage: true,
        });
        const roster = await loadStaffRoster(staffScope);
        const or = roster.map((row) => ({ staffType: row.staffType, staffId: row.staffId }));
        const [records, leaveMap] = await Promise.all([
          or.length
            ? StaffAttendance.find({ dateKey, $or: or }).select("staffType staffId status").lean()
            : Promise.resolve([]),
          getApprovedStaffLeaveMap({ staffRows: roster, dateKey }),
        ]);
        const attendanceMap = new Map(
          records.map((record) => [`${record.staffType}:${String(record.staffId)}`, record.status])
        );
        const rows = roster.map((row) => {
          const key = `${row.staffType}:${row.staffId}`;
          const leave = leaveMap.get(key);
          return {
            status: leave
              ? leave.dayType === "Half Day"
                ? "Half Day"
                : "Leave"
              : attendanceMap.get(key) || "Not Marked",
          };
        });
        const counts = countStatuses(rows);
        result.staff = {
          scope: {
            organizationType: staffScope.organizationType,
            schoolId: staffScope.schoolId,
            school: staffScope.school,
          },
          counts,
        };
      } catch (error) {
        if (error?.status !== 403 && error?.status !== 400) throw error;
      }
    }

    if (access.isSuperAdmin) {
      result.pendingStaffLeaveApprovals = await StaffLeave.countDocuments({ status: "Pending" });
    } else if (access.canManageHqStaff) {
      result.pendingStaffLeaveApprovals = await StaffLeave.countDocuments({
        status: "Pending",
        organizationType: "HQ",
      });
    } else if (access.canManageOwnNiswanStaff) {
      result.pendingStaffLeaveApprovals = await StaffLeave.countDocuments({
        status: "Pending",
        organizationType: "NISWAN",
        schoolId: access.actorSchoolId,
      });
    }

    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getMonthlyAttendanceReport = async (req, res) => {
  try {
    const monthKey = requireMonthKey(req.query.month);
    const kind = String(req.query.kind || "staff").toLowerCase();
    const { fromDateKey, toDateKey } = monthRange(monthKey);

    if (kind === "student") {
      const scope = await resolveStudentScope({
        user: req.user,
        schoolId: req.query.schoolId,
        requireManage: true,
      });

      const records = await StudentAttendance.find({
        schoolId: scope.schoolId,
        dateKey: { $gte: fromDateKey, $lte: toDateKey },
      })
        .populate({
          path: "studentId",
          select: "_id rollNumber userId",
          populate: { path: "userId", select: "_id name" },
        })
        .lean();

      const map = new Map();
      records.forEach((record) => {
        const id = String(record.studentId?._id || record.studentId || "");
        if (!id) return;
        if (!map.has(id)) {
          map.set(id, {
            studentId: id,
            rollNumber: record.studentId?.rollNumber || "",
            name: record.studentId?.userId?.name || "",
            Present: 0,
            Absent: 0,
            Leave: 0,
            Late: 0,
            "Half Day": 0,
            totalMarked: 0,
          });
        }
        const row = map.get(id);
        if (Object.prototype.hasOwnProperty.call(row, record.status)) row[record.status] += 1;
        row.totalMarked += 1;
      });

      const rows = [...map.values()].map((row) => {
        const presentUnits = row.Present + row.Late + row["Half Day"] * 0.5;
        const workingUnits = row.Present + row.Late + row.Leave + row.Absent + row["Half Day"];
        return {
          ...row,
          attendancePercent: workingUnits > 0 ? roundMoney((presentUnits / workingUnits) * 100) : 0,
        };
      });

      return res.json({ success: true, kind: "student", monthKey, school: scope.school, rows });
    }

    const scope = await resolveStaffScope({
      user: req.user,
      scopeType: req.query.scopeType,
      schoolId: req.query.schoolId,
      requireManage: true,
    });
    const roster = await loadStaffRoster(scope);
    const or = roster.map((row) => ({ staffType: row.staffType, staffId: row.staffId }));
    const records = or.length
      ? await StaffAttendance.find({
          dateKey: { $gte: fromDateKey, $lte: toDateKey },
          $or: or,
        }).lean()
      : [];

    const rosterMap = new Map(roster.map((row) => [`${row.staffType}:${row.staffId}`, row]));
    const reportMap = new Map();
    roster.forEach((staff) => {
      const key = `${staff.staffType}:${staff.staffId}`;
      reportMap.set(key, {
        staffType: staff.staffType,
        staffId: staff.staffId,
        staffCode: staff.staffCode,
        name: staff.name,
        role: staff.role,
        Present: 0,
        Absent: 0,
        Leave: 0,
        Late: 0,
        "Half Day": 0,
        Holiday: 0,
        "Weekly Off": 0,
        totalMarked: 0,
      });
    });
    records.forEach((record) => {
      const key = `${record.staffType}:${String(record.staffId)}`;
      if (!rosterMap.has(key) || !reportMap.has(key)) return;
      const row = reportMap.get(key);
      if (Object.prototype.hasOwnProperty.call(row, record.status)) row[record.status] += 1;
      row.totalMarked += 1;
    });

    return res.json({
      success: true,
      kind: "staff",
      monthKey,
      scope: {
        organizationType: scope.organizationType,
        schoolId: scope.schoolId,
        school: scope.school,
      },
      rows: [...reportMap.values()],
    });
  } catch (error) {
    return sendError(res, error);
  }
};
