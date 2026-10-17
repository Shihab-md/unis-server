import TravelClaim from "../models/TravelClaim.js";
import { failTa, rupees } from "../utils/travelClaimPolicy.js";
import { addTaHistory } from "./travelClaimService.js";
const staffKey = (row) => `${row.staffType}:${row.staffId}`;
const matches = (claim, row) => row && String(claim.userId) === String(row.userId);
export function assertPayrollRevision(run, expected) {
  if (!Number.isSafeInteger(expected) || expected < 0 || expected !== Number(run?.revision || 0)) failTa("TA_PAYROLL_CHANGED", 409);
}

export async function reservePayrollClaims({ runId, monthKey, staff, userId, session }) {
  const roster = new Map(staff.map((row) => [staffKey(row), row]));
  const claims = await TravelClaim.find({ $or: [
    { status: "Approved", payrollRunId: null, settlementMonth: { $lte: monthKey } },
    { status: "PayrollReserved", payrollRunId: runId },
  ] }).sort({ _id: 1 }).session(session);
  const byStaff = new Map(); const excluded = [];
  for (const claim of claims) {
    const key = staffKey(claim); const row = roster.get(key);
    if (!matches(claim, row) || claim.settlementMonth > monthKey) {
      if (claim.status === "PayrollReserved") {
        claim.status = "Approved"; claim.payrollRunId = null; claim.payrollMonth = null;
        addTaHistory(claim, "PayrollReleased", userId, { payrollRunId: runId }); await claim.save({ session });
      }
      excluded.push({ claimId: claim._id, claimNumber: claim.claimNumber, name: claim.name });
      continue;
    }
    if (claim.status === "Approved") {
      claim.status = "PayrollReserved"; claim.payrollRunId = runId; claim.payrollMonth = monthKey;
      addTaHistory(claim, "PayrollReserved", userId, { payrollRunId: runId }); await claim.save({ session });
    }
    const group = byStaff.get(key) || [];
    group.push({ claimId: claim._id, claimNumber: claim.claimNumber, approvedAmountPaise: claim.approvedAmountPaise });
    byStaff.set(key, group);
  }
  return { byStaff, excluded };
}

export function payrollTaAmount(items) {
  const total = items.reduce((sum, item) => sum + item.approvedAmountPaise, 0);
  if (!Number.isSafeInteger(total) || total < 0) failTa("TA_INVALID_AMOUNT");
  return rupees(total);
}

export async function assertPayrollClaims(run, session, { checkNewApprovals = true } = {}) {
  if (run.taPolicyVersion !== 1 || run.needsRecalculation) failTa("TA_RECALCULATE_REQUIRED", 409);
  const reserved = await TravelClaim.find({ payrollRunId: run._id }).session(session);
  const byId = new Map(reserved.map((c) => [String(c._id), c]));
  const seen = new Set(); const staff = new Map();
  for (const item of run.items) {
    staff.set(staffKey(item), item);
    if (Number(item.travellingAllowance || 0) !== 0 || Number(item.grossSalary) !== Number(item.monthlySalary)) failTa("TA_RECALCULATE_REQUIRED", 409);
    const snapshots = item.travelClaimItems || [];
    if (payrollTaAmount(snapshots) !== Number(item.approvedTaClaims || 0)) failTa("TA_PAYROLL_MISMATCH", 409);
    for (const snapshot of snapshots) {
      const id = String(snapshot.claimId); const claim = byId.get(id);
      if (seen.has(id) || !claim || claim.status !== "PayrollReserved" || staffKey(claim) !== staffKey(item) ||
          !matches(claim, item) || claim.approvedAmountPaise !== snapshot.approvedAmountPaise || claim.claimNumber !== snapshot.claimNumber ||
          claim.settlementMonth > run.monthKey) failTa("TA_PAYROLL_MISMATCH", 409);
      seen.add(id);
    }
  }
  if (seen.size !== reserved.length) failTa("TA_PAYROLL_MISMATCH", 409);
  if (checkNewApprovals) {
    const newlyApproved = await TravelClaim.find({ status: "Approved", payrollRunId: null, settlementMonth: { $lte: run.monthKey } }).session(session);
    if (newlyApproved.some((c) => matches(c, staff.get(staffKey(c))))) failTa("TA_RECALCULATE_REQUIRED", 409);
  }
  return reserved;
}

export async function settlePayrollClaims(run, userId, session) {
  const claims = await assertPayrollClaims(run, session, { checkNewApprovals: false });
  for (const claim of claims) {
    claim.status = "Paid"; claim.paidAt = run.paidAt;
    addTaHistory(claim, "Paid", userId, { payrollRunId: run._id, amountPaise: claim.approvedAmountPaise });
    await claim.save({ session });
  }
}
