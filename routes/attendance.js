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
import { PERMISSIONS } from "../config/permissionCatalog.js";
import { requirePermission } from "../middleware/permissionMiddleware.js";

const router = express.Router();

router.get("/meta", authMiddleware, getAttendanceMeta);
router.get("/overview", authMiddleware, getAttendanceOverview);

router.get("/student/roster", authMiddleware, requirePermission(PERMISSIONS.STUDENT_ATTENDANCE_VIEW), getStudentRoster);
router.post(
  "/student/bulk",
  authMiddleware,
  requirePermission(PERMISSIONS.STUDENT_ATTENDANCE_ENTER),
  auditMutation({ action: "STUDENT_ATTENDANCE_SAVE", resourceType: "StudentAttendance" }),
  saveStudentAttendance
);
router.get("/student/monthly", authMiddleware, requirePermission(PERMISSIONS.STUDENT_ATTENDANCE_VIEW), getStudentMonthlyAttendance);

router.get("/student-leaves", authMiddleware, requirePermission(PERMISSIONS.STUDENT_LEAVE_VIEW), listStudentLeaves);
router.post(
  "/student-leaves",
  authMiddleware,
  requirePermission(PERMISSIONS.STUDENT_LEAVE_MANAGE),
  auditMutation({ action: "STUDENT_LEAVE_CREATE", resourceType: "StudentLeave" }),
  createStudentLeave
);
router.patch(
  "/student-leaves/:id/status",
  authMiddleware,
  requirePermission(PERMISSIONS.STUDENT_LEAVE_MANAGE),
  auditMutation({ action: "STUDENT_LEAVE_STATUS", resourceType: "StudentLeave" }),
  updateStudentLeaveStatus
);

router.get("/staff/roster", authMiddleware, requirePermission(PERMISSIONS.STAFF_ATTENDANCE_VIEW), getStaffRoster);
router.post(
  "/staff/bulk",
  authMiddleware,
  requirePermission(PERMISSIONS.STAFF_ATTENDANCE_ENTER),
  auditMutation({ action: "STAFF_ATTENDANCE_SAVE", resourceType: "StaffAttendance" }),
  saveStaffAttendance
);
router.get("/staff/monthly", authMiddleware, requirePermission(PERMISSIONS.STAFF_ATTENDANCE_VIEW), getStaffMonthlyAttendance);
router.get("/staff/my-monthly", authMiddleware, requirePermission(PERMISSIONS.STAFF_ATTENDANCE_SELF_VIEW), getMyStaffAttendance);

router.get("/staff-leaves/mine", authMiddleware, requirePermission(PERMISSIONS.STAFF_LEAVE_SELF_VIEW), listMyStaffLeaves);
router.post(
  "/staff-leaves/mine",
  authMiddleware,
  requirePermission(PERMISSIONS.STAFF_LEAVE_SELF_APPLY),
  auditMutation({ action: "STAFF_LEAVE_APPLY", resourceType: "StaffLeave" }),
  createMyStaffLeave
);
router.get("/staff-leaves/approvals", authMiddleware, requirePermission(PERMISSIONS.STAFF_LEAVE_APPROVE), listStaffLeaveApprovals);
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
