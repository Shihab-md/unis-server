import express from "express";
import authMiddleware from '../middleware/authMiddlware.js'
import {
  listPendingBatches,
  getBatchDetails,
  approveBatch,
  rejectBatch,
  hqFeesDashboard,
  listPendingInvoicesHQ_NotSent,
  createMigrationBatchesFromInvoicesAllSchools,
} from "../controllers/hqFeesController.js";

const router = express.Router();

router.get("/payment-batches", authMiddleware, listPendingBatches);

router.post("/payment-batches/migration/from-invoices/all", authMiddleware, createMigrationBatchesFromInvoicesAllSchools);

router.get("/payment-batches/:batchId", authMiddleware, getBatchDetails);
router.post("/payment-batches/:batchId/approve", authMiddleware, approveBatch);
router.post("/payment-batches/:batchId/reject", authMiddleware, rejectBatch);
router.get("/dashboard", authMiddleware, hqFeesDashboard);
router.get("/pending-invoices-not-sent/:acYear/:schoolId", authMiddleware, listPendingInvoicesHQ_NotSent);

export default router;
