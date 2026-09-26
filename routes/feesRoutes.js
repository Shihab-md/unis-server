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
import { requirePermission } from "../middleware/permissionMiddleware.js";
import { PERMISSIONS } from "../config/permissionCatalog.js";

const router = express.Router();
router.get(
  "/invoices/:schoolId/:acYear",
  authMiddleware,
  requirePermission(PERMISSIONS.ACCOUNTS_SCHOOL_INVOICES_VIEW, "You do not have permission to view invoice payments."),
  requireAccountsRole,
  requireAccountSchoolParamAccess("schoolId"),
  listDueInvoicesForSchool
);
router.post(
  "/payment-batches",
  authMiddleware,
  requirePermission(PERMISSIONS.ACCOUNTS_PAYMENT_BATCH_SUBMIT, "You do not have permission to submit payment batches."),
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
router.get(
  "/dashboard/school",
  authMiddleware,
  requirePermission(PERMISSIONS.ACCOUNTS_SCHOOL_INVOICES_VIEW, "You do not have permission to view invoice payments."),
  requireAccountsRole,
  requireAccountSchoolQueryAccess("schoolId"),
  schoolFeesDashboard
);
router.get(
  "/batches/sent/:schoolId/:acYear/:status?",
  authMiddleware,
  requirePermission(PERMISSIONS.ACCOUNTS_BATCH_HISTORY_VIEW, "You do not have permission to view payment-batch history."),
  requireAccountsRole,
  requireAccountSchoolParamAccess("schoolId", { allowAllForHQ: true }),
  listBatchesSentToHQForSchool
);
export default router;
