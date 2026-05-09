import crypto from "crypto";
import { google } from "googleapis";
import { Readable } from "stream";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import Template from "../models/Template.js";
import Numbering from "../models/Numbering.js";
import IntegrationCredential from "../models/IntegrationCredential.js";
import IhsBulkCertificate from "../models/IhsBulkCertificate.js";

import { decryptText } from "../utils/cryptoHelper.js";
import {
  IHS_TEMPLATE_MAP,
  normalizeBulkIhsRow,
} from "../utils/ihsBulkTemplateHelper.js";

const PDF_COLOR_BODY_BLUE = rgb(14 / 255, 56 / 255, 194 / 255);

const SPECIAL_CERTIFICATE_LAYOUT = {
  studentName: {
    x: 400,
    yFromTop: 273,
    size: 11,
    align: "center",
    maxWidth: 320,
  },
  guardianName: {
    x: 340,
    yFromTop: 298,
    size: 11,
    align: "center",
    maxWidth: 280,
  },
  rollNumber: {
    x: 660,
    yFromTop: 273,
    size: 11,
    align: "left",
    maxWidth: 100,
  },
  certificateNum: {
    x: 170,
    yFromTop: 416,
    size: 10,
    align: "left",
    maxWidth: 90,
  },
  issueDate: {
    x: 170,
    yFromTop: 430,
    size: 10,
    align: "left",
    maxWidth: 90,
  },
};

const buildGoogleOauthFingerprint = () => {
  const raw = [
    process.env.GOOGLE_CLIENT_ID || "",
    process.env.GOOGLE_CLIENT_SECRET || "",
    process.env.GOOGLE_REDIRECT_URI || "",
  ].join("|");

  return crypto.createHash("sha256").update(raw).digest("hex");
};

const looksLikeRefreshToken = (token) => {
  if (!token || typeof token !== "string") return false;
  const t = token.trim();
  return t.length > 20 && !t.includes(" ") && !t.includes("\n");
};

const maskToken = (token) => {
  if (!token) return "EMPTY";
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
};

const markDriveExpired = async (message = "invalid_grant") => {
  try {
    await IntegrationCredential.updateOne(
      { key: "google_drive" },
      {
        $set: {
          status: "EXPIRED",
          lastError: message,
          updatedAt: new Date(),
        },
      }
    );
  } catch (e) {
    console.log("markDriveExpired error:", e?.message || e);
  }
};

const buildDriveClient = async () => {
  try {
    const cred = await IntegrationCredential.findOne({ key: "google_drive" }).lean();

    if (!cred?.refreshTokenEnc) {
      throw new Error("Google Drive not connected");
    }

    const expectedFingerprint = buildGoogleOauthFingerprint();

    if (cred?.oauthFingerprint && cred.oauthFingerprint !== expectedFingerprint) {
      throw new Error("Google OAuth configuration changed. Please reconnect Google Drive.");
    }

    const refreshToken = decryptText(cred.refreshTokenEnc);

    if (!looksLikeRefreshToken(refreshToken)) {
      console.log("Invalid decrypted refresh token:", maskToken(refreshToken));
      throw new Error("Stored Google Drive token is invalid. Please reconnect Google Drive.");
    }

    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oAuth2Client.setCredentials({ refresh_token: refreshToken });

    await oAuth2Client.getAccessToken();

    await IntegrationCredential.updateOne(
      { key: "google_drive" },
      {
        $set: {
          status: "ACTIVE",
          lastError: "",
          lastValidatedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );

    const drive = google.drive({ version: "v3", auth: oAuth2Client });
    return { drive };
  } catch (error) {
    console.log("buildDriveClient error:", error?.response?.data || error?.message || error);

    if (
      error?.response?.data?.error === "invalid_grant" ||
      String(error?.message || "").includes("invalid_grant")
    ) {
      await markDriveExpired("invalid_grant");
      throw new Error("Google Drive connection expired. Please reconnect Google Drive.");
    }

    throw error;
  }
};

const runWithDriveRetry = async (fn) => {
  try {
    const { drive } = await buildDriveClient();
    return await fn(drive);
  } catch (error) {
    const msg = String(error?.message || "");

    const shouldNotRetry =
      msg.includes("reconnect Google Drive") ||
      msg.includes("OAuth configuration changed") ||
      msg.includes("Stored Google Drive token is invalid");

    if (shouldNotRetry) {
      throw error;
    }

    console.log("Retrying Drive operation once...");
    const { drive } = await buildDriveClient();
    return await fn(drive);
  }
};

const findChildFolderId = async (drive, parentId, folderName) => {
  const safeName = String(folderName).replace(/'/g, "\\'");
  const q = [
    "mimeType='application/vnd.google-apps.folder'",
    `name='${safeName}'`,
    "trashed=false",
    parentId ? `'${parentId}' in parents` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  const res = await drive.files.list({
    q,
    fields: "files(id,name)",
    spaces: "drive",
    pageSize: 1,
  });

  return res.data.files?.[0]?.id || null;
};

const createFolder = async (drive, parentId, folderName) => {
  const res = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: "id",
  });

  return res.data.id;
};

const ensureFolderPath = async (drive, parts = []) => {
  let parentId = null;
  for (const name of parts) {
    let id = await findChildFolderId(drive, parentId, name);
    if (!id) id = await createFolder(drive, parentId, name);
    parentId = id;
  }
  return parentId;
};

const drivePreviewUrl = (fileId) => `https://drive.google.com/uc?export=view&id=${fileId}`;
const driveDownloadUrl = (fileId) => `https://drive.google.com/uc?export=download&id=${fileId}`;

const pad2 = (n) => String(n).padStart(2, "0");

const formatTs = (d = new Date()) => {
  const DD = pad2(d.getDate());
  const MM = pad2(d.getMonth() + 1);
  const YYYY = d.getFullYear();
  const HH = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${DD}${MM}${YYYY}${HH}${mm}${ss}`;
};

const buildTimestampedName = (originalName = "file.pdf") => {
  const dot = originalName.lastIndexOf(".");
  const base = dot > 0 ? originalName.slice(0, dot) : originalName;
  const ext = dot > 0 ? originalName.slice(dot) : ".pdf";
  const safeBase = base
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${safeBase || "file"}_${formatTs()}${ext}`;
};

const uploadBufferToDrive = async (drive, folderId, fileName, buffer, mimeType) => {
  const stream = Readable.from(buffer);

  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: stream },
    fields: "id,name,webViewLink",
  });

  const fileId = res.data.id;

  await drive.permissions.create({
    fileId,
    requestBody: { type: "anyone", role: "reader" },
  });

  return {
    fileId,
    fileName: res.data.name,
    viewUrl: res.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
    previewUrl: drivePreviewUrl(fileId),
    downloadUrl: driveDownloadUrl(fileId),
  };
};

const fetchBinary = async (url) => {
  const response = await fetch(String(url || "").replace("?download=1", ""));
  if (!response.ok) {
    throw new Error(`Failed to fetch binary: ${url}, status: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

const loadTemplatePdf = async (templateUrl) => {
  const bytes = await fetchBinary(templateUrl);
  return PDFDocument.load(bytes);
};

const padSerialNumber = (value, length = 6) => {
  return String(value || 0).padStart(length, "0");
};

const getNextIhsCertificateNumber = async () => {
  const currentYear = new Date().getFullYear();

  const numbering = await Numbering.findOneAndUpdate(
    { name: "ihs" },
    {
      $inc: { currentNumber: 1 },
      $set: { updatedAt: new Date() },
      $setOnInsert: {
        name: "ihs",
        createAt: new Date(),
      },
    },
    {
      new: true,
      upsert: true,
    }
  );

  if (!numbering) {
    throw new Error("Unable to generate certificate number for IHS.");
  }

  return `IHS${currentYear}${padSerialNumber(numbering.currentNumber, 6)}`;
};

const fitPdfFontSize = (font, text, startSize, maxWidth, minSize = 8) => {
  const value = String(text || "");
  let size = startSize;

  while (size > minSize) {
    const width = font.widthOfTextAtSize(value, size);
    if (width <= maxWidth) break;
    size -= 0.5;
  }

  return size;
};

const pdfYFromCanvasBaseline = (pageHeight, yFromTop, fontSize) => {
  return pageHeight - yFromTop - fontSize * 0.22;
};

const drawPdfText = ({
  page,
  text,
  x,
  yFromTop,
  size,
  font,
  color,
  align = "left",
  maxWidth,
}) => {
  const value = String(text || "").trim();
  if (!value) return;

  const finalSize = maxWidth
    ? fitPdfFontSize(font, value, size, maxWidth, 8)
    : size;

  const textWidth = font.widthOfTextAtSize(value, finalSize);

  let drawX = x;
  if (align === "center") drawX = x - textWidth / 2;
  if (align === "right") drawX = x - textWidth;

  const drawY = pdfYFromCanvasBaseline(page.getHeight(), yFromTop, finalSize);

  page.drawText(value, {
    x: drawX,
    y: drawY,
    size: finalSize,
    font,
    color,
  });
};

const drawSpecialCertificateVectorTexts = async ({
  outputPdf,
  page,
  studentName,
  guardianName,
  rollNumber,
  certificateNum,
  issueDateText,
}) => {
  const helveticaBold = await outputPdf.embedFont(StandardFonts.HelveticaBold);

  drawPdfText({
    page,
    text: String(studentName || "").toUpperCase(),
    x: SPECIAL_CERTIFICATE_LAYOUT.studentName.x,
    yFromTop: SPECIAL_CERTIFICATE_LAYOUT.studentName.yFromTop,
    size: SPECIAL_CERTIFICATE_LAYOUT.studentName.size,
    font: helveticaBold,
    color: PDF_COLOR_BODY_BLUE,
    align: SPECIAL_CERTIFICATE_LAYOUT.studentName.align,
    maxWidth: SPECIAL_CERTIFICATE_LAYOUT.studentName.maxWidth,
  });

  drawPdfText({
    page,
    text: String(guardianName || "").toUpperCase(),
    x: SPECIAL_CERTIFICATE_LAYOUT.guardianName.x,
    yFromTop: SPECIAL_CERTIFICATE_LAYOUT.guardianName.yFromTop,
    size: SPECIAL_CERTIFICATE_LAYOUT.guardianName.size,
    font: helveticaBold,
    color: PDF_COLOR_BODY_BLUE,
    align: SPECIAL_CERTIFICATE_LAYOUT.guardianName.align,
    maxWidth: SPECIAL_CERTIFICATE_LAYOUT.guardianName.maxWidth,
  });

  drawPdfText({
    page,
    text: String(rollNumber || "").toUpperCase(),
    x: SPECIAL_CERTIFICATE_LAYOUT.rollNumber.x,
    yFromTop: SPECIAL_CERTIFICATE_LAYOUT.rollNumber.yFromTop,
    size: SPECIAL_CERTIFICATE_LAYOUT.rollNumber.size,
    font: helveticaBold,
    color: PDF_COLOR_BODY_BLUE,
    align: SPECIAL_CERTIFICATE_LAYOUT.rollNumber.align,
    maxWidth: SPECIAL_CERTIFICATE_LAYOUT.rollNumber.maxWidth,
  });

  drawPdfText({
    page,
    text: String(certificateNum),
    x: SPECIAL_CERTIFICATE_LAYOUT.certificateNum.x,
    yFromTop: SPECIAL_CERTIFICATE_LAYOUT.certificateNum.yFromTop,
    size: SPECIAL_CERTIFICATE_LAYOUT.certificateNum.size,
    font: helveticaBold,
    color: PDF_COLOR_BODY_BLUE,
    align: SPECIAL_CERTIFICATE_LAYOUT.certificateNum.align,
    maxWidth: SPECIAL_CERTIFICATE_LAYOUT.certificateNum.maxWidth,
  });

  drawPdfText({
    page,
    text: issueDateText,
    x: SPECIAL_CERTIFICATE_LAYOUT.issueDate.x,
    yFromTop: SPECIAL_CERTIFICATE_LAYOUT.issueDate.yFromTop,
    size: SPECIAL_CERTIFICATE_LAYOUT.issueDate.size,
    font: helveticaBold,
    color: PDF_COLOR_BODY_BLUE,
    align: SPECIAL_CERTIFICATE_LAYOUT.issueDate.align,
    maxWidth: SPECIAL_CERTIFICATE_LAYOUT.issueDate.maxWidth,
  });
};

const buildSpecialCertificatePdfBuffer = async ({
  template,
  studentName,
  guardianName,
  rollNumber,
  certificateNum,
  issueDateText,
}) => {
  const templatePdf = await loadTemplatePdf(template.template);
  const outputPdf = await PDFDocument.create();

  const [basePage] = await outputPdf.copyPages(templatePdf, [0]);
  outputPdf.addPage(basePage);

  const page = outputPdf.getPage(0);

  await drawSpecialCertificateVectorTexts({
    outputPdf,
    page,
    studentName,
    guardianName,
    rollNumber,
    certificateNum,
    issueDateText,
  });

  return Buffer.from(await outputPdf.save());
};

const buildSafeCertificateBaseName = ({
  certificateNum,
  rollNumber,
  studentName,
}) =>
  `${certificateNum}_${rollNumber}_${studentName}_${new Date().getTime()}`
    .replace(/\s+/g, "_")
    .replace(/[^\w.-]/g, "");

export const processBulkIhsExcelRows = async ({ rows = [], createdBy = null }) => {
  const normalizedRows = (Array.isArray(rows) ? rows : []).map((row, index) =>
    normalizeBulkIhsRow(row, index)
  );

  const validRowsForDbCheck = normalizedRows.filter((row) => row.errors.length === 0);

  const templateIds = [...new Set(Object.values(IHS_TEMPLATE_MAP))];

  const templates = await Template.find({
    _id: { $in: templateIds },
  })
    .populate({
      path: "courseId",
      select: "_id name years",
    })
    .lean();

  const templateMap = new Map(
    templates.map((template) => [String(template._id), template])
  );

  const existingQuery = validRowsForDbCheck.length
    ? {
        $or: validRowsForDbCheck.map((row) => ({
          templateId: row.templateId,
          rollNumberText: row.rollNumber,
        })),
      }
    : null;

  const existingCertificates = existingQuery
    ? await IhsBulkCertificate.find(existingQuery)
        .select("templateId rollNumberText")
        .lean()
    : [];

  const existingSet = new Set(
    existingCertificates.map(
      (item) =>
        `${String(item.templateId)}__${String(item.rollNumberText || "").trim().toUpperCase()}`
    )
  );

  const requestDuplicateSet = new Set();

  const resultRows = [];
  let createdCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;
  let failedCount = 0;

  for (const row of normalizedRows) {
    try {
      if (row.errors.length > 0) {
        invalidCount += 1;
        resultRows.push({
          rowNumber: row.rowNumber,
          rollNumber: row.rollNumber,
          status: "INVALID",
          certificateNo: "",
          viewUrl: "",
          downloadUrl: "",
          message: row.errors.join(", "),
        });
        continue;
      }

      const duplicateKey = `${String(row.templateId)}__${String(row.rollNumber).trim().toUpperCase()}`;

      if (requestDuplicateSet.has(duplicateKey)) {
        duplicateCount += 1;
        resultRows.push({
          rowNumber: row.rowNumber,
          rollNumber: row.rollNumber,
          status: "DUPLICATE",
          certificateNo: "",
          viewUrl: "",
          downloadUrl: "",
          message: "Duplicate row in uploaded file",
        });
        continue;
      }

      requestDuplicateSet.add(duplicateKey);

      if (existingSet.has(duplicateKey)) {
        duplicateCount += 1;
        resultRows.push({
          rowNumber: row.rowNumber,
          rollNumber: row.rollNumber,
          status: "DUPLICATE",
          certificateNo: "",
          viewUrl: "",
          downloadUrl: "",
          message: "Certificate already exists",
        });
        continue;
      }

      const template = templateMap.get(String(row.templateId));
      if (!template) {
        throw new Error("Template not found for ihs_type");
      }

      const certificateNum = await getNextIhsCertificateNumber();

      const pdfBytes = await buildSpecialCertificatePdfBuffer({
        template,
        studentName: row.studentName,
        guardianName: row.guardianName,
        rollNumber: row.rollNumber,
        certificateNum,
        issueDateText: row.issueDateText,
      });

      const baseFileName = buildSafeCertificateBaseName({
        certificateNum,
        rollNumber: row.rollNumber,
        studentName: row.studentName,
      });

      const outName = buildTimestampedName(`${baseFileName}.pdf`);

      const uploaded = await runWithDriveRetry(async (drive) => {
        const folderId = await ensureFolderPath(drive, [
          "UNIS",
          "Certificates",
          "IHS Bulk Temporary",
        ]);
        return await uploadBufferToDrive(
          drive,
          folderId,
          outName,
          pdfBytes,
          "application/pdf"
        );
      });

      const newCertificate = new IhsBulkCertificate({
        code: certificateNum,
        templateId: template._id,
        courseId: template.courseId?._id || template.courseId,
        rollNumberText: row.rollNumber,
        studentNameText: row.studentName,
        guardianNameText: row.guardianName,
        schoolNameText: row.schoolName || "",
        ihsTypeText: row.ihsType,
        issueDate: row.issueDateObj,
        certificate: uploaded.previewUrl,
        certificateDriveFileId: uploaded.fileId,
        certificateDriveViewUrl: uploaded.viewUrl,
        certificateDriveDownloadUrl: uploaded.downloadUrl,
        certificateDrivePreviewUrl: uploaded.previewUrl,
        certificateFileName: uploaded.fileName,
        createdBy,
      });

      await newCertificate.save();

      createdCount += 1;
      existingSet.add(duplicateKey);

      resultRows.push({
        rowNumber: row.rowNumber,
        rollNumber: row.rollNumber,
        status: "CREATED",
        certificateNo: certificateNum,
        viewUrl: uploaded.previewUrl,
        downloadUrl: uploaded.downloadUrl,
        message: "Certificate created successfully",
      });
    } catch (error) {
      console.log("[processBulkIhsExcelRows] row error:", row?.rowNumber, error);
      failedCount += 1;

      resultRows.push({
        rowNumber: row?.rowNumber || "",
        rollNumber: row?.rollNumber || "",
        status: "FAILED",
        certificateNo: "",
        viewUrl: "",
        downloadUrl: "",
        message: error?.message || "Certificate creation failed",
      });
    }
  }

  return {
    summary: {
      total: normalizedRows.length,
      created: createdCount,
      duplicates: duplicateCount,
      invalid: invalidCount,
      failed: failedCount,
    },
    rows: resultRows,
  };
};