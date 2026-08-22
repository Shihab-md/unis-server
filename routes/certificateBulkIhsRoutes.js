import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";
import { createBulkIhsCertificates } from "../controllers/certificateBulkIhsController.js";
import { requireHQ } from "../middleware/authorizationMiddleware.js";
import { auditMutation } from "../middleware/auditMiddleware.js";
import { notifyOnSuccess } from "../middleware/notificationMiddleware.js";

const router = express.Router();

const notifyBulkIhsComplete = notifyOnSuccess({
  type: "certificate.bulk.ihs", title: "Bulk IHS processing completed", message: "A bulk IHS certificate batch completed successfully.",
  resourceType: "BulkIhsCertificate", webPath: () => "/dashboard/certificate-bulk-ihs", mobilePath: () => "/(app)/bulk/ihs",
});
const notifyOnlyOnMobileFinalChunk = (notifier) => (req, res, next) =>
  String(req.headers["x-unis-final-chunk"] || "").toLowerCase() === "true" ? notifier(req, res, next) : next();

router.post("/create", authMiddleware,
  auditMutation({ action: "CERTIFICATE_BULK_IHS", resourceType: "BulkIhsCertificate" }),
  notifyOnlyOnMobileFinalChunk(notifyBulkIhsComplete),
  requireHQ, createBulkIhsCertificates);

export default router;
