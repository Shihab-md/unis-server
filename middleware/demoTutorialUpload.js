import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import multer from "multer";

const DEFAULT_MAX_MB = 100;
const configuredMaxMb = Number(process.env.DEMO_TUTORIAL_MAX_FILE_MB || DEFAULT_MAX_MB);
export const DEMO_TUTORIAL_MAX_FILE_MB = Number.isFinite(configuredMaxMb) && configuredMaxMb > 0
  ? configuredMaxMb
  : DEFAULT_MAX_MB;

const ALLOWED_EXTENSIONS = new Set([".pdf", ".mp4", ".webm", ".mov", ".m4v"]);
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-m4v",
  "application/octet-stream",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, os.tmpdir()),
  filename: (_req, file, callback) => {
    const ext = path.extname(String(file.originalname || "")).toLowerCase();
    callback(null, `unis-demo-tutorial-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
  },
});

const fileFilter = (_req, file, callback) => {
  const ext = path.extname(String(file.originalname || "")).toLowerCase();
  const mimeType = String(file.mimetype || "").toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIME_TYPES.has(mimeType)) {
    return callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "file"));
  }
  return callback(null, true);
};

export const demoTutorialUpload = multer({
  storage,
  fileFilter,
  limits: {
    files: 1,
    fileSize: Math.floor(DEMO_TUTORIAL_MAX_FILE_MB * 1024 * 1024),
  },
});

export const cleanupDemoTutorialTempFile = async (file) => {
  const filePath = String(file?.path || "");
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error("[demoTutorial] temp cleanup failed:", error?.message || error);
    }
  }
};

export const validateDemoTutorialFileSignature = async (file) => {
  if (!file?.path) throw new Error("File is required.");

  const handle = await fs.promises.open(file.path, "r");
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, bytesRead);
    const extension = path.extname(String(file.originalname || "")).toLowerCase();

    if (extension === ".pdf") {
      if (head.length < 5 || head.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new Error("The uploaded PDF file is invalid.");
      }
      file.mimetype = "application/pdf";
      return "PDF";
    }

    if (extension === ".webm") {
      const isWebm = head.length >= 4 &&
        head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
      if (!isWebm) throw new Error("The uploaded WEBM video file is invalid.");
      file.mimetype = "video/webm";
      return "VIDEO";
    }

    const isIsoVideo = head.length >= 8 && head.subarray(4, 8).toString("ascii") === "ftyp";
    if (!isIsoVideo) {
      throw new Error("The uploaded video file is invalid or unsupported.");
    }

    if (extension === ".mov") file.mimetype = "video/quicktime";
    else if (extension === ".m4v") file.mimetype = "video/x-m4v";
    else file.mimetype = "video/mp4";
    return "VIDEO";
  } finally {
    await handle.close();
  }
};

export const sendDemoTutorialUploadError = (error, req, res, next) => {
  if (!(error instanceof multer.MulterError)) return next(error);

  if (error.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({
      success: false,
      error: `File is too large. Maximum allowed size is ${DEMO_TUTORIAL_MAX_FILE_MB} MB.`,
    });
  }

  return res.status(400).json({
    success: false,
    error: "Only PDF, MP4, WEBM, MOV and M4V files are allowed.",
  });
};
