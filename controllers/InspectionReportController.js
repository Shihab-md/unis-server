import multer from "multer";
import { google } from "googleapis";
import { Readable } from "stream";
import mongoose from "mongoose";
import Supervisor from "../models/Supervisor.js";
import InspectionReport from "../models/InspectionReport.js";
import School from "../models/School.js";
import IntegrationCredential from "../models/IntegrationCredential.js";
import { decryptText } from "../utils/cryptoHelper.js";
import { getActiveAcademicYearIdFromCache } from "./academicYearController.js";

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
    const ok = ALLOWED_MIME_TYPES.includes(file.mimetype);
    cb(ok ? null : new Error("Only pdf, jpg, jpeg, png files are allowed."), ok);
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
  const rawSchoolId = user.schoolId?._id || user.schoolId || null;

  return {
    id: user._id || user.id || null,
    role: String(user.role || "").toLowerCase(),
    name: user.name || user.fullName || user.username || user.email || "User",
    schoolId: rawSchoolId ? String(rawSchoolId) : null,
  };
};

const getNiswanValue = (schoolDoc) => {
  if (!schoolDoc) return "";
  if (typeof schoolDoc.code === "string" && schoolDoc.code.trim()) return schoolDoc.code.trim();
  if (typeof schoolDoc.niswan === "string" && schoolDoc.niswan.trim()) return schoolDoc.niswan.trim();
  if (typeof schoolDoc.isNiswan === "boolean") return schoolDoc.isNiswan ? "Yes" : "No";
  if (typeof schoolDoc.niswan === "boolean") return schoolDoc.niswan ? "Yes" : "No";
  return "";
};

const buildRawOAuthClient = () =>
  new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

const buildDriveClient = async () => {
  const cred = await IntegrationCredential.findOne({ key: "google_drive" }).sort({
    updatedAt: -1,
    createdAt: -1,
  });

  if (!cred) {
    throw new Error("Google Drive is not connected. Please reconnect Google Drive.");
  }

  if (!cred.refreshTokenEnc) {
    throw new Error("Google Drive connection expired. Please reconnect Google Drive.");
  }

  const refreshToken = decryptText(cred.refreshTokenEnc);

  const oAuth2Client = buildRawOAuthClient();
  oAuth2Client.setCredentials({ refresh_token: refreshToken });

  try {
    await oAuth2Client.getAccessToken();
  } catch (error) {
    console.log("[InspectionReport] Google Drive auth error:", error?.message || error);
    throw new Error("Google Drive connection expired. Please reconnect Google Drive.");
  }

  return google.drive({
    version: "v3",
    auth: oAuth2Client,
  });
};

const findFolderByName = async (drive, name, parentId = null) => {
  const safeName = String(name).replace(/'/g, "\\'");
  const parentClause = parentId ? `'${parentId}' in parents and ` : "";

  const response = await drive.files.list({
    q: `${parentClause}mimeType='application/vnd.google-apps.folder' and trashed=false and name='${safeName}'`,
    fields: "files(id, name)",
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
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
    supportsAllDrives: true,
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

const buildTimestampedFileName = (originalName = "") => {
  const dotIndex = originalName.lastIndexOf(".");
  const hasExt = dotIndex > 0;

  const baseName = hasExt ? originalName.slice(0, dotIndex) : originalName;
  const extension = hasExt ? originalName.slice(dotIndex) : "";

  const safeBaseName = String(baseName)
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w.-]/g, "");

  const now = new Date();
  const timestamp =
    now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    "_" +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");

  return `${safeBaseName}_${timestamp}${extension}`;
};

const uploadBufferToDrive = async (drive, folderId, file) => {
  const timestampedFileName = buildTimestampedFileName(file.originalname);
  const response = await drive.files.create({
    requestBody: {
      name: timestampedFileName,
      parents: [folderId],
    },
    media: {
      mimeType: file.mimetype,
      body: Readable.from(file.buffer),
    },
    fields: "id, name, webViewLink, webContentLink, mimeType, size",
    supportsAllDrives: true,
  });

  const uploaded = response.data;

  return {
    fileName: uploaded.name || file.originalname,
    mimeType: uploaded.mimeType || file.mimetype,
    size: Number(uploaded.size || file.size || 0),
    driveFileId: uploaded.id,
    driveViewUrl:
      uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
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

    const { title, schoolId, reportDate, contentHtml } = req.body;

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

    const parsedReportDate = new Date(`${reportDate}T00:00:00`);
    if (Number.isNaN(parsedReportDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid report date.",
      });
    }

    if (!contentHtml?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Inspection report content is required.",
      });
    }

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
      reportDate: parsedReportDate,
      schoolId: schoolId,
      userId: user.id,
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
    console.log("[InspectionReport] addInspectionReport error:", error?.message || error);

    const message = error?.message || "Failed to submit inspection report.";
    const statusCode = message.includes("Google Drive") ? 400 : 500;

    return res.status(statusCode).json({
      success: false,
      message,
    });
  }
};

export const getInspectionReports = async (req, res) => {
  try {
    console.log("called : getInspectionReports");

    const user = getUserMeta(req);
    const { q = "", fromDate = "", toDate = "" } = req.query;

    const filter = {};

    if (user.role === "supervisor") {
      filter.userId = user.id;
    }

    if (fromDate || toDate) {
      filter.reportDate = {};

      if (fromDate) {
        const from = new Date(`${fromDate}T00:00:00`);
        if (!Number.isNaN(from.getTime())) {
          filter.reportDate.$gte = from;
        }
      }

      if (toDate) {
        const end = new Date(`${toDate}T23:59:59.999`);
        if (!Number.isNaN(end.getTime())) {
          filter.reportDate.$lte = end;
        }
      }
    }

    const inspectionReports = await InspectionReport.find(filter)
      .populate({
        path: "userId",
        select: "name email",
      })
      .populate({
        path: "schoolId",
        select: "code nameEnglish nameArabic nameNative districtStateId",
        populate: {
          path: "districtStateId",
          select: "district state",
        },
      })
      .sort({ reportDate: -1, createdAt: -1 })
      .lean();

    const userIds = [
      ...new Set(
        inspectionReports
          .map((report) => String(report.userId?._id || report.userId || ""))
          .filter(Boolean)
      ),
    ];

    const supervisors = userIds.length
      ? await Supervisor.find({ userId: { $in: userIds } })
        .select("userId supervisorId")
        .lean()
      : [];

    const supervisorIdMap = new Map(
      supervisors.map((sup) => [String(sup.userId), sup.supervisorId || "-"])
    );

    let data = inspectionReports.map((report) => {
      const school = report.schoolId || {};
      const supervisor = report.userId || {};
      const reportUserId = String(supervisor._id || report.userId || "");

      const schoolCode = school.code || "-";
      const schoolName = school.nameEnglish || "-";
      const schoolNameArabic = school.nameArabic || "-";
      const schoolNameNative = school.nameNative || "-";
      const districtState = school?.districtStateId?.district + ", " + school?.districtStateId?.state;

      return {
        _id: report._id,
        title: report.title || "-",
        reportDate: report.reportDate || null,

        userId: supervisor._id || null,
        supervisorId: supervisorIdMap.get(reportUserId) || "-",
        supervisorName: supervisor.name || "-",
        supervisorEmail: supervisor.email || "-",

        schoolId: school._id || null,
        schoolCode,
        schoolName,
        schoolNameArabic,
        schoolNameNative,
        districtState,

        contentText: report.contentText || "",
        attachments: Array.isArray(report.attachments) ? report.attachments : [],
        createdAt: report.createdAt || null,
        updatedAt: report.updatedAt || null,
      };
    });

    if (q?.trim()) {
      const search = q.trim().toLowerCase();

      data = data.filter((report) =>
        String(report.title || "").toLowerCase().includes(search) ||
        String(report.supervisorId || "").toLowerCase().includes(search) ||
        String(report.supervisorName || "").toLowerCase().includes(search) ||
        String(report.schoolCode || "").toLowerCase().includes(search) ||
        String(report.schoolName || "").toLowerCase().includes(search) ||
        String(report.contentText || "").toLowerCase().includes(search)
      );
    }

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.log("getInspectionReports error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch inspection reports.",
    });
  }
};

export const getMyInspectionReports = async (req, res) => {
  try {
    console.log("called : getMyInspectionReports");
    const user = getUserMeta(req);
    console.log(user);
    const inspectionReports = await InspectionReport.find({ userId: user.id })
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

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid inspection report id.",
      });
    }

    const inspectionReport = await InspectionReport.findById(id)
      .populate({
        path: "userId",
        select: "name email",
      })
      .populate({
        path: "schoolId",
        select: "code nameEnglish nameArabic nameNative districtStateId",
        populate: {
          path: "districtStateId",
          select: "district state",
        },
      })
      .lean();

    if (!inspectionReport) {
      return res.status(404).json({
        success: false,
        message: "Inspection report not found.",
      });
    }

    if (
      user.role === "supervisor" &&
      String(inspectionReport.userId?._id) !== String(user.id)
    ) {
      return res.status(403).json({
        success: false,
        message: "You can view only your own inspection reports.",
      });
    }

    const supervisorDoc = await Supervisor.findOne({
      userId: inspectionReport.userId?._id || inspectionReport.userId,
    })
      .select("supervisorId contactNumber routeName")
      .lean();

    inspectionReport.supervisorId = supervisorDoc?.supervisorId || "-";
    inspectionReport.contactNumber = supervisorDoc?.contactNumber || "-";
    inspectionReport.routeName = supervisorDoc?.routeName || "-";

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