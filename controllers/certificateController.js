import multer from "multer";
import crypto from "crypto";
import Certificate from "../models/Certificate.js";
import School from "../models/School.js";
import Student from "../models/Student.js";
import Template from "../models/Template.js";
import Academic from "../models/Academic.js";
import Numbering from "../models/Numbering.js";
import { createCanvas, registerFont } from "canvas";

import { google } from "googleapis";
import { Readable } from "stream";
import IntegrationCredential from "../models/IntegrationCredential.js";
import { decryptText } from "../utils/cryptoHelper.js";

import * as fs from "fs";
import * as path from "path";
import getRedis from "../db/redis.js";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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

// Certificate number logic.
const padSerialNumber = (value, length = 6) => {
  return String(value || 0).padStart(length, "0");
};

const getCertificateNumberMeta = (tempType) => {
  const type = Number(tempType);

  if (type === 3) {
    return { name: "Muballiga", prefix: "MB" };
  }

  if (type === 2) {
    return { name: "Muallama", prefix: "MA" };
  }

  return { name: "Makthab", prefix: "MK" };
};

const getNextCertificateNumber = async (tempType) => {
  const { name, prefix } = getCertificateNumberMeta(tempType);
  const currentYear = new Date().getFullYear();

  const numbering = await Numbering.findOneAndUpdate(
    { name },
    {
      $inc: { currentNumber: 1 },
      $set: { updatedAt: new Date() },
      $setOnInsert: {
        name,
        createAt: new Date(),
      },
    },
    {
      new: true,
      upsert: true,
    }
  );

  if (!numbering) {
    throw new Error(`Unable to generate certificate number for ${name}.`);
  }

  return `${prefix}${currentYear}${padSerialNumber(numbering.currentNumber, 6)}`;
};

// ---------------- Font cache for complex-script overlay only ----------------
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
    // Only fonts really used for complex-script header overlay
    // await ensureFontRegistered({
    //   url: "https://www.unis.org.in/Nirmalab.ttc",
    //   fileName: "Nirmalab.ttc",
    //   family: "Nirmala",
    // });

    await ensureFontRegistered({
      url: "https://www.unis.org.in/arialbd.ttf",
      fileName: "Arial-Bold.ttf",
      family: "Arial-Bold",
    });

    await ensureFontRegistered({
      url: "https://www.unis.org.in/Nirmalab.ttc",
      fileName: "Nirmalab.ttc",
      family: "Nirmalab",
    });

    await ensureFontRegistered({
      url: "https://www.unis.org.in/Amiri-Bold.ttf",
      fileName: "Amiri-Bold.ttf",
      family: "Amiri Bold",
    });
  } catch (error) {
    throw new Error("Font setting Error. " + error.toString());
  }
};

const formatArabicForCanvas = (text = "") => {
  const str = String(text).trim();
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

const getCertificateHeaderPositions = (tempType, hasNative) => {
  const isMakthab = Number(tempType) === 1;

  if (isMakthab) {
    return hasNative
      ? { arabic: 122, native: 147, english: 164, address: 179 }
      : { arabic: 115, english: 143, address: 160 };
  }

  return hasNative
    ? { arabic: 95, native: 119, english: 135, address: 150 }
    : { arabic: 100, english: 128, address: 145 };
};

// Only Arabic/native complex text is rendered as high-resolution overlay.
// English/body text will be drawn directly on PDF as vector text.
const buildCertificateComplexHeaderOverlayPng = async ({
  width,
  height,
  school,
  tempType,
  scale = 5,
}) => {
  const canvas = createCanvas(width * scale, height * scale);
  const ctx = canvas.getContext("2d");

  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.textBaseline = "alphabetic";

  const centerX = width / 2;

  const nameArabic = school?.nameArabic ? String(school.nameArabic) : "";
  const nameNative = school?.nameNative ? String(school.nameNative) : "";
  const hasNative = Boolean(nameNative);

  const positions = getCertificateHeaderPositions(tempType, hasNative);

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

  // const drawNative = (text, y, size) => {
  //   drawCenteredText({
  //     text,
  //     y,
  //     size,
  //     fontFamily: "Nirmalab",
  //     weight: "bold",
  //     color: "rgb(161, 14, 94)",
  //     repeat: 3,
  //   });
  // };

  const drawNative = (text, y, size) => {
    if (!text) return;

    const finalText = String(text);
    ctx.font = `${size}px Nirmalab`;
    ctx.fillStyle = "rgb(161, 14, 94)";
    ctx.textAlign = "center";

    // draw multiple times with tiny offsets to make it look bolder
    const offsets = [
      [0, 0],
      [-0.4, 0],
      [0.4, 0],
      [0, -0.25],
      [0, 0.25],
    ];

    offsets.forEach(([dx, dy]) => {
      ctx.fillText(finalText, centerX + dx, y + dy);
    });
  };

  if (nameArabic) {
    drawArabic(nameArabic, positions.arabic, hasNative ? 19 : 21);
  }

  if (hasNative) {
    drawNative(nameNative, positions.native, Number(tempType) === 1 ? 12 : 13);
  }

  return canvas.toBuffer("image/png");
};

// ---------------- Direct PDF text helpers ----------------
const PDF_COLOR_GREEN = rgb(14 / 255, 84 / 255, 49 / 255);
const PDF_COLOR_MAGENTA = rgb(161 / 255, 14 / 255, 94 / 255);
const PDF_COLOR_DARK_BLUE = rgb(4 / 255, 25 / 255, 93 / 255);
const PDF_COLOR_BODY_BLUE = rgb(14 / 255, 56 / 255, 194 / 255);

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

const isMakthabLevelCourse = (courseName = "") => {
  return /^Makthab_Level[123]$/i.test(String(courseName || "").trim());
};

// Canvas used top-left with alphabetic baseline.
// This helper converts the same visual Y into PDF coordinate space.
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

  return finalSize;
};

const drawCertificateVectorTexts = async ({
  outputPdf,
  page,
  school,
  student,
  startYear,
  endYear,
  certificateNum,
  issueDateText,
  tempType,
  grade,
}) => {
  const helveticaBold = await outputPdf.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = page.getWidth();
  const centerX = pageWidth / 2;

  // ---------- Header English / address ----------
  const nameEnglish = school?.nameEnglish
    ? String(school.nameEnglish).toUpperCase()
    : "";

  const addressLine = [
    school?.address,
    school?.city,
    school?.districtStateId?.district,
    school?.districtStateId?.state,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .join(", ");

  const hasNative = Boolean(String(school?.nameNative || "").trim());
  const positions = getCertificateHeaderPositions(tempType, hasNative);
  const isMakthab = Number(tempType) === 1;

  if (nameEnglish) {
    if (hasNative) {
      drawPdfText({
        page,
        text: nameEnglish,
        x: centerX,
        yFromTop: positions.english,
        size: isMakthab ? 11.5 : 12,
        font: helveticaBold,
        color: PDF_COLOR_GREEN,
        align: "center",
        maxWidth: pageWidth * 0.86,
      });
    } else {
      drawPdfText({
        page,
        text: nameEnglish,
        x: centerX,
        yFromTop: positions.english,
        size: 15,
        font: helveticaBold,
        color: PDF_COLOR_MAGENTA,
        align: "center",
        maxWidth: pageWidth * 0.78,
      });
    }
  }

  if (addressLine) {
    drawPdfText({
      page,
      text: addressLine,
      x: centerX,
      yFromTop: positions.address,
      size: hasNative ? 9 : 10,
      font: helveticaBold,
      color: PDF_COLOR_DARK_BLUE,
      align: "center",
      maxWidth: pageWidth * 0.84,
    });
  }

  // ---------- Body ----------
  const name = student?.userId?.name ? String(student.userId.name).toUpperCase() : "";
  const rollNumber = student?.rollNumber ? String(student.rollNumber).toUpperCase() : "";
  const fatherName = student?.fatherName
    ? String(student.fatherName).toUpperCase()
    : student?.motherName
      ? String(student.motherName).toUpperCase()
      : student?.guardianName
        ? String(student.guardianName).toUpperCase()
        : "";

  if (tempType == 3) {
    // Muballiga
    drawPdfText({
      page,
      text: name,
      x: centerX - 20,
      yFromTop: 360.5,
      size: 11,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      align: "center",
      maxWidth: pageWidth * 0.55,
    });

    drawPdfText({
      page,
      text: fatherName,
      x: centerX - 70,
      yFromTop: 381.5,
      size: 11,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      align: "center",
      maxWidth: pageWidth * 0.45,
    });

    drawPdfText({
      page,
      text: rollNumber,
      x: 477,
      yFromTop: 361,
      size: 12,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      maxWidth: 104,
    });

    drawPdfText({
      page,
      text: grade,
      x: 221,
      yFromTop: 403.5,
      size: 12,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      maxWidth: 60,
    });

    drawPdfText({
      page,
      text: `JUNE-${startYear}`,
      x: 329,
      yFromTop: 401.5,
      size: 11,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      maxWidth: 80,
    });

    drawPdfText({
      page,
      text: `APRIL-${endYear}`,
      x: 419,
      yFromTop: 401.5,
      size: 11,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      maxWidth: 90,
    });

    drawPdfText({
      page,
      text: String(certificateNum),
      x: 105,
      yFromTop: 622,
      size: 10,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      maxWidth: 80,
    });

    drawPdfText({
      page,
      text: issueDateText,
      x: 105,
      yFromTop: 635,
      size: 10,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      maxWidth: 90,
    });
  } else if (tempType == 2) {
    // Muallama
    drawPdfText({
      page,
      text: name,
      x: centerX - 20,
      yFromTop: 359.5,
      size: 11,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      align: "center",
      maxWidth: pageWidth * 0.55,
    });

    drawPdfText({
      page,
      text: fatherName,
      x: centerX - 70,
      yFromTop: 380.5,
      size: 11,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      align: "center",
      maxWidth: pageWidth * 0.45,
    });

    drawPdfText({
      page,
      text: rollNumber,
      x: 477,
      yFromTop: 360.5,
      size: 11,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      maxWidth: 104,
    });

    drawPdfText({
      page,
      text: grade,
      x: 221,
      yFromTop: 401,
      size: 12,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      maxWidth: 60,
    });

    drawPdfText({
      page,
      text: `JUNE-${startYear}`,
      x: 329,
      yFromTop: 401,
      size: 11,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      maxWidth: 80,
    });

    drawPdfText({
      page,
      text: `APRIL-${endYear}`,
      x: 419,
      yFromTop: 401,
      size: 11,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      maxWidth: 90,
    });

    drawPdfText({
      page,
      text: String(certificateNum),
      x: 105,
      yFromTop: 622.25,
      size: 10,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      maxWidth: 80,
    });

    drawPdfText({
      page,
      text: issueDateText,
      x: 105,
      yFromTop: 635.25,
      size: 10,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      maxWidth: 90,
    });
  } else {
    // Makthab
    drawPdfText({
      page,
      text: name,
      x: centerX - 15,
      yFromTop: 384,
      size: 11,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      align: "center",
      maxWidth: pageWidth * 0.58,
    });

    drawPdfText({
      page,
      text: fatherName,
      x: centerX - 45,
      yFromTop: 405,
      size: 11,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      align: "center",
      maxWidth: pageWidth * 0.48,
    });

    drawPdfText({
      page,
      text: rollNumber,
      x: 480,
      yFromTop: 384.5,
      size: 10.5,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      maxWidth: 100,
    });

    drawPdfText({
      page,
      text: grade,
      x: 540,
      yFromTop: 424,
      size: 12,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      maxWidth: 40,
    });

    drawPdfText({
      page,
      text: String(endYear),
      x: 255,
      yFromTop: 447.5,
      size: 12,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      maxWidth: 60,
    });

    drawPdfText({
      page,
      text: String(certificateNum),
      x: 111,
      yFromTop: 613.5,
      size: 10,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      maxWidth: 80,
    });

    drawPdfText({
      page,
      text: issueDateText,
      x: 111,
      yFromTop: 626.5,
      size: 10,
      font: helveticaBold,
      color: PDF_COLOR_BODY_BLUE,
      maxWidth: 90,
    });
  }
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

    const template = await Template.findById({ _id: templateId }).populate({
      path: "courseId",
      select: "_id name years",
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

    const school = await School.findById({ _id: schoolId }).populate({
      path: "districtStateId",
      select: "district state",
    });

    if (!school) {
      return res.status(404).json({ success: false, error: "School not found." });
    }

    const student = await Student.findById({ _id: studentId }).populate("userId", {
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
      return res.status(404).json({
        success: false,
        error: "Academics not found for the Student.",
      });
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

        if (isMakthabLevelCourse(template?.courseId?.name)) {
          grade = String(academicEnd[`year${i}`] || "");
        } else {
          grade = String(academicEnd[`grade${i}`] || "");
        }

        break;
      }
    }

    // Course start and end year logic.
    const courseYears = Number(template?.courseId?.years || 0);
    if (!courseYears || courseYears <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid course duration. Please set Course.years properly.",
      });
    }

    let tempType = 1; // Makthab
    if (template.courseId.name.includes("Muallama")) {
      tempType = 2; // Muallama
    } else if (template.courseId.name.includes("Muballiga")) {
      tempType = 3; // Muballiga
    }

    const certificateNum = await getNextCertificateNumber(tempType);

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

    const parsedIssueDate = parseCertificateIssueDate(issueDate);
    if (!parsedIssueDate) {
      return res.status(400).json({
        success: false,
        error: "Invalid certificate issue date.",
      });
    }

    const issueDateObj = parsedIssueDate.dateObj;
    const issueDateText = parsedIssueDate.issueDateText;

    const endYear = String(issueDateObj.getFullYear());
    const startYear = String(endYear - courseYears);

    const name = student?.userId?.name ? String(student.userId.name).toUpperCase() : "";
    const rollNumber = student?.rollNumber ? String(student.rollNumber).toUpperCase() : "";

    const baseFileName = `${certificateNum}_${rollNumber}_${name}_${new Date().getTime()}`
      .replace(/\s+/g, "_")
      .replace(/[^\w.-]/g, "");

    const fileName = `${baseFileName}.pdf`;

    // Load PDF template as base
    const templatePdf = await loadTemplatePdf(template.template);
    const outputPdf = await PDFDocument.create();

    const [basePage] = await outputPdf.copyPages(templatePdf, [0]);
    outputPdf.addPage(basePage);

    const page = outputPdf.getPage(0);
    const pageWidth = Math.round(page.getWidth());
    const pageHeight = Math.round(page.getHeight());

    // 1) Complex-script header overlay only (Arabic / native)
    //    Keep this as high-resolution PNG to avoid shaping issues.
    const hasComplexHeaderText =
      Boolean(String(school?.nameArabic || "").trim()) ||
      Boolean(String(school?.nameNative || "").trim());

    if (hasComplexHeaderText) {
      await prepareCanvasFonts();

      const overlayPngBuffer = await buildCertificateComplexHeaderOverlayPng({
        width: pageWidth,
        height: pageHeight,
        school,
        tempType,
        scale: 5,
      });

      const overlayImage = await outputPdf.embedPng(overlayPngBuffer);
      page.drawImage(overlayImage, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      });
    }

    // 2) Draw English/body text directly on PDF as vector text
    await drawCertificateVectorTexts({
      outputPdf,
      page,
      school,
      student,
      startYear,
      endYear,
      certificateNum,
      issueDateText,
      tempType,
      grade,
    });

    const pdfBytes = Buffer.from(await outputPdf.save());

    //if (tempType != 1) {
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
      userId: student?.userId?._id || student?.userId,
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
    //}

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

    if (
      certSchoolId &&
      certSchoolId?.length > 0 &&
      certSchoolId !== "null" &&
      certSchoolId !== "undefined"
    ) {
      console.log("School Id Added : " + certSchoolId);
      filterQuery = filterQuery.where("schoolId").in(certSchoolId);
    }

    if (
      certCourseId &&
      certCourseId?.length > 0 &&
      certCourseId !== "null" &&
      certCourseId !== "undefined"
    ) {
      console.log("Course Id Added : " + certCourseId);
      filterQuery = filterQuery.where("courseId").in(certCourseId);
    }

    if (
      certACYearId &&
      certACYearId?.length > 0 &&
      certACYearId !== "null" &&
      certACYearId !== "undefined"
    ) {
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
    return res.status(500).json({
      success: false,
      error: "get Certificates by FILTER server error",
    });
  }
};

const getCertificate = async (req, res) => {
  const { id } = req.params;
  try {
    const certificate = await Certificate.findById({ _id: id })
      .select(
        "code issueDate certificate certificateDriveFileId certificateDriveViewUrl certificateDriveDownloadUrl certificateDrivePreviewUrl certificateFileName"
      )
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