import { monthlyClaims, monthlyReport } from "../services/monthlyTravelClaimReportService.js";
import { createMonthlyUpload, uploadMonthlyFile, removeMonthlyFile, submitMonthlyClaim, publicUpload } from "../services/monthlyTravelClaimService.js";
import { taAccess, getReadableClaim, publicClaim, createClaim, saveClaim, setClaimStatus, decideClaim } from "../services/travelClaimService.js";
import { downloadTaEvidence } from "../services/travelClaimEvidenceService.js";
import { TaError, failTa } from "../utils/travelClaimPolicy.js";

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
  actor: access.actor ? { name: access.actor.record.userId?.name || "", staffType: access.actor.staffType,
    employeeId: access.actor.staffType === "Employee" ? access.actor.record.employeeId : "",
    supervisorId: access.actor.staffType === "Supervisor" ? access.actor.record.supervisorId : "" } : null,
  canViewOwn: access.canViewOwn, canManageOwn: access.canManageOwn, canReview: access.canReview, canApprove: access.canApprove,
}));
export const listTaClaims = handle(async (req, res, access) => res.json({ success: true, ...await monthlyClaims(req, access) }));
export const taMonthlyReport = handle(async (req, res, access) => res.json({ success: true, ...await monthlyReport(req, access) }));
export const createTaUpload = handle(async (req, res, access) => res.json({ success: true, upload: publicUpload(await createMonthlyUpload(req, access)) }));
export const uploadTaMonthlyFile = handle(async (req, res, access) => res.json({ success: true, upload: publicUpload(await uploadMonthlyFile(req, access)) }));
export const removeTaMonthlyFile = handle(async (req, res, access) => res.json({ success: true, upload: publicUpload(await removeMonthlyFile(req, access)) }));
export const submitTaMonthly = handle(async (req, res, access) => res.json({ success: true, claim: publicClaim(await submitMonthlyClaim(req, access)) }));
export const getTaClaim = handle(async (req, res, access) => res.json({ success: true, claim: publicClaim(await getReadableClaim(req, access)) }));
export const createTaClaim = handle(async (req, res, access) => res.json({ success: true, claim: publicClaim(await createClaim(req, access)) }));
export const saveTaClaim = handle(async (req, res, access) => res.json({ success: true, claim: publicClaim(await saveClaim(req, access)) }));
export const statusTaClaim = handle(async (req, res, access) => res.json({ success: true, claim: publicClaim(await setClaimStatus(req, access)) }));
export const decisionTaClaim = handle(async (req, res, access) => res.json({ success: true, claim: publicClaim(await decideClaim(req, access)) }));

export const uploadTaClaimEvidence = handle(async () => failTa("TA_MONTHLY_REQUIRED", 409));
export const removeTaClaimEvidence = handle(async () => failTa("TA_MONTHLY_REQUIRED", 409));
export const readTaClaimEvidence = handle(async (req, res, access) => {
  const claim = await getReadableClaim(req, access);
  const evidence = claim.evidence.id(req.params.evidenceId);
  if (!evidence || evidence.removed) failTa("TA_NOT_FOUND", 404);
  const bytes = await downloadTaEvidence(claim, evidence);
  res.set({ "Content-Type": evidence.mimeType, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": `attachment; filename="receipt.${evidence.mimeType === "application/pdf" ? "pdf" : evidence.mimeType === "image/png" ? "png" : "jpg"}"; filename*=UTF-8''${encodeURIComponent(evidence.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}` });
  return res.send(bytes);
});
