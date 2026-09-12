import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";
import {
  createMyStaffLeave,
  createStudentLeave,
  generatePayroll,
  getAttendanceMeta,
  getAttendanceOverview,
  getMonthlyAttendanceReport,
  getMyStaffAttendance,
  getStaffMonthlyAttendance,
  getStaffRoster,
  getStudentMonthlyAttendance,
  getStudentRoster,
  listMyStaffLeaves,
  listPayrollRuns,
  listStaffLeaveApprovals,
  listStudentLeaves,
  saveStaffAttendance,
  saveStudentAttendance,
  updatePayrollItem,
  updatePayrollStatus,
  updateStaffLeaveStatus,
  updateStudentLeaveStatus,
} from "../controllers/attendanceController.js";
import { auditMutation } from "../middleware/auditMiddleware.js";

const router = express.Router();

router.get("/meta", authMiddleware, getAttendanceMeta);
router.get("/overview", authMiddleware, getAttendanceOverview);

router.get("/student/roster", authMiddleware, getStudentRoster);
router.post(
  "/student/bulk",
  authMiddleware,
  auditMutation({ action: "STUDENT_ATTENDANCE_SAVE", resourceType: "StudentAttendance" }),
  saveStudentAttendance
);
router.get("/student/monthly", authMiddleware, getStudentMonthlyAttendance);

router.get("/student-leaves", authMiddleware, listStudentLeaves);
router.post(
  "/student-leaves",
  authMiddleware,
  auditMutation({ action: "STUDENT_LEAVE_CREATE", resourceType: "StudentLeave" }),
  createStudentLeave
);
router.patch(
  "/student-leaves/:id/status",
  authMiddleware,
  auditMutation({ action: "STUDENT_LEAVE_STATUS", resourceType: "StudentLeave" }),
  updateStudentLeaveStatus
);

router.get("/staff/roster", authMiddleware, getStaffRoster);
router.post(
  "/staff/bulk",
  authMiddleware,
  auditMutation({ action: "STAFF_ATTENDANCE_SAVE", resourceType: "StaffAttendance" }),
  saveStaffAttendance
);
router.get("/staff/monthly", authMiddleware, getStaffMonthlyAttendance);
router.get("/staff/my-monthly", authMiddleware, getMyStaffAttendance);

router.get("/staff-leaves/mine", authMiddleware, listMyStaffLeaves);
router.post(
  "/staff-leaves/mine",
  authMiddleware,
  auditMutation({ action: "STAFF_LEAVE_APPLY", resourceType: "StaffLeave" }),
  createMyStaffLeave
);
router.get("/staff-leaves/approvals", authMiddleware, listStaffLeaveApprovals);
router.patch(
  "/staff-leaves/:id/status",
  authMiddleware,
  auditMutation({ action: "STAFF_LEAVE_STATUS", resourceType: "StaffLeave" }),
  updateStaffLeaveStatus
);

router.get("/payroll", authMiddleware, listPayrollRuns);
router.post(
  "/payroll/generate",
  authMiddleware,
  auditMutation({ action: "PAYROLL_GENERATE", resourceType: "PayrollRun" }),
  generatePayroll
);
router.patch(
  "/payroll/:id/items/:itemId",
  authMiddleware,
  auditMutation({ action: "PAYROLL_ADJUST", resourceType: "PayrollRun" }),
  updatePayrollItem
);
router.patch(
  "/payroll/:id/status",
  authMiddleware,
  auditMutation({ action: "PAYROLL_STATUS", resourceType: "PayrollRun" }),
  updatePayrollStatus
);

router.get("/reports/monthly", authMiddleware, getMonthlyAttendanceReport);

export default router;
