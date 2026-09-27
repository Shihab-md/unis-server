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

// Payroll remains intentionally deferred to Phase 6. Preserve the exact legacy
// access boundary during the HQ-role rollout so no newly introduced HQ role
// inherits Payroll merely because it has broader attendance/data scope.
const LEGACY_PAYROLL_ROLES = new Set(["superadmin", "hquser", "admin"]);
const requireLegacyPayrollAccess = (req, res, next) => {
  const role = String(req.user?.role || "").trim().toLowerCase();
  if (!LEGACY_PAYROLL_ROLES.has(role)) {
    return res.status(403).json({
      success: false,
      error: "Payroll access is unchanged until the dedicated Payroll permission phase.",
    });
  }
  return next();
};

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

router.get("/payroll", authMiddleware, requireLegacyPayrollAccess, listPayrollRuns);
router.post(
  "/payroll/generate",
  authMiddleware,
  requireLegacyPayrollAccess,
  auditMutation({ action: "PAYROLL_GENERATE", resourceType: "PayrollRun" }),
  generatePayroll
);
router.patch(
  "/payroll/:id/items/:itemId",
  authMiddleware,
  requireLegacyPayrollAccess,
  auditMutation({ action: "PAYROLL_ADJUST", resourceType: "PayrollRun" }),
  updatePayrollItem
);
router.patch(
  "/payroll/:id/status",
  authMiddleware,
  requireLegacyPayrollAccess,
  auditMutation({ action: "PAYROLL_STATUS", resourceType: "PayrollRun" }),
  updatePayrollStatus
);

router.get("/reports/monthly", authMiddleware, getMonthlyAttendanceReport);

export default router;
