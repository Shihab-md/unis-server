import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";
import { auditMutation } from "../middleware/auditMiddleware.js";
import {
  createDemoTutorial,
  createDemoTutorialReplacementSession,
  createDemoTutorialUploadSession,
  deleteDemoTutorial,
  downloadDemoTutorial,
  downloadDemoTutorialChunk,
  getDemoTutorial,
  listDemoTutorials,
  updateDemoTutorial,
} from "../controllers/demoTutorialController.js";

const router = express.Router();

const requireSuperadmin = (req, res, next) => {
  if (String(req.user?.role || "").trim().toLowerCase() !== "superadmin") {
    return res.status(403).json({
      success: false,
      error: "Only Superadmin can manage Demo - Tutorial files.",
    });
  }
  return next();
};

router.get("/", authMiddleware, listDemoTutorials);

// Large files are uploaded directly from the browser to a Google Drive resumable
// session. Only small JSON metadata passes through Vercel.
router.post(
  "/upload-session",
  authMiddleware,
  requireSuperadmin,
  createDemoTutorialUploadSession
);
router.post(
  "/:id/upload-session",
  authMiddleware,
  requireSuperadmin,
  createDemoTutorialReplacementSession
);

router.get("/:id/download", authMiddleware, downloadDemoTutorial);
router.get("/:id/download-chunk", authMiddleware, downloadDemoTutorialChunk);
router.get("/:id", authMiddleware, getDemoTutorial);

router.post(
  "/",
  authMiddleware,
  requireSuperadmin,
  auditMutation({ action: "DEMO_TUTORIAL_CREATE", resourceType: "DemoTutorial" }),
  createDemoTutorial
);

router.put(
  "/:id",
  authMiddleware,
  requireSuperadmin,
  auditMutation({ action: "DEMO_TUTORIAL_UPDATE", resourceType: "DemoTutorial" }),
  updateDemoTutorial
);

router.delete(
  "/:id",
  authMiddleware,
  requireSuperadmin,
  auditMutation({ action: "DEMO_TUTORIAL_DELETE", resourceType: "DemoTutorial" }),
  deleteDemoTutorial
);

export default router;
