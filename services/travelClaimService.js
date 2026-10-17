import mongoose from "mongoose";
import TravelClaim from "../models/TravelClaim.js";
import PayrollRun from "../models/PayrollRun.js";
import { getActorStaff } from "./attendanceAccessService.js";
import { getRequestPermissions } from "./permissionService.js";
import { PERMISSIONS } from "../config/permissionCatalog.js";
import { withHqFinanceTransaction } from "./hqFinanceTransactionService.js";
import { TA_SELF_ROLES, TA_REVIEW_ROLES, failTa, claimInput, assertRevision, assertEditable, indiaDateKey, moneyPaise, isMonthKey } from "../utils/travelClaimPolicy.js";

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
  return { ...value, evidence: (value.evidence || []).filter((e) => !e.removed).map((e) => ({
    _id: e._id, uploadKey: e.uploadKey, name: e.name, mimeType: e.mimeType, size: e.size, uploadedAt: e.uploadedAt,
  })) };
}
export const addTaHistory = (claim, action, userId, extra = {}) => {
  if (claim.history.length >= 200 && !["PayrollReserved", "PayrollReleased", "Paid"].includes(action)) failTa("TA_HISTORY_LIMIT", 409);
  claim.history.push({ action, actorId: userId, at: new Date(), ...extra }); claim.revision += 1;
};

export async function createClaim(req, access) {
  if (!access.canManageOwn) failTa("TA_FORBIDDEN", 403);
  const key = req.body.requestKey;
  if (typeof key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) failTa("TA_INVALID_FIELDS");
  const fields = claimInput(req.body);
  return withHqFinanceTransaction(async (session) => {
    const previous = await TravelClaim.findOne({ userId: req.user._id, requestKey: key }).session(session);
    if (previous) { assertOwner(previous, req, access); return previous; }
    const actor = access.actor; const id = new mongoose.Types.ObjectId();
    const created = new TravelClaim({ ...fields, _id: id, requestKey: key, claimNumber: `TA-${id.toString().toUpperCase()}`,
      staffType: actor.staffType, staffId: actor.staffId, userId: req.user._id,
      name: actor.record.userId?.name || req.user.name || actor.record.employeeId || actor.record.supervisorId,
      staffCode: actor.record.employeeId || actor.record.supervisorId || "", status: "Draft",
    });
    addTaHistory(created, "Created", req.user._id);
    await created.save({ session }); return created;
  });
}

export async function saveClaim(req, access) {
  if (!access.canManageOwn) failTa("TA_FORBIDDEN", 403);
  const fields = claimInput(req.body);
  return withHqFinanceTransaction(async (session) => {
    const claim = await getReadableClaim(req, access, session); assertOwner(claim, req, access);
    assertRevision(claim, req.body.revision); assertEditable(claim);
    Object.assign(claim, fields, { status: "Draft" });
    addTaHistory(claim, "Edited", req.user._id);
    await claim.save({ session }); return claim;
  });
}

export async function setClaimStatus(req, access) {
  if (!access.canManageOwn) failTa("TA_FORBIDDEN", 403);
  return withHqFinanceTransaction(async (session) => {
    const claim = await getReadableClaim(req, access, session); assertOwner(claim, req, access);
    assertRevision(claim, req.body.revision);
    const action = req.body.action;
    if (action === "Submit") {
      assertEditable(claim);
      claimInput({ ...claim.toObject(), expenses: claim.expenses.map((row) => ({ description: row.description, amount: (row.amountPaise / 100).toFixed(2) })) });
      if (claim.toDateKey > indiaDateKey()) failTa("TA_FUTURE_TRAVEL");
      if (!claim.evidence.some((e) => !e.removed)) failTa("TA_EVIDENCE_REQUIRED");
      claim.status = "Submitted"; claim.submittedAt = new Date(); claim.decisionReason = ""; claim.decidedBy = null; claim.decidedAt = null;
    } else if (action === "Cancel") {
      if (!["Draft", "Returned", "Submitted"].includes(claim.status) || claim.payrollRunId) failTa("TA_LOCKED", 409);
      claim.status = "Cancelled";
    } else failTa("TA_INVALID_FIELDS");
    addTaHistory(claim, claim.status, req.user._id);
    await claim.save({ session }); return claim;
  });
}

export async function decideClaim(req, access) {
  if (!access.canApprove) failTa("TA_FORBIDDEN", 403);
  return withHqFinanceTransaction(async (session) => {
    const claim = await getReadableClaim(req, access, session);
    if (String(claim.userId) === String(req.user._id) || (access.actor && claim.staffType === access.actor.staffType && String(claim.staffId) === String(access.actor.staffId))) failTa("TA_SELF_APPROVAL", 403);
    assertRevision(claim, req.body.revision);
    if (claim.status !== "Submitted" || claim.payrollRunId) failTa("TA_LOCKED", 409);
    const decision = req.body.decision;
    if (!["Approved", "Rejected", "Returned"].includes(decision)) failTa("TA_INVALID_FIELDS");
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
    if (Buffer.from(reason, "utf8").toString("utf8") !== reason || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(reason)) failTa("TA_INVALID_FIELDS");
    if (reason.length > 1000 || ((decision === "Rejected" || decision === "Returned") && !reason)) failTa("TA_REASON_REQUIRED");
    if (decision === "Approved") {
      const amount = moneyPaise(req.body.approvedAmount);
      if (amount > claim.requestedAmountPaise) failTa("TA_APPROVAL_AMOUNT");
      if (amount < claim.requestedAmountPaise && !reason) failTa("TA_REASON_REQUIRED");
      if (!isMonthKey(req.body.settlementMonth) || req.body.settlementMonth < claim.toDateKey.slice(0, 7)) failTa("TA_INVALID_MONTH");
      const run = await PayrollRun.findOne({ monthKey: req.body.settlementMonth, organizationType: "HQ" }).session(session);
      if (run && ["Finalized", "Paid"].includes(run.status)) failTa("TA_MONTH_LOCKED", 409);
      claim.approvedAmountPaise = amount; claim.settlementMonth = req.body.settlementMonth;
    }
    claim.status = decision; claim.decidedBy = req.user._id; claim.decidedAt = new Date(); claim.decisionReason = reason;
    addTaHistory(claim, decision, req.user._id, { reason, amountPaise: claim.approvedAmountPaise });
    await claim.save({ session }); return claim;
  });
}
