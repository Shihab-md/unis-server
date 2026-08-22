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

const router = express.Router();
router.get("/payment-batches", authMiddleware, requireHQ, listPendingBatches);
router.post("/payment-batches/migration/from-invoices/all", authMiddleware, requireHQ, createMigrationBatchesFromInvoicesAllSchools);
router.get("/payment-batches/:batchId", authMiddleware, requireHQ, getBatchDetails);
router.post(
  "/payment-batches/:batchId/approve",
  authMiddleware,
  requireHQ,
  notifyOnSuccess({ type: "ACCOUNT_BATCH_APPROVED", title: "Payment batch approved", message: "Payment batch approval completed.", resourceType: "accounts", resourceId: (req) => req.params.batchId, mobilePath: "/(app)/accounts/approvals", webPath: "/dashboard/hq/fees" }),
  approveBatch
);
router.post(
  "/payment-batches/:batchId/reject",
  authMiddleware,
  requireHQ,
  notifyOnSuccess({ type: "ACCOUNT_BATCH_REJECTED", title: "Payment batch rejected", message: "Payment batch was rejected.", resourceType: "accounts", resourceId: (req) => req.params.batchId, mobilePath: "/(app)/accounts/approvals", webPath: "/dashboard/hq/fees" }),
  rejectBatch
);
router.get("/dashboard", authMiddleware, requireHQ, hqFeesDashboard);
router.get("/pending-invoices-not-sent/:acYear/:schoolId", authMiddleware, requireHQ, listPendingInvoicesHQ_NotSent);
export default router;
