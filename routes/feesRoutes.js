import express from "express";
import authMiddleware from '../middleware/authMiddlware.js';
import {
  listDueInvoicesForSchool,
  createPaymentBatch,
  schoolFeesDashboard,
  listBatchesSentToHQForSchool
} from "../controllers/feesController.js";
import {
  requireAccountsRole,
  requireAccountSchoolParamAccess,
  requireAccountSchoolBodyAccess,
  requireAccountSchoolQueryAccess,
} from "../middleware/authorizationMiddleware.js";
import { notifyOnSuccess } from "../middleware/notificationMiddleware.js";

const router = express.Router();
router.get("/invoices/:schoolId/:acYear", authMiddleware, requireAccountsRole, requireAccountSchoolParamAccess("schoolId"), listDueInvoicesForSchool);
router.post(
  "/payment-batches",
  authMiddleware,
  requireAccountsRole,
  requireAccountSchoolBodyAccess("schoolId"),
  notifyOnSuccess({
    type: "ACCOUNT_BATCH_SUBMITTED",
    title: "Payment batch submitted",
    message: "Invoice payment batch submitted to HQ.",
    resourceType: "accounts",
    resourceId: (_req, payload) => payload?.batchId,
    mobilePath: "/(app)/accounts/batches",
    webPath: "/dashboard/fees/sent-to-hq",
  }),
  createPaymentBatch
);
router.get("/dashboard/school", authMiddleware, requireAccountsRole, requireAccountSchoolQueryAccess("schoolId"), schoolFeesDashboard);
router.get("/batches/sent/:schoolId/:acYear/:status?", authMiddleware, requireAccountsRole, requireAccountSchoolParamAccess("schoolId", { allowAllForHQ: true }), listBatchesSentToHQForSchool);
export default router;
