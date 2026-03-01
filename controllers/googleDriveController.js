import jwt from "jsonwebtoken";
import multer from "multer";
import IntegrationCredential from "../models/IntegrationCredential.js";
import { encryptText } from "../utils/cryptoHelper.js";
import { google } from "googleapis";
import { ensureUNISPaymentProofsFolder, uploadProofToDrive } from "../services/googleDriveService.js";

const requireRole = (role, allowed) => {
  if (!allowed.includes(role)) {
    const err = new Error("Forbidden");
    err.status = 403;
    throw err;
  }
};

const storage = multer.memoryStorage();
export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "application/pdf"].includes(file.mimetype);
    cb(ok ? null : new Error("Only jpg/png/pdf allowed"), ok);
  },
});

const buildRawOAuthClient = () =>
  new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

const frontendRedirect = (qs) => {
  const fe = process.env.FRONTEND_BASE_URL || "https://www.unis.org.in";
  const path = process.env.FRONTEND_CONNECT_DRIVE_PATH || "/dashboard/admin/connect-drive";
  return `${fe}${path}${qs}`;
};

export const getAuthUrl = async (req, res) => {
  try {
    requireRole(req.user?.role, ["superadmin", "hquser"]);

    const state = jwt.sign(
      { uid: req.user?._id, role: req.user?.role },
      process.env.JWT_SECRET,
      { expiresIn: "10m" }
    );

    const oAuth2Client = buildRawOAuthClient();
    const url = oAuth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/drive.file"],
      state,
    });

    return res.status(200).json({ success: true, url });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, error: e.message || "server error" });
  }
};

export const callback = async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.redirect(frontendRedirect("?status=fail&reason=missing_code"));
    if (!state) return res.redirect(frontendRedirect("?status=fail&reason=missing_state"));

    const decoded = jwt.verify(state, process.env.JWT_SECRET);
    if (!decoded?.uid) return res.redirect(frontendRedirect("?status=fail&reason=invalid_state"));

    const oAuth2Client = buildRawOAuthClient();
    const { tokens } = await oAuth2Client.getToken(code);

    if (!tokens?.refresh_token) {
      return res.redirect(frontendRedirect("?status=fail&reason=no_refresh_token"));
    }

    oAuth2Client.setCredentials({ refresh_token: tokens.refresh_token });
    const folderId = await ensureUNISPaymentProofsFolder(oAuth2Client);

    await IntegrationCredential.findOneAndUpdate(
      { key: "google_drive" },
      {
        key: "google_drive",
        refreshTokenEnc: encryptText(tokens.refresh_token),
        folderId,
        connectedBy: decoded.uid,
        connectedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    return res.redirect(frontendRedirect("?status=ok"));
  } catch (e) {
    console.log(e);
    return res.redirect(frontendRedirect("?status=fail&reason=server_error"));
  }
};

export const status = async (req, res) => {
  try {
    requireRole(req.user?.role, ["superadmin", "hquser"]);

    const cred = await IntegrationCredential.findOne({ key: "google_drive" }).lean();
    return res.status(200).json({
      success: true,
      connected: !!cred,
      folderId: cred?.folderId || null,
      connectedAt: cred?.connectedAt || null,
    });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, error: e.message || "server error" });
  }
};

export const disconnect = async (req, res) => {
  try {
    requireRole(req.user?.role, ["superadmin", "hquser"]);
    await IntegrationCredential.deleteOne({ key: "google_drive" });
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, error: e.message || "server error" });
  }
};

export const uploadProof = async (req, res) => {
  try {
    requireRole(req.user?.role, ["superadmin", "hquser", "admin"]);

    if (!req.file) return res.status(400).json({ success: false, error: "Missing file" });

    const out = await uploadProofToDrive({ file: req.file });
    return res.status(200).json({ success: true, ...out });
  } catch (e) {
    console.log(e);
    return res.status(e.status || 500).json({ success: false, error: e.message || "server error" });
  }
};