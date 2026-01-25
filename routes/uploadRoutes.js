import express from "express";
import authMiddleware from '../middleware/authMiddlware.js'
import { uploadProof } from "../middleware/upload.js";

const router = express.Router();

router.post("/proof", authMiddleware, uploadProof.single("file"), async (req, res) => {
  try {
    const url = `/uploads/proofs/${req.file.filename}`;
    return res.status(200).json({ success: true, url });
  } catch (e) {
    return res.status(500).json({ success: false, error: "upload failed" });
  }
});

export default router;
