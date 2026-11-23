import PayrollRun from "../models/PayrollRun.js";
import StaffAttendance from "../models/StaffAttendance.js";

export class AttendanceWorkflowError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.name = "AttendanceWorkflowError";
    this.code = code;
    this.status = status;
  }
}
export const failWorkflow = (code, status) => { throw new AttendanceWorkflowError(code, status); };

export function leaveText(value, maximum, required = false) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") failWorkflow("LEAVE_INVALID_FIELDS", 400);
  const text = value.trim();
  if ((required && !text) || text.length > maximum || Buffer.from(text, "utf8").toString("utf8") !== text || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) failWorkflow("LEAVE_INVALID_FIELDS", 400);
  return text;
}

export function assertLeaveRevision(leave, revision) {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision !== Number(leave.revision || 0)) failWorkflow("LEAVE_STALE");
}

export function assertLeaveTransition(leave, status) {
  const allowed = { Pending: ["Approved", "Rejected", "Cancelled"], Approved: ["Cancelled"] };
  if (!allowed[leave.status]?.includes(status)) failWorkflow("LEAVE_STATE_LOCKED");
}

const payrollFilter = ({ staffType, staffId, fromDateKey, toDateKey }) => ({
  organizationType: "HQ",
  monthKey: { $gte: fromDateKey.slice(0, 7), $lte: toDateKey.slice(0, 7) },
  items: { $elemMatch: { staffType, staffId } },
});

export async function assertPayrollPeriodOpen(target, session) {
  if (target.organizationType !== "HQ") return;
  if (await PayrollRun.exists({ ...payrollFilter(target), status: { $in: ["Finalized", "Paid"] } }).session(session)) failWorkflow("LEAVE_PAYROLL_LOCKED");
}

// All callers hold the shared HQ finance transaction lock. Mark the snapshot
// stale without silently rewriting salary items or manual adjustments.
export async function invalidatePayrollPeriod(target, session) {
  if (target.organizationType !== "HQ") return;
  await PayrollRun.updateMany({ ...payrollFilter(target), status: { $in: ["Draft", "Reviewed"] } }, {
    $set: { status: "Draft", needsRecalculation: true, reviewedBy: null, reviewedAt: null, updatedAt: new Date() },
    $inc: { revision: 1 },
  }, { session });
}

export async function flagCancelledLeaveAttendance(leave, userId, session) {
  await StaffAttendance.updateMany({ staffType: leave.staffType, staffId: leave.staffId,
    dateKey: { $gte: leave.fromDateKey, $lte: leave.toDateKey }, isFinalized: { $ne: true }, status: { $in: ["Leave", "Half Day"] },
  }, { $set: { requiresReview: true, updatedAt: new Date() }, $push: { corrections: {
    reason: "Approved leave cancelled; attendance requires review.", changedBy: userId, changedAt: new Date(),
  } } }, { session });
}

export async function assertAttendanceReviewed({ staffType, staffId, fromDateKey, toDateKey }, session) {
  if (await StaffAttendance.exists({ staffType, staffId, dateKey: { $gte: fromDateKey, $lte: toDateKey }, requiresReview: true }).session(session)) failWorkflow("PAYROLL_ATTENDANCE_REVIEW_REQUIRED");
}
