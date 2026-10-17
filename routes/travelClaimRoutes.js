import express from "express";
import multer from "multer";
import authMiddleware from "../middleware/authMiddlware.js";
import { requirePermission } from "../middleware/permissionMiddleware.js";
import { auditMutation } from "../middleware/auditMiddleware.js";
import { PERMISSIONS } from "../config/permissionCatalog.js";
import { MAX_EVIDENCE_BYTES, TaError } from "../utils/travelClaimPolicy.js";
import { taAccess } from "../services/travelClaimService.js";
import { taMeta, listTaClaims, getTaClaim, createTaClaim, saveTaClaim, statusTaClaim, decisionTaClaim,
  uploadTaClaimEvidence, removeTaClaimEvidence, readTaClaimEvidence, sendTaError } from "../controllers/travelClaimController.js";
const router = express.Router();
const audit = (action) => auditMutation({ action, resourceType: "TravelClaim" });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_EVIDENCE_BYTES, files: 1, fields: 3 } }).single("file");
router.use(authMiddleware);
router.get("/meta", taMeta);
router.get("/mine", requirePermission(PERMISSIONS.TA_SELF_VIEW), listTaClaims);
router.get("/review", requirePermission(PERMISSIONS.TA_REVIEW_VIEW), listTaClaims);
router.post("/", requirePermission(PERMISSIONS.TA_SELF_MANAGE), audit("TA_CREATE"), createTaClaim);
router.get("/:id", getTaClaim);
router.patch("/:id", requirePermission(PERMISSIONS.TA_SELF_MANAGE), audit("TA_EDIT"), saveTaClaim);
router.post("/:id/status", requirePermission(PERMISSIONS.TA_SELF_MANAGE), audit("TA_STATUS"), statusTaClaim);
router.post("/:id/decision", requirePermission(PERMISSIONS.TA_APPROVE), audit("TA_DECISION"), decisionTaClaim);
router.post("/:id/evidence", requirePermission(PERMISSIONS.TA_SELF_MANAGE), async (req, res, next) => {
  try { if (!(await taAccess(req)).canManageOwn) throw new TaError("TA_FORBIDDEN", 403); return next(); }
  catch (error) { return sendTaError(res, error); }
}, audit("TA_EVIDENCE_UPLOAD"), (req, res, next) => upload(req, res, (error) => error ? sendTaError(res, new TaError("TA_INVALID_FILE")) : next()), uploadTaClaimEvidence);
router.delete("/:id/evidence/:evidenceId", requirePermission(PERMISSIONS.TA_SELF_MANAGE), audit("TA_EVIDENCE_REMOVE"), removeTaClaimEvidence);
router.get("/:id/evidence/:evidenceId", readTaClaimEvidence);
export default router;
