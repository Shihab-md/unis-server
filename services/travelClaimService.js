import mongoose from "mongoose";
import TravelClaim from "../models/TravelClaim.js";
import PayrollRun from "../models/PayrollRun.js";
import { getActorStaff } from "./attendanceAccessService.js";
import { getRequestPermissions } from "./permissionService.js";
import { PERMISSIONS } from "../config/permissionCatalog.js";
import { withHqFinanceTransaction } from "./hqFinanceTransactionService.js";
import { TA_SELF_ROLES, TA_REVIEW_ROLES, failTa, assertRevision, moneyPaise, isMonthKey, claimMonth, monthlyStatus } from "../utils/travelClaimPolicy.js";

export async function taAccess(req) {
  const role = String(req.user?.role || "").trim().toLowerCase();
  const permissions = new Set(await getRequestPermissions(req));
  const actor = await getActorStaff(req.user);
  const activeHq = actor?.organizationType === "HQ" && actor?.active === "Active";
  const self = TA_SELF_ROLES.has(role) && activeHq;
  const review = TA_REVIEW_ROLES.has(role) && (role === "superadmin" || activeHq);
  return {
    actor,
    canViewOwn: Boolean(self && permissions.has(PERMISSIONS.TA_SELF_VIEW)),
    canManageOwn: Boolean(self && permissions.has(PERMISSIONS.TA_SELF_MANAGE) && permissions.has(PERMISSIONS.TA_SELF_VIEW)),
    canReview: Boolean(review && permissions.has(PERMISSIONS.TA_REVIEW_VIEW)),
    canApprove: Boolean(review && permissions.has(PERMISSIONS.TA_REVIEW_VIEW) && permissions.has(PERMISSIONS.TA_APPROVE)),
  };
}
export function assertOwner(claim, req, access) {
  if (!access.canViewOwn || String(claim.userId) !== String(req.user._id) || claim.staffType !== access.actor.staffType ||
      String(claim.staffId) !== String(access.actor.staffId)) failTa("TA_FORBIDDEN", 403);
}
export async function getReadableClaim(req, access, session = null) {
  if (!access.canReview && !access.canViewOwn) failTa("TA_FORBIDDEN", 403);
  if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ""))) failTa("TA_NOT_FOUND", 404);
  const claim = await TravelClaim.findById(req.params.id).session(session);
  if (!claim) failTa("TA_NOT_FOUND", 404);
  if (!access.canReview) assertOwner(claim, req, access);
  return claim;
}
export function publicClaim(claim) {
  const value = claim.toObject ? claim.toObject() : claim;
  const isMonthly = value.claimVersion === 2;
  const description = isMonthly ? value.description : [value.purpose, [value.fromPlace, value.toPlace].filter(Boolean).join(" → "), value.transport,
    ...(value.expenses || []).map((e) => `${e.description}: ${(Number(e.amountPaise || 0) / 100).toFixed(2)}`)].filter(Boolean).join("\n");
  return {
    _id: value._id, claimNumber: value.claimNumber, userId: value.userId, staffType: value.staffType, staffId: value.staffId,
    role: value.role || "", name: value.name, staffCode: value.staffCode,
    employeeId: value.employeeId || (value.staffType === "Employee" ? value.staffCode : ""),
    supervisorId: value.supervisorId || (value.staffType === "Supervisor" ? value.staffCode : ""),
    monthKey: claimMonth(value), claimVersion: isMonthly ? 2 : 1, description,
    requestedAmountPaise: value.requestedAmountPaise, approvedAmountPaise: value.approvedAmountPaise,
    status: monthlyStatus(value.status), revision: Number(value.revision || 0),
    decisionReason: value.decisionReason || "", submittedAt: value.submittedAt, decidedAt: value.decidedAt,
    payrollRunId: value.payrollRunId, payrollMonth: value.payrollMonth, paidAt: value.paidAt,
    history: value.history || [], createdAt: value.createdAt,
    evidence: (value.evidence || []).filter((e) => !e.removed).map((e) => ({ _id: e._id, uploadKey: e.uploadKey, name: e.name, mimeType: e.mimeType, size: e.size, uploadedAt: e.uploadedAt })),
  };
}
export const addTaHistory = (claim, action, userId, extra = {}) => {
  if (claim.history.length >= 200 && !["PayrollReserved", "PayrollReleased", "Paid"].includes(action)) failTa("TA_HISTORY_LIMIT", 409);
  claim.history.push({ action, actorId: userId, at: new Date(), ...extra }); claim.revision = Number(claim.revision || 0) + 1;
};

// Older clients cannot create drafts, return requests or edit submitted evidence.
export async function createClaim() { failTa("TA_MONTHLY_REQUIRED", 409); }
export async function saveClaim() { failTa("TA_MONTHLY_REQUIRED", 409); }
export async function setClaimStatus() { failTa("TA_MONTHLY_REQUIRED", 409); }

export async function decideClaim(req, access) {
  if (!access.canApprove) failTa("TA_FORBIDDEN", 403);
  return withHqFinanceTransaction(async (session) => {
    const claim = await getReadableClaim(req, access, session);
    if (String(claim.userId) === String(req.user._id) || (access.actor && claim.staffType === access.actor.staffType && String(claim.staffId) === String(access.actor.staffId))) failTa("TA_SELF_APPROVAL", 403);
    assertRevision(claim, req.body.revision);
    if (claim.status !== "Submitted" || claim.payrollRunId) failTa("TA_LOCKED", 409);
    const decision = req.body.decision;
    if (!["Approved", "Rejected"].includes(decision)) failTa("TA_MONTHLY_DECISION");
    const reason = req.body.reason === undefined ? "" : req.body.reason;
    if (typeof reason !== "string" || reason.trim().length > 1000 || Buffer.from(reason, "utf8").toString("utf8") !== reason || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(reason)) failTa("TA_INVALID_FIELDS");
    if (decision === "Rejected" && !reason.trim()) failTa("TA_REJECTION_REASON");
    if (decision === "Approved") {
      const monthKey = claimMonth(claim);
      if (!isMonthKey(monthKey)) failTa("TA_INVALID_MONTH");
      const run = await PayrollRun.findOne({ monthKey, organizationType: "HQ" }).session(session);
      if (run && ["Finalized", "Paid"].includes(run.status)) failTa("TA_MONTH_LOCKED", 409);
      // Approval accepts the submitted total exactly; correction requires rejection.
      if (req.body.approvedAmount !== undefined && moneyPaise(req.body.approvedAmount) !== claim.requestedAmountPaise) failTa("TA_MONTHLY_DECISION");
      if (req.body.settlementMonth !== undefined && req.body.settlementMonth !== monthKey) failTa("TA_MONTHLY_DECISION");
      claim.approvedAmountPaise = claim.requestedAmountPaise; claim.settlementMonth = monthKey;
      await PayrollRun.updateMany({ monthKey, organizationType: "HQ", status: { $in: ["Draft", "Reviewed"] }, items: { $elemMatch: { staffType: claim.staffType, staffId: claim.staffId } } },
        { $set: { status: "Draft", needsRecalculation: true, reviewedBy: null, reviewedAt: null, updatedAt: new Date() }, $inc: { revision: 1 } }, { session });
    }
    claim.status = decision; claim.decidedBy = req.user._id; claim.decidedAt = new Date(); claim.decisionReason = reason.trim();
    addTaHistory(claim, decision, req.user._id, { reason: reason.trim(), amountPaise: claim.approvedAmountPaise });
    await claim.save({ session }); return claim;
  });
}
