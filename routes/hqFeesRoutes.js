import express from "express";
import authMiddleware from '../middleware/authMiddlware.js';
import {
  listPendingBatches,
  getBatchDetails,
  approveBatch,
  rejectBatch,
  hqFeesDashboard,
  listPendingInvoicesHQ_NotSent,
  createMigrationBatchesFromInvoicesAllSchools,
} from "../controllers/hqFeesController.js";
import { requireHQ } from "../middleware/authorizationMiddleware.js";
import { notifyOnSuccess } from "../middleware/notificationMiddleware.js";
import { requirePermission } from "../middleware/permissionMiddleware.js";
import { PERMISSIONS } from "../config/permissionCatalog.js";

const router = express.Router();
router.get(
  "/payment-batches",
  authMiddleware,
  requirePermission(PERMISSIONS.ACCOUNTS_HQ_REVIEW_VIEW, "You do not have permission to view payment batches for approval."),
  requireHQ,
  listPendingBatches
);
router.post(
  "/payment-batches/migration/from-invoices/all",
  authMiddleware,
  requirePermission(PERMISSIONS.ACCOUNTS_HQ_MIGRATION_RUN, "You do not have permission to run the invoice-batch migration."),
  requireHQ,
  createMigrationBatchesFromInvoicesAllSchools
);
router.get(
  "/payment-batches/:batchId",
  authMiddleware,
  requirePermission(PERMISSIONS.ACCOUNTS_HQ_REVIEW_VIEW, "You do not have permission to view payment-batch details."),
  requireHQ,
  getBatchDetails
);
router.post(
  "/payment-batches/:batchId/approve",
  authMiddleware,
  requirePermission(PERMISSIONS.ACCOUNTS_HQ_APPROVE, "You do not have permission to approve payment batches."),
  requireHQ,
  notifyOnSuccess({ type: "ACCOUNT_BATCH_APPROVED", title: "Payment batch approved", message: "Payment batch approval completed.", resourceType: "accounts", resourceId: (req) => req.params.batchId, mobilePath: "/(app)/accounts/approvals", webPath: "/dashboard/hq/fees" }),
  approveBatch
);
router.post(
  "/payment-batches/:batchId/reject",
  authMiddleware,
  requirePermission(PERMISSIONS.ACCOUNTS_HQ_REJECT, "You do not have permission to reject payment batches."),
  requireHQ,
  notifyOnSuccess({ type: "ACCOUNT_BATCH_REJECTED", title: "Payment batch rejected", message: "Payment batch was rejected.", resourceType: "accounts", resourceId: (req) => req.params.batchId, mobilePath: "/(app)/accounts/approvals", webPath: "/dashboard/hq/fees" }),
  rejectBatch
);
router.get(
  "/dashboard",
  authMiddleware,
  requirePermission(PERMISSIONS.ACCOUNTS_HQ_REVIEW_VIEW, "You do not have permission to view the HQ Accounts dashboard."),
  requireHQ,
  hqFeesDashboard
);
router.get(
  "/pending-invoices-not-sent/:acYear/:schoolId",
  authMiddleware,
  requirePermission(PERMISSIONS.ACCOUNTS_HQ_PENDING_INVOICES_VIEW, "You do not have permission to view pending HQ invoices."),
  requireHQ,
  listPendingInvoicesHQ_NotSent
);
export default router;
