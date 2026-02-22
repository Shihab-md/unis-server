import express from "express";
import authMiddleware from '../middleware/authMiddlware.js'
import {
  listDueInvoicesForSchool,
  createPaymentBatch,
  schoolFeesDashboard, listBatchesSentToHQForSchool
} from "../controllers/feesController.js";

const router = express.Router();

router.get("/invoices/:schoolId/:acYear", authMiddleware, listDueInvoicesForSchool);
router.post("/payment-batches", authMiddleware, createPaymentBatch);
router.get("/dashboard/school", authMiddleware, schoolFeesDashboard);
router.get("/batches/sent/:schoolId/:acYear/:status?", authMiddleware, listBatchesSentToHQForSchool);

export default router;
