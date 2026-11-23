import mongoose from "mongoose";
import { createHash } from "node:crypto";
import TravelClaim from "../models/TravelClaim.js";
import TravelClaimUpload from "../models/TravelClaimUpload.js";
import PayrollRun from "../models/PayrollRun.js";
import { withHqFinanceTransaction } from "./hqFinanceTransactionService.js";
import { assertOwner, getReadableClaim, addTaHistory } from "./travelClaimService.js";
import { uploadTaEvidence, taEvidenceName } from "./travelClaimEvidenceService.js";
import { failTa, isMonthKey, isRequestKey, monthlyClaimInput, assertRevision, evidenceType, claimMonthFilter } from "../utils/travelClaimPolicy.js";

const now = () => new Date();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const active = (e) => !e.removed;
const idValid = (value) => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);

export function publicUpload(value) {
  const upload = value.toObject ? value.toObject() : value;
  return { _id: upload._id, requestKey: upload.requestKey, monthKey: upload.monthKey, revision: upload.revision,
    submittedClaimId: upload.submittedClaimId || null, expiresAt: upload.expiresAt,
    files: upload.evidence.filter(active).map((e) => ({ _id: e._id, uploadKey: e.uploadKey, name: e.name, mimeType: e.mimeType, size: e.size })),
  };
}
function assertUploadOwner(upload, req, access) {
  if (!access.canManageOwn || !upload || String(upload.userId) !== String(req.user._id) || upload.staffType !== access.actor.staffType || String(upload.staffId) !== String(access.actor.staffId)) failTa("TA_FORBIDDEN", 403);
}
function assertUploadOpen(upload) {
  if (upload.submittedClaimId || upload.expiresAt <= now()) failTa("TA_UPLOAD_EXPIRED", 409);
}
async function readUpload(req, access, session = null) {
  if (!idValid(req.params.uploadId)) failTa("TA_NOT_FOUND", 404);
  const upload = await TravelClaimUpload.findById(req.params.uploadId).session(session);
  if (!upload) failTa("TA_NOT_FOUND", 404);
  assertUploadOwner(upload, req, access); return upload;
}
async function assertMonthOpen(monthKey, session) {
  if (await PayrollRun.exists({ organizationType: "HQ", monthKey, status: { $in: ["Finalized", "Paid"] } }).session(session)) failTa("TA_MONTH_LOCKED", 409);
}
async function assertAvailableMonth(actor, monthKey, session) {
  if (await TravelClaim.exists({ staffType: actor.staffType, staffId: actor.staffId, claimVersion: 2, monthKey }).session(session)) failTa("TA_MONTH_EXISTS", 409);
  // Do not silently replace or double-pay an earlier journey-based request.
  if (await TravelClaim.exists({ $and: [claimMonthFilter(monthKey), { claimVersion: { $ne: 2 }, staffType: actor.staffType, staffId: actor.staffId,
    status: { $in: ["Submitted", "Approved", "PayrollReserved", "Paid"] } }] }).session(session)) failTa("TA_LEGACY_MONTH_EXISTS", 409);
}

export async function createMonthlyUpload(req, access) {
  if (!access.canManageOwn) failTa("TA_FORBIDDEN", 403);
  const { requestKey, monthKey, claimId } = req.body;
  if (!isRequestKey(requestKey) || !isMonthKey(monthKey) || (claimId !== undefined && !idValid(claimId))) failTa("TA_MONTHLY_FIELDS");
  return withHqFinanceTransaction(async (session) => {
    const previous = await TravelClaimUpload.findOne({ userId: req.user._id, requestKey }).session(session);
    if (previous) {
      assertUploadOwner(previous, req, access);
      if (previous.monthKey !== monthKey || Boolean(claimId) !== previous.resubmit || (claimId && String(previous.claimId) !== claimId)) failTa("TA_UPLOAD_CHANGED", 409);
      if (!previous.submittedClaimId) assertUploadOpen(previous);
      return previous;
    }
    await assertMonthOpen(monthKey, session);
    if (claimId) {
      const claim = await getReadableClaim({ ...req, params: { id: claimId } }, access, session); assertOwner(claim, req, access);
      if (claim.claimVersion !== 2 || claim.monthKey !== monthKey || claim.status !== "Rejected" || claim.payrollRunId) failTa("TA_LOCKED", 409);
    } else await assertAvailableMonth(access.actor, monthKey, session);
    if (await TravelClaimUpload.countDocuments({ userId: req.user._id, expiresAt: { $gt: now() }, submittedClaimId: null }).session(session) >= 5) failTa("TA_UPLOAD_LIMIT", 409);
    const upload = new TravelClaimUpload({ userId: req.user._id, staffType: access.actor.staffType, staffId: access.actor.staffId,
      requestKey, monthKey, claimId: claimId || new mongoose.Types.ObjectId(), resubmit: Boolean(claimId), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    await upload.save({ session }); return upload;
  });
}

export async function uploadMonthlyFile(req, access) {
  const initial = await readUpload(req, access); assertUploadOpen(initial);
  const key = req.body.uploadKey;
  if (!isRequestKey(key)) failTa("TA_INVALID_FIELDS");
  const mime = evidenceType(req.file?.buffer);
  const previous = initial.evidence.find((e) => e.uploadKey === key && active(e));
  if (previous) {
    const extension = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
    if (previous.sha256 !== hash(req.file.buffer) || previous.name !== taEvidenceName(req.file.originalname, req.body.originalName, extension)) failTa("TA_UPLOAD_CHANGED", 409);
    return initial;
  }
  assertRevision(initial, Number(req.body.revision));
  if (initial.evidence.filter(active).length >= 5 || initial.evidence.length >= 20) failTa("TA_EVIDENCE_LIMIT");
  const evidence = await uploadTaEvidence({ _id: initial.claimId }, req.file, key, req.body.originalName);
  return withHqFinanceTransaction(async (session) => {
    const current = await readUpload(req, access, session); assertUploadOpen(current);
    const duplicate = current.evidence.find((e) => e.uploadKey === key && active(e));
    if (duplicate) { if (duplicate.sha256 !== evidence.sha256 || duplicate.name !== evidence.name) failTa("TA_UPLOAD_CHANGED", 409); return current; }
    assertRevision(current, Number(req.body.revision));
    if (current.evidence.filter(active).length >= 5 || current.evidence.length >= 20) failTa("TA_EVIDENCE_LIMIT");
    current.evidence.push(evidence); current.revision += 1; await current.save({ session }); return current;
  });
}
export async function removeMonthlyFile(req, access) {
  return withHqFinanceTransaction(async (session) => {
    const upload = await readUpload(req, access, session); assertUploadOpen(upload); assertRevision(upload, req.body.revision);
    if (!idValid(req.params.fileId)) failTa("TA_NOT_FOUND", 404);
    const file = upload.evidence.id(req.params.fileId);
    if (!file || file.removed) failTa("TA_NOT_FOUND", 404);
    file.removed = true; upload.revision += 1; await upload.save({ session }); return upload;
  });
}

export async function submitMonthlyClaim(req, access) {
  if (!access.canManageOwn) failTa("TA_FORBIDDEN", 403);
  const fields = monthlyClaimInput(req.body);
  const { uploadSessionId, requestKey } = req.body;
  const fileKeys = req.body.fileKeys, keptIds = req.body.keptEvidenceIds || [];
  if (!idValid(uploadSessionId) || !isRequestKey(requestKey) || !Array.isArray(fileKeys) || !Array.isArray(keptIds) ||
      fileKeys.length + keptIds.length > 5 || fileKeys.some((k) => !isRequestKey(k)) || keptIds.some((id) => !idValid(id)) ||
      new Set(fileKeys).size !== fileKeys.length || new Set(keptIds).size !== keptIds.length) failTa("TA_MONTHLY_FIELDS");
  const submissionHash = hash(JSON.stringify({ ...fields, fileKeys: [...fileKeys].sort(), keptIds: [...keptIds].sort(), claimRevision: req.body.claimRevision ?? null }));
  return withHqFinanceTransaction(async (session) => {
    const upload = await readUpload({ ...req, params: { uploadId: uploadSessionId } }, access, session);
    if (upload.requestKey !== requestKey || upload.monthKey !== fields.monthKey) failTa("TA_UPLOAD_CHANGED", 409);
    if (upload.submittedClaimId) {
      if (upload.submissionHash !== submissionHash) failTa("TA_UPLOAD_CHANGED", 409);
      const previous = await TravelClaim.findById(upload.submittedClaimId).session(session);
      if (!previous) failTa("TA_NOT_FOUND", 404); assertOwner(previous, req, access); return previous;
    }
    assertUploadOpen(upload); assertRevision(upload, req.body.sessionRevision); await assertMonthOpen(fields.monthKey, session);
    let claim;
    if (upload.resubmit) {
      claim = await TravelClaim.findById(upload.claimId).session(session);
      if (!claim) failTa("TA_NOT_FOUND", 404); assertOwner(claim, req, access); assertRevision(claim, req.body.claimRevision);
      if (claim.claimVersion !== 2 || claim.status !== "Rejected" || claim.monthKey !== fields.monthKey || claim.payrollRunId) failTa("TA_LOCKED", 409);
    } else {
      await assertAvailableMonth(access.actor, fields.monthKey, session);
      if (keptIds.length) failTa("TA_MONTHLY_FIELDS");
      const actor = access.actor;
      claim = new TravelClaim({ _id: upload.claimId, claimVersion: 2, requestKey, claimNumber: `TA-${upload.claimId.toString().toUpperCase()}`,
        userId: req.user._id, staffType: actor.staffType, staffId: actor.staffId,
        role: actor.role, name: actor.record.userId?.name || req.user.name || actor.record.employeeId || actor.record.supervisorId,
        staffCode: actor.record.employeeId || actor.record.supervisorId || "",
        employeeId: actor.staffType === "Employee" ? actor.record.employeeId : "",
        supervisorId: actor.staffType === "Supervisor" ? actor.record.supervisorId : "", status: "Submitted" });
    }
    const retained = keptIds.map((id) => claim.evidence.id(id));
    if (retained.some((file) => !file || file.removed)) failTa("TA_INVALID_FIELDS");
    const additions = fileKeys.map((key) => upload.evidence.find((file) => active(file) && file.uploadKey === key));
    if (additions.some((file) => !file)) failTa("TA_EVIDENCE_REQUIRED");
    if (!retained.length && !additions.length) failTa("TA_EVIDENCE_REQUIRED");
    if (claim.evidence.length + additions.length > 20) failTa("TA_EVIDENCE_LIMIT");
    for (const file of claim.evidence) if (active(file) && !keptIds.includes(String(file._id))) file.removed = true;
    for (const file of additions) { const data = file.toObject(); delete data._id; claim.evidence.push(data); }
    Object.assign(claim, fields, { status: "Submitted", submittedAt: now(), approvedAmountPaise: 0, settlementMonth: fields.monthKey,
      decidedAt: null, decidedBy: null, decisionReason: "" });
    addTaHistory(claim, "Submitted", req.user._id, { amountPaise: fields.requestedAmountPaise });
    await claim.save({ session });
    upload.submittedClaimId = claim._id; upload.submissionHash = submissionHash; upload.revision += 1; await upload.save({ session });
    return claim;
  });
}
