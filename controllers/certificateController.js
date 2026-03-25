import multer from "multer";
import crypto from "crypto";
import Certificate from "../models/Certificate.js";
import School from "../models/School.js";
import Student from "../models/Student.js";
import Template from "../models/Template.js";
import Academic from "../models/Academic.js";
import { createCanvas, registerFont } from "canvas";

import { google } from "googleapis";
import { Readable } from "stream";
import IntegrationCredential from "../models/IntegrationCredential.js";
import { decryptText } from "../utils/cryptoHelper.js";

import * as fs from "fs";
import * as path from "path";
import getRedis from "../db/redis.js";

import { PDFDocument } from "pdf-lib";

const upload = multer({});

// ---------------- Google Drive helpers (Certificates) ----------------
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

    // Force validate refresh token now
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

// ---------------- Common helpers ----------------
const fetchBinary = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch binary: ${url}, status: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

// ---------------- Font cache for canvas overlay ----------------
const registeredFontFamilies = new Set();

const ensureFontRegistered = async ({ url, fileName, family }) => {
  if (registeredFontFamilies.has(family)) return;

  const tempDir = path.join(process.cwd(), "tmp_fonts");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFontPath = path.join(tempDir, fileName);

  if (!fs.existsSync(tempFontPath)) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const fontBuffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(tempFontPath, fontBuffer);
  }

  registerFont(tempFontPath, { family });
  registeredFontFamilies.add(family);
};

const prepareCanvasFonts = async () => {
  try {
    await ensureFontRegistered({
      url: "https://www.unis.org.in/Nirmalab.ttc",
      fileName: "Nirmalab.ttc",
      family: "Nirmala",
    });

    await ensureFontRegistered({
      url: "https://www.unis.org.in/DUBAI-REGULAR.TTF",
      fileName: "DUBAI-REGULAR.TTF",
      family: "DUBAI-REGULAR",
    });

    await ensureFontRegistered({
      url: "https://www.unis.org.in/arial.ttf",
      fileName: "Arial.ttf",
      family: "Arial",
    });

    await ensureFontRegistered({
      url: "https://www.unis.org.in/arialbd.ttf",
      fileName: "Arial-Bold.ttf",
      family: "Arial-Bold",
    });

    await ensureFontRegistered({
      url: "https://www.unis.org.in/COMICZ.TTF",
      fileName: "COMICZ.TTF",
      family: "Comic",
    });

    await ensureFontRegistered({
      url: "https://www.unis.org.in/Amiri-Regular.ttf",
      fileName: "Amiri-Regular.ttf",
      family: "Amiri",
    });

    await ensureFontRegistered({
      url: "https://www.unis.org.in/Amiri-Bold.ttf",
      fileName: "Amiri-Bold.ttf",
      family: "Amiri Bold",
    });

    await ensureFontRegistered({
      url: "https://www.unis.org.in/NotoNaskhArabic-Regular.ttf",
      fileName: "NotoNaskhArabic-Regular.ttf",
      family: "Noto Naskh Arabic",
    });

    await ensureFontRegistered({
      url: "https://www.unis.org.in/georgiab.ttf",
      fileName: "georgiab.ttf",
      family: "georgiab",
    });
  } catch (error) {
    throw new Error("Font setting Error. " + error.toString());
  }
};

const formatArabicForCanvas = (text = "") => {
  const str = String(text).trim();

  // Wrap with RTL embedding marks
  return `\u202B${str}\u202C`;
};

const fixArabicBrackets = (text = "") => {
  return String(text)
    .replace(/\(/g, "﴿")
    .replace(/\)/g, "﴾");
};

const prepareArabicText = (text = "") => {
  return formatArabicForCanvas(fixArabicBrackets(text));
};

// ---------------- Canvas text helpers ----------------
const measureAndFit = (ctx, text, family, startSize, maxWidth, minSize = 8, weight = "") => {
  let size = startSize;
  const value = String(text || "");

  while (size > minSize) {
    ctx.font = `${weight ? weight + " " : ""}${size}px ${family}`;
    const w = ctx.measureText(value).width;
    if (w <= maxWidth) break;
    size -= 1;
  }

  return size;
};

// High-resolution transparent overlay for all dynamic text
const buildCertificateOverlayPng = async ({
  width,
  height,
  school,
  student,
  startYear,
  endYear,
  certificateNum,
  dat,
  issueDateText,
  tempType,
  grade,
  scale = 3,
}) => {
  const canvas = createCanvas(width * scale, height * scale);
  const ctx = canvas.getContext("2d");

  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.textBaseline = "alphabetic";

  const centerX = width / 2;

  // Header texts
  const nameArabic = school?.nameArabic ? String(school.nameArabic) : "";
  const nameNative = school?.nameNative ? String(school.nameNative) : "";
  const nameEnglish = school?.nameEnglish ? String(school.nameEnglish).toUpperCase() : "";
  const addressLine = [
    school?.address,
    school?.city,
    school?.districtStateId?.district,
    school?.districtStateId?.state,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .join(", ");

  const isMakthab = Number(tempType) === 1;
  const hasNative = Boolean(nameNative);

  const positions = isMakthab
    ? hasNative
      ? { arabic: 122, native: 147, english: 164, address: 179 }
      : { arabic: 115, english: 143, address: 160 }
    : hasNative
      ? { arabic: 93, native: 116, english: 135, address: 150 }
      : { arabic: 100, english: 128, address: 145 };

  const drawCenteredText = ({
    text,
    y,
    size,
    fontFamily,
    color,
    repeat = 1,
    weight = "",
    transform = (value) => value,
  }) => {
    if (!text) return;

    const finalText = transform(text);
    ctx.font = `${weight ? `${weight} ` : ""}${size}px ${fontFamily}`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";

    for (let i = 0; i < repeat; i += 1) {
      ctx.fillText(finalText, centerX, y);
    }
  };

  const drawArabic = (text, y, size) => {
    drawCenteredText({
      text,
      y,
      size,
      fontFamily: "Amiri Bold",
      color: "rgb(14, 84, 49)",
      transform: prepareArabicText,
    });
  };

  const drawNative = (text, y, size) => {
    drawCenteredText({
      text,
      y,
      size,
      fontFamily: "Nirmala",
      weight: "bold",
      color: "rgb(161, 14, 94)",
      repeat: 3,
    });
  };

  const drawEnglishFixed = (text, y, size) => {
    drawCenteredText({
      text,
      y,
      size,
      fontFamily: "Arial-bold",
      weight: "bold",
      color: "rgb(14, 84, 49)",
      repeat: 2,
    });
  };

  const drawEnglishFitted = (text, y) => {
    if (!text) return;

    const englishSize = measureAndFit(
      ctx,
      text,
      "Arial",
      15,
      width * 0.78,
      10,
      "bold"
    );

    drawCenteredText({
      text,
      y,
      size: englishSize,
      fontFamily: "Arial",
      weight: "bold",
      color: "rgb(161, 14, 94)",
      repeat: 2,
    });
  };

  const drawAddress = (text, y, size) => {
    drawCenteredText({
      text,
      y,
      size,
      fontFamily: "Arial-bold",
      weight: "bold",
      color: "rgb(4, 25, 93)",
    });
  };

  if (hasNative) {
    drawArabic(nameArabic, positions.arabic, 19);
    if (isMakthab) {
      drawNative(nameNative, positions.native, 12);
      drawEnglishFixed(nameEnglish, positions.english, 11.5);
    } else {
      drawNative(nameNative, positions.native, 13);
      drawEnglishFixed(nameEnglish, positions.english, 12);
    }

    drawAddress(addressLine, positions.address, 9);
  } else {
    drawArabic(nameArabic, positions.arabic, 21);
    drawEnglishFitted(nameEnglish, positions.english);
    drawAddress(addressLine, positions.address, 10);
  }

  // Body texts
  const name = student?.userId?.name ? String(student.userId.name).toUpperCase() : "";
  const rollNumber = student?.rollNumber ? String(student.rollNumber).toUpperCase() : "";
  const fatherName = student?.fatherName
    ? String(student.fatherName).toUpperCase()
    : student?.motherName
      ? String(student.motherName).toUpperCase()
      : student?.guardianName
        ? String(student.guardianName).toUpperCase()
        : "";

  ctx.fillStyle = "rgb(14, 56, 194)";

  if (tempType == 3) { // Muballiga
    ctx.textAlign = "center";
    ctx.font = "11px Arial-Bold";
    ctx.fillText(name, centerX - 20, 362);
    ctx.fillText(fatherName, centerX - 70, 383);

    ctx.textAlign = "start";
    ctx.font = "11px Arial-Bold";
    ctx.fillText(rollNumber, 475, 362);

    ctx.font = "12px Arial-Bold";
    ctx.fillText(grade, 221, 405);

    ctx.font = "11px Arial-Bold";
    ctx.fillText("JUNE-" + startYear, 329, 404);
    ctx.fillText("APRIL-" + endYear, 419, 404);

    ctx.font = "10px Arial-Bold";
    ctx.fillText(String(certificateNum), 105, 624);
    ctx.fillText(issueDateText, 105, 637);

  } else if (tempType == 2) { // Muallama
    ctx.textAlign = "center";
    ctx.font = "11px Arial-Bold";
    ctx.fillText(name, centerX - 20, 346);
    ctx.fillText(fatherName, centerX - 70, 367);

    ctx.textAlign = "start";
    ctx.font = "11px Arial-Bold";
    ctx.fillText(rollNumber, 476, 347);

    ctx.font = "12px Arial-Bold";
    ctx.fillText(grade, 221, 387);

    ctx.font = "11px Arial-Bold";
    ctx.fillText("JUNE-" + startYear, 329, 387);
    ctx.fillText("APRIL-" + endYear, 419, 387);

    ctx.font = "10px Arial-Bold";
    ctx.fillText(String(certificateNum), 105, 624);
    ctx.fillText(issueDateText, 105, 637);

  } else { // Makthab
    ctx.textAlign = "center";
    ctx.font = "11px Arial-Bold";
    ctx.fillText(name, centerX - 15, 385);
    ctx.fillText(fatherName, centerX - 45, 407);

    ctx.textAlign = "start";
    ctx.font = "10.5px Arial-Bold";
    ctx.fillText(rollNumber, 480, 385);

    ctx.font = "12px Arial-Bold";
    //ctx.fillText(grade, 540, 408);

    ctx.fillText(String(new Date().getFullYear()), 235, 448);

    ctx.font = "10px Arial-Bold";
    ctx.fillText(issueDateText, 105, 616);
  }

  return canvas.toBuffer("image/png");
};

// ---------------- PDF template loader ----------------
const loadTemplatePdf = async (templateUrl) => {
  const cleanUrl = String(templateUrl || "").replace("?download=1", "");
  const bytes = await fetchBinary(cleanUrl);
  return PDFDocument.load(bytes);
};

// ---------- main ----------
const addCertificate = async (req, res) => {
  try {
    const { templateId, schoolId, studentId, issueDate } = req.body;

    const template = await Template.findById({ _id: templateId })
      .populate({
        path: "courseId",
        select: "_id name",
      });

    if (!template) {
      return res.status(404).json({ success: false, error: "Template not found." });
    }

    if (!issueDate) {
      return res.status(400).json({
        success: false,
        error: "Certificate issue date is required.",
      });
    }

    const school = await School.findById({ _id: schoolId })
      .populate({
        path: "districtStateId",
        select: "district state",
      });
    if (!school) {
      return res.status(404).json({ success: false, error: "School not found." });
    }

    const student = await Student.findById({ _id: studentId })
      .populate("userId", {
        password: 0,
        profileImage: 0,
      });

    if (!student) {
      return res.status(404).json({ success: false, error: "Student not found." });
    }

    const academicStart = await Academic.findOne({
      $or: [
        { courseId1: template.courseId },
        { courseId2: template.courseId },
        { courseId3: template.courseId },
        { courseId4: template.courseId },
        { courseId5: template.courseId },
      ],
      $and: [{ studentId: studentId }],
    })
      .sort({ createdAt: 1 })
      .limit(1)
      .populate({ path: "acYear", select: "acYear" });

    if (!academicStart || !academicStart.acYear || !academicStart.acYear.acYear) {
      return res.status(404).json({ success: false, error: "Academics not found for the Student." });
    }

    const academicEnd = await Academic.findOne({
      $or: [
        { courseId1: template.courseId },
        { courseId2: template.courseId },
        { courseId3: template.courseId },
        { courseId4: template.courseId },
        { courseId5: template.courseId },
      ],
      $and: [{ studentId: studentId }],
    })
      .sort({ createdAt: -1 })
      .limit(1)
      .populate({ path: "acYear", select: "acYear" });

    if (!academicEnd || !academicEnd.acYear || !academicEnd.acYear.acYear) {
      return res.status(404).json({ success: false, error: "Academic end year not found." });
    }

    //console.log("Grade : " + academicEnd)
    const getIdValue = (value) => {
      if (!value) return "";
      if (typeof value === "string") return value;
      if (value._id) return String(value._id);
      return String(value);
    };

    const targetCourseId = getIdValue(template.courseId);

    let matchedIndex = null;
    let grade = "";

    for (let i = 1; i <= 5; i++) {
      const courseIdValue = getIdValue(academicEnd[`courseId${i}`]);

      if (courseIdValue === targetCourseId) {
        matchedIndex = i;
        grade = academicEnd[`grade${i}`] || "";
        break;
      }
    }

    //console.log("targetCourseId:", targetCourseId);
    //console.log("matchedIndex:", matchedIndex);
    //console.log("Grade:", grade);

    const startYear = academicStart.acYear.acYear.substr(0, 4);
    const endYear = academicEnd.acYear.acYear.substr(5, 4);

    let tempType = 1; //Makthab
    if (template.courseId.name.includes("Muallama")) {
      tempType = 2; //Muallama
    } else if (template.courseId.name.includes("Muballiga")) {
      tempType = 3; //Muballiga
    }

    let certificateNum;
    if (tempType != 1) { // Not Makthab
      const cert = await Certificate.findOne({ templateId: templateId, studentId: studentId });
      // if (cert) {
      //   return res.status(404).json({
      //     success: false,
      //     error: "Certificate Already Found. No : " + cert.code,
      //   });
      // }

      const lastCertificate = await Certificate.findOne({}).sort({ _id: -1 }).limit(1);
      if (lastCertificate) certificateNum = Number(lastCertificate.code) + 1;
      else certificateNum = Number(new Date().getFullYear() + "00000") + 1;
    }

    // const issueDateObj = new Date(issueDate);
    // if (Number.isNaN(issueDateObj.getTime())) {
    //   return res.status(400).json({
    //     success: false,
    //     error: "Invalid certificate issue date.",
    //   });
    // }
    // const issueDateText = issueDateObj.toLocaleDateString("en-GB");

    const parseCertificateIssueDate = (value) => {
      if (!value) return null;

      const raw = String(value).trim();

      // Case 1: plain date string: YYYY-MM-DD
      const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dateOnlyMatch) {
        const [, y, m, d] = dateOnlyMatch;
        const date = new Date(Number(y), Number(m) - 1, Number(d));

        if (
          date.getFullYear() !== Number(y) ||
          date.getMonth() !== Number(m) - 1 ||
          date.getDate() !== Number(d)
        ) {
          return null;
        }

        return {
          dateObj: date,
          issueDateText: `${d}/${m}/${y}`,
        };
      }

      // Case 2: ISO datetime string like 2026-03-24T15:00:00.000Z
      const isoDate = new Date(raw);
      if (Number.isNaN(isoDate.getTime())) {
        return null;
      }

      // Format in Asia/Tokyo so 2026-03-24T15:00:00.000Z becomes 25/03/2026
      const formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Tokyo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

      const parts = formatter.formatToParts(isoDate);
      const day = parts.find((p) => p.type === "day")?.value;
      const month = parts.find((p) => p.type === "month")?.value;
      const year = parts.find((p) => p.type === "year")?.value;

      if (!day || !month || !year) return null;

      return {
        dateObj: isoDate,
        issueDateText: `${day}/${month}/${year}`,
      };
    };

    console.log("issueDate : " + issueDate);

    const parsedIssueDate = parseCertificateIssueDate(issueDate);

    if (!parsedIssueDate) {
      return res.status(400).json({
        success: false,
        error: "Invalid certificate issue date.",
      });
    }

    const issueDateObj = parsedIssueDate.dateObj;
    const issueDateText = parsedIssueDate.issueDateText;

    console.log("issueDateObj : ", issueDateObj);
    console.log("issueDateText : " + issueDateText);

    const dat = new Date().toLocaleDateString();

    const name = student?.userId?.name ? student.userId.name.toUpperCase() : "";
    const rollNumber = student?.rollNumber ? student.rollNumber.toUpperCase() : "";

    const baseFileName =
      `${template.courseId.name}_${rollNumber}_${name}_${new Date().getTime()}`
        .replace(/\s+/g, "_")
        .replace(/[^\w.-]/g, "");

    const fileName = `${baseFileName}.pdf`;

    await prepareCanvasFonts();

    // Load PDF template as base
    const templatePdf = await loadTemplatePdf(template.template);
    const outputPdf = await PDFDocument.create();

    const [basePage] = await outputPdf.copyPages(templatePdf, [0]);
    outputPdf.addPage(basePage);

    const page = outputPdf.getPage(0);
    const pageWidth = Math.round(page.getWidth());
    const pageHeight = Math.round(page.getHeight());

    // Build sharp transparent overlay
    const overlayPngBuffer = await buildCertificateOverlayPng({
      width: pageWidth,
      height: pageHeight,
      school,
      student,
      startYear,
      endYear,
      certificateNum,
      dat,
      issueDateText,
      tempType,
      grade,
      scale: 3,
    });

    const overlayImage = await outputPdf.embedPng(overlayPngBuffer);
    page.drawImage(overlayImage, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    });

    const pdfBytes = Buffer.from(await outputPdf.save());

    if (tempType != 1) { // != Makthab
      const outName = buildTimestampedName(fileName);

      const uploaded = await runWithDriveRetry(async (drive) => {
        const folderId = await ensureFolderPath(drive, ["UNIS", "Certificates"]);
        return await uploadBufferToDrive(
          drive,
          folderId,
          outName,
          pdfBytes,
          "application/pdf"
        );
      });

      const newCertificate = new Certificate({
        code: certificateNum,
        templateId: templateId,
        courseId: template.courseId._id,
        studentId: studentId,
        schoolId: schoolId,
        userId: student.userId,
        certificate: uploaded.previewUrl,
        certificateDriveFileId: uploaded.fileId,
        certificateDriveViewUrl: uploaded.viewUrl,
        certificateDriveDownloadUrl: uploaded.downloadUrl,
        certificateDrivePreviewUrl: uploaded.previewUrl,
        certificateFileName: uploaded.fileName,
        issueDate: issueDateObj,
      });

      await newCertificate.save();

      const redis = await getRedis();
      await redis.set("totalCertificates", await Certificate.countDocuments());

      return res.status(200).json({
        success: true,
        message: "Certificate Created Successfully.",
        file: uploaded.downloadUrl,
        downloadUrl: uploaded.downloadUrl,
        viewUrl: uploaded.previewUrl,
        fileName: uploaded.fileName,
        mimeType: "application/pdf",
        type: "url",
      });
    }

    const base64String = pdfBytes.toString("base64");

    return res.status(200).json({
      success: true,
      message: "Certificate Created Successfully.",
      file: base64String,
      fileName,
      mimeType: "application/pdf",
      type: "base64pdf",
    });
  } catch (error) {
    console.log(error);

    if (
      String(error?.message || "").includes("Google Drive connection expired") ||
      String(error?.message || "").includes("Google OAuth configuration changed") ||
      String(error?.message || "").includes("Stored Google Drive token is invalid")
    ) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      error: "server error in create certificate.",
    });
  }
};

const getCertificates = async (req, res) => {
  try {
    const certificates = await Certificate.find({})
      .select("code issueDate")
      .populate({ path: "templateId", select: "code" })
      .populate({ path: "courseId", select: "name" })
      .populate({ path: "studentId", select: "rollNumber fatherName motherName guardianName" })
      .populate({ path: "userId", select: "name" })
      .populate({ path: "schoolId", select: "code nameEnglish" });

    console.log("Result Sent");
    return res.status(200).json({ success: true, certificates });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, error: "get certificates server error" });
  }
};

const getByCertFilter = async (req, res) => {
  const { certSchoolId, certCourseId, certACYearId } = req.params;

  console.log("getByCertFilter : " + certSchoolId + ", " + certCourseId + ",  " + certACYearId);

  try {
    let filterQuery = Certificate.find().select("code issueDate");

    if (certSchoolId && certSchoolId?.length > 0 && certSchoolId !== "null" && certSchoolId !== "undefined") {
      console.log("School Id Added : " + certSchoolId);
      filterQuery = filterQuery.where("schoolId").in(certSchoolId);
    }

    if (certCourseId && certCourseId?.length > 0 && certCourseId !== "null" && certCourseId !== "undefined") {
      console.log("Course Id Added : " + certCourseId);
      filterQuery = filterQuery.where("courseId").in(certCourseId);
    }

    if (certACYearId && certACYearId?.length > 0 && certACYearId !== "null" && certACYearId !== "undefined") {
      console.log("acYear Added : " + certACYearId);

      const academics = await Academic.find({ acYear: certACYearId });
      const studentIds = [];
      academics.forEach((academic) => studentIds.push(academic.studentId));
      console.log("Student Ids : " + studentIds);
      filterQuery = filterQuery.where("studentId").in(studentIds);
    }

    filterQuery.sort({ code: 1 });
    filterQuery
      .populate({ path: "templateId", select: "code" })
      .populate({ path: "courseId", select: "name" })
      .populate({ path: "studentId", select: "rollNumber fatherName motherName guardianName" })
      .populate({ path: "userId", select: "name" })
      .populate({ path: "schoolId", select: "code nameEnglish" });

    const certificates = await filterQuery.exec();

    console.log("Certificates : " + certificates?.length);
    return res.status(200).json({ success: true, certificates });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, error: "get Certificates by FILTER server error" });
  }
};

const getCertificate = async (req, res) => {
  const { id } = req.params;
  try {
    const certificate = await Certificate.findById({ _id: id })
      .select("code issueDate certificate certificateDriveFileId certificateDriveViewUrl certificateDriveDownloadUrl certificateDrivePreviewUrl certificateFileName")
      .populate({ path: "templateId", select: "code" })
      .populate({ path: "courseId", select: "name" })
      .populate({ path: "studentId", select: "rollNumber fatherName motherName guardianName" })
      .populate({ path: "userId", select: "name" })
      .populate({ path: "schoolId", select: "code nameEnglish" });

    return res.status(200).json({ success: true, certificate });
  } catch (error) {
    return res.status(500).json({ success: false, error: "get certificate server error" });
  }
};

export { addCertificate, upload, getCertificates, getCertificate, getByCertFilter };