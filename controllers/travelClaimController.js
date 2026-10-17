import mongoose from "mongoose";
import TravelClaim from "../models/TravelClaim.js";
import { taAccess, getReadableClaim, assertOwner, publicClaim, createClaim, saveClaim, setClaimStatus, decideClaim, addTaHistory } from "../services/travelClaimService.js";
import { uploadTaEvidence, downloadTaEvidence } from "../services/travelClaimEvidenceService.js";
import { withHqFinanceTransaction } from "../services/hqFinanceTransactionService.js";
import { TaError, failTa, assertRevision, assertEditable } from "../utils/travelClaimPolicy.js";

export function sendTaError(res, error) {
  const known = error instanceof TaError;
  if (!known) console.error("[travel-claim]", { name: error?.name, code: error?.code });
  return res.status(known ? error.status : 503).json({ success: false, code: known ? error.code : "TA_UNAVAILABLE", error: known ? error.code : "TA_UNAVAILABLE" });
}
const handle = (fn) => async (req, res) => {
  res.set("Cache-Control", "no-store");
  try { return await fn(req, res, await taAccess(req)); } catch (error) { return sendTaError(res, error); }
};
export const taMeta = handle(async (req, res, access) => res.json({ success: true,
  canViewOwn: access.canViewOwn, canManageOwn: access.canManageOwn, canReview: access.canReview, canApprove: access.canApprove,
}));
export const listTaClaims = handle(async (req, res, access) => {
  const review = req.path === "/review";
  if (review ? !access.canReview : !access.canViewOwn) failTa("TA_FORBIDDEN", 403);
  const filter = review ? {} : { userId: req.user._id, staffType: access.actor.staffType, staffId: access.actor.staffId };
  if (req.query.status) {
    if (!["Draft", "Submitted", "Returned", "Approved", "PayrollReserved", "Paid", "Rejected", "Cancelled"].includes(req.query.status)) failTa("TA_INVALID_FIELDS");
    filter.status = req.query.status;
  }
  if (req.query.before) {
    if (!mongoose.Types.ObjectId.isValid(String(req.query.before))) failTa("TA_INVALID_FIELDS");
    filter._id = { $lt: new mongoose.Types.ObjectId(req.query.before) };
  }
  const records = await TravelClaim.find(filter).select("claimNumber userId name staffCode status requestedAmountPaise approvedAmountPaise settlementMonth payrollMonth createdAt revision fromDateKey toDateKey").sort({ _id: -1 }).limit(26).lean();
  return res.json({ success: true, claims: records.slice(0, 25).map(publicClaim), nextCursor: records.length > 25 ? String(records[24]._id) : null });
});
export const getTaClaim = handle(async (req, res, access) => res.json({ success: true, claim: publicClaim(await getReadableClaim(req, access)) }));
export const createTaClaim = handle(async (req, res, access) => res.json({ success: true, claim: publicClaim(await createClaim(req, access)) }));
export const saveTaClaim = handle(async (req, res, access) => res.json({ success: true, claim: publicClaim(await saveClaim(req, access)) }));
export const statusTaClaim = handle(async (req, res, access) => res.json({ success: true, claim: publicClaim(await setClaimStatus(req, access)) }));
export const decisionTaClaim = handle(async (req, res, access) => res.json({ success: true, claim: publicClaim(await decideClaim(req, access)) }));

export const uploadTaClaimEvidence = handle(async (req, res, access) => {
  if (!access.canManageOwn) failTa("TA_FORBIDDEN", 403);
  const initial = await getReadableClaim(req, access); assertOwner(initial, req, access); assertEditable(initial);
  const key = req.body.uploadKey;
  if (typeof key !== "string" || !/^[0-9a-f-]{36}$/i.test(key)) failTa("TA_INVALID_FIELDS");
  if (initial.evidence.some((e) => e.uploadKey === key && !e.removed)) return res.json({ success: true, claim: publicClaim(initial) });
  const revision = Number(req.body.revision); assertRevision(initial, revision);
  if (initial.evidence.filter((e) => !e.removed).length >= 5 || initial.evidence.length >= 20) failTa("TA_EVIDENCE_LIMIT");
  const evidence = await uploadTaEvidence(initial, req.file, key, req.body.originalName);
  // No Drive mutation is retried inside the MongoDB transaction. An uncertain
  // commit may leave a private unlinked upload; never delete potentially attached
  // evidence in an error handler after an ambiguous commit result.
  const claim = await withHqFinanceTransaction(async (session) => {
    const current = await getReadableClaim(req, access, session); assertOwner(current, req, access); assertEditable(current);
    if (current.evidence.some((e) => e.uploadKey === key && !e.removed)) return current;
    assertRevision(current, revision);
    if (current.evidence.filter((e) => !e.removed).length >= 5 || current.evidence.length >= 20) failTa("TA_EVIDENCE_LIMIT");
    current.evidence.push(evidence); addTaHistory(current, "EvidenceAdded", req.user._id);
    await current.save({ session }); return current;
  });
  return res.json({ success: true, claim: publicClaim(claim) });
});
export const removeTaClaimEvidence = handle(async (req, res, access) => {
  if (!access.canManageOwn) failTa("TA_FORBIDDEN", 403);
  const claim = await withHqFinanceTransaction(async (session) => {
    const current = await getReadableClaim(req, access, session); assertOwner(current, req, access); assertEditable(current); assertRevision(current, req.body.revision);
    const evidence = current.evidence.id(req.params.evidenceId);
    if (!evidence || evidence.removed) failTa("TA_NOT_FOUND", 404);
    evidence.removed = true; addTaHistory(current, "EvidenceRemoved", req.user._id);
    await current.save({ session }); return current;
  });
  return res.json({ success: true, claim: publicClaim(claim) });
});
export const readTaClaimEvidence = handle(async (req, res, access) => {
  const claim = await getReadableClaim(req, access);
  const evidence = claim.evidence.id(req.params.evidenceId);
  if (!evidence || evidence.removed) failTa("TA_NOT_FOUND", 404);
  const bytes = await downloadTaEvidence(claim, evidence);
  res.set({ "Content-Type": evidence.mimeType, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": `attachment; filename="receipt.${evidence.mimeType === "application/pdf" ? "pdf" : evidence.mimeType === "image/png" ? "png" : "jpg"}"; filename*=UTF-8''${encodeURIComponent(evidence.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}` });
  return res.send(bytes);
});
