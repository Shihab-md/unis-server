import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";
import { createBulkIhsCertificates } from "../controllers/certificateBulkIhsController.js";

const router = express.Router();

router.post("/create", authMiddleware, createBulkIhsCertificates);

export default router;