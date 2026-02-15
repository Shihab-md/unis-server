import express from "express";
import authMiddleware from '../middleware/authMiddlware.js'
import {
  listDueInvoicesForSchool,
  createPaymentBatch,
  schoolFeesDashboard,
} from "../controllers/feesController.js";

const router = express.Router();

router.get("/invoices/:schoolId/:acYear", authMiddleware, listDueInvoicesForSchool);
router.post("/payment-batches", authMiddleware, createPaymentBatch);
router.get("/dashboard/school", authMiddleware, schoolFeesDashboard);
 
export default router;
