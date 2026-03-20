import multer from "multer";
import { google } from "googleapis";
import { Readable } from "stream";
import mongoose from "mongoose";

import InspectionReport from "../models/InspectionReport.js";
import School from "../models/School.js";
import IntegrationCredential from "../models/IntegrationCredential.js";
import { decryptText } from "../utils/cryptoHelper.js";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error("Only pdf, jpg, jpeg, png files are allowed."));
    }
    cb(null, true);
  },
});

export const uploadInspectionReportFiles = upload.array("attachments", 10);

const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const htmlToPlainText = (html = "") =>
  String(html || "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getUserMeta = (req) => {
  const user = req.user || {};
  return {
    id: user._id || user.id || null,
    role: String(user.role || "").toLowerCase(),
    name: user.name || user.fullName || user.username || user.email || "User",
    schoolId: user.schoolId || null,
  };
};

const getNiswanValue = (schoolDoc) => {
  if (!schoolDoc) return "";
  if (typeof schoolDoc.niswan === "string") return schoolDoc.niswan;
  if (typeof schoolDoc.isNiswan === "boolean") return schoolDoc.isNiswan ? "Yes" : "No";
  if (typeof schoolDoc.niswan === "boolean") return schoolDoc.niswan ? "Yes" : "No";
  return "";
};

const buildDriveClient = async () => {
  const credential = await IntegrationCredential.findOne({
    $or: [
      { provider: "google-drive" },
      { provider: "google_drive" },
      { service: "google-drive" },
      { service: "google_drive" },
      { type: "google-drive" },
      { type: "google_drive" },
    ],
  }).sort({ createdAt: -1 });

  if (!credential) {
    throw new Error("Google Drive is not connected. Please reconnect Google Drive.");
  }

  const clientId =
    credential.clientId ||
    process.env.GOOGLE_CLIENT_ID ||
    process.env.GDRIVE_CLIENT_ID;

  const clientSecret =
    credential.clientSecret ||
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.GDRIVE_CLIENT_SECRET;

  const redirectUri =
    credential.redirectUri ||
    process.env.GOOGLE_REDIRECT_URI ||
    process.env.GDRIVE_REDIRECT_URI;

  const accessTokenEncrypted =
    credential.accessToken ||
    credential.encryptedAccessToken ||
    credential.token;

  const refreshTokenEncrypted =
    credential.refreshToken ||
    credential.encryptedRefreshToken;

  const expiryDate =
    credential.expiryDate ||
    credential.tokenExpiryDate ||
    credential.expiry_date ||
    null;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google Drive client configuration is incomplete.");
  }

  if (!accessTokenEncrypted || !refreshTokenEncrypted) {
    throw new Error("Google Drive connection expired. Please reconnect Google Drive.");
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  let accessToken = accessTokenEncrypted;
  let refreshToken = refreshTokenEncrypted;

  try {
    accessToken = decryptText(accessTokenEncrypted);
  } catch (_) {}

  try {
    refreshToken = decryptText(refreshTokenEncrypted);
  } catch (_) {}

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: expiryDate ? new Date(expiryDate).getTime() : undefined,
  });

  try {
    await oauth2Client.getAccessToken();
  } catch (error) {
    throw new Error("Google Drive connection expired. Please reconnect Google Drive.");
  }

  return google.drive({
    version: "v3",
    auth: oauth2Client,
  });
};

const findFolderByName = async (drive, name, parentId = null) => {
  const parentClause = parentId ? `'${parentId}' in parents and ` : "";
  const response = await drive.files.list({
    q: `${parentClause}mimeType='application/vnd.google-apps.folder' and trashed=false and name='${name.replace(/'/g, "\\'")}'`,
    fields: "files(id, name)",
    pageSize: 10,
  });

  return response.data.files?.[0] || null;
};

const createFolder = async (drive, name, parentId = null) => {
  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: "id, name",
  });

  return response.data;
};

const ensureFolder = async (drive, name, parentId = null) => {
  const existing = await findFolderByName(drive, name, parentId);
  if (existing) return existing.id;
  const created = await createFolder(drive, name, parentId);
  return created.id;
};

const ensureInspectionReportsFolder = async (drive) => {
  const unisFolderId = await ensureFolder(drive, "UNIS");
  const reportsFolderId = await ensureFolder(drive, "InspectionReports", unisFolderId);
  return reportsFolderId;
};

const uploadBufferToDrive = async (drive, folderId, file) => {
  const response = await drive.files.create({
    requestBody: {
      name: file.originalname,
      parents: [folderId],
    },
    media: {
      mimeType: file.mimetype,
      body: Readable.from(file.buffer),
    },
    fields: "id, name, webViewLink, webContentLink, mimeType, size",
  });

  const uploaded = response.data;

  return {
    fileName: uploaded.name || file.originalname,
    mimeType: uploaded.mimeType || file.mimetype,
    size: Number(uploaded.size || file.size || 0),
    driveFileId: uploaded.id,
    driveViewUrl: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
    driveDownloadUrl:
      uploaded.webContentLink || `https://drive.google.com/uc?id=${uploaded.id}&export=download`,
  };
};

export const addInspectionReport = async (req, res) => {
  try {
    const user = getUserMeta(req);

    if (user.role !== "supervisor") {
      return res.status(403).json({
        success: false,
        message: "Only supervisor can submit inspection reports.",
      });
    }

    const { title, reportDate, acYear, contentHtml } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Inspection report title is required.",
      });
    }

    if (!reportDate) {
      return res.status(400).json({
        success: false,
        message: "Report date is required.",
      });
    }

    if (!acYear?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Academic year is required.",
      });
    }

    if (!contentHtml?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Inspection report content is required.",
      });
    }

    let schoolDoc = null;
    if (user.schoolId && mongoose.Types.ObjectId.isValid(user.schoolId)) {
      schoolDoc = await School.findById(user.schoolId).lean();
    }

    const schoolName = schoolDoc?.name || schoolDoc?.schoolName || "";
    const niswan = getNiswanValue(schoolDoc);

    let attachments = [];
    if (req.files?.length) {
      const drive = await buildDriveClient();
      const reportsFolderId = await ensureInspectionReportsFolder(drive);

      attachments = await Promise.all(
        req.files.map((file) => uploadBufferToDrive(drive, reportsFolderId, file))
      );
    }

    const inspectionReport = await InspectionReport.create({
      title: title.trim(),
      reportDate: new Date(reportDate),
      schoolId: user.schoolId || null,
      schoolName,
      supervisorId: user.id,
      supervisorName: user.name,
      niswan,
      acYear: acYear.trim(),
      contentHtml,
      contentText: req.body.contentText?.trim() || htmlToPlainText(contentHtml),
      attachments,
      createdBy: user.id,
    });

    return res.status(201).json({
      success: true,
      message: "Inspection report submitted successfully.",
      data: inspectionReport,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to submit inspection report.",
    });
  }
};

export const getInspectionReports = async (req, res) => {
  try {
    const user = getUserMeta(req);
    const { q = "", acYear = "", fromDate = "", toDate = "" } = req.query;

    const filter = {};

    if (user.role === "supervisor") {
      filter.supervisorId = user.id;
    }

    if (acYear?.trim()) {
      filter.acYear = acYear.trim();
    }

    if (fromDate || toDate) {
      filter.reportDate = {};
      if (fromDate) filter.reportDate.$gte = new Date(fromDate);
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        filter.reportDate.$lte = end;
      }
    }

    if (q?.trim()) {
      const regex = new RegExp(escapeRegex(q.trim()), "i");
      filter.$or = [
        { title: regex },
        { supervisorName: regex },
        { schoolName: regex },
        { niswan: regex },
        { acYear: regex },
        { contentText: regex },
      ];
    }

    const inspectionReports = await InspectionReport.find(filter)
      .sort({ reportDate: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: inspectionReports,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch inspection reports.",
    });
  }
};

export const getMyInspectionReports = async (req, res) => {
  try {
    const user = getUserMeta(req);

    const inspectionReports = await InspectionReport.find({ supervisorId: user.id })
      .sort({ reportDate: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: inspectionReports,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch my inspection reports.",
    });
  }
};

export const getInspectionReportById = async (req, res) => {
  try {
    const user = getUserMeta(req);
    const { id } = req.params;

    const inspectionReport = await InspectionReport.findById(id).lean();

    if (!inspectionReport) {
      return res.status(404).json({
        success: false,
        message: "Inspection report not found.",
      });
    }

    if (
      user.role === "supervisor" &&
      String(inspectionReport.supervisorId) !== String(user.id)
    ) {
      return res.status(403).json({
        success: false,
        message: "You can view only your own inspection reports.",
      });
    }

    return res.status(200).json({
      success: true,
      data: inspectionReport,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch inspection report.",
    });
  }
};