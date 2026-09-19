import express from "express";
import authMiddleware from "../middleware/authMiddlware.js";
import { requireHQ } from "../middleware/authorizationMiddleware.js";
import {
  createTempSchoolMarksheets,
  getTempSchoolTemplateInfo,
} from "../controllers/tempSchoolMarksheetController.js";

const router = express.Router();

router.get("/template-info", authMiddleware, requireHQ, getTempSchoolTemplateInfo);
router.post("/create", authMiddleware, requireHQ, createTempSchoolMarksheets);

export default router;
