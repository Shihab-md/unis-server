import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";
import { auditMutation } from "../middleware/auditMiddleware.js";
import {
  demoTutorialUpload,
  sendDemoTutorialUploadError,
} from "../middleware/demoTutorialUpload.js";
import {
  createDemoTutorial,
  deleteDemoTutorial,
  downloadDemoTutorial,
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
router.get("/:id", authMiddleware, getDemoTutorial);
router.get("/:id/download", authMiddleware, downloadDemoTutorial);

router.post(
  "/",
  authMiddleware,
  requireSuperadmin,
  demoTutorialUpload.single("file"),
  auditMutation({ action: "DEMO_TUTORIAL_CREATE", resourceType: "DemoTutorial" }),
  createDemoTutorial
);

router.put(
  "/:id",
  authMiddleware,
  requireSuperadmin,
  demoTutorialUpload.single("file"),
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

router.use(sendDemoTutorialUploadError);

export default router;
