import { google } from "googleapis";
import { Readable } from "stream";
import { buildOAuthClient } from "./googleDriveService.js";

const safeFolderName = (value, fallback = "Unknown") => {
  const cleaned = String(value || "").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
  return cleaned || fallback;
};

const safeFileName = (value, fallback = "marksheet.pdf") => {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = cleaned || fallback;
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
};

const getDrive = async () => {
  try {
    const { client } = await buildOAuthClient();
    await client.getAccessToken();
    return google.drive({ version: "v3", auth: client });
  } catch (error) {
    const message = String(error?.response?.data?.error || error?.message || "");
    if (/invalid_grant/i.test(message)) {
      throw new Error("Google Drive connection expired. Please reconnect Google Drive.");
    }
    if (/not connected/i.test(message)) {
      throw new Error("Google Drive is not connected. Please connect Google Drive.");
    }
    throw error;
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

  const response = await drive.files.list({ q, fields: "files(id,name)", spaces: "drive", pageSize: 1 });
  return response.data.files?.[0]?.id || null;
};

const createFolder = async (drive, parentId, folderName) => {
  const response = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: "id",
  });
  return response.data.id;
};

const ensureFolderPath = async (drive, parts) => {
  let parentId = null;
  for (const rawName of parts) {
    const name = safeFolderName(rawName);
    let folderId = await findChildFolderId(drive, parentId, name);
    if (!folderId) folderId = await createFolder(drive, parentId, name);
    parentId = folderId;
  }
  return parentId;
};

export const buildMarksheetResultFolderParts = ({
  academicYear,
  schoolCode,
  courseCode,
  studyingYear,
  examType,
  artifactType,
}) => [
  "UNIS",
  "Exams",
  "Results",
  safeFolderName(academicYear, "Academic-Year"),
  safeFolderName(schoolCode, "Niswan"),
  safeFolderName(courseCode, "Course"),
  `Year-${Number(studyingYear || 0)}`,
  safeFolderName(examType, "Exam"),
  artifactType === "Combined" ? "Combined" : "Individual",
];

// Prepared for the official marksheet generator. Files remain private in Drive;
// no public sharing permission is created here.
export const uploadGeneratedMarksheetPdfToDrive = async ({ buffer, fileName, folderParts }) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("Generated marksheet PDF is empty.");
  if (!buffer.subarray(0, 5).toString("utf8").startsWith("%PDF-")) {
    throw new Error("Generated marksheet file is not a valid PDF.");
  }

  const drive = await getDrive();
  const parts = Array.isArray(folderParts) && folderParts.length > 0 ? folderParts : ["UNIS", "Exams", "Results"];
  const folderId = await ensureFolderPath(drive, parts);
  const finalFileName = safeFileName(fileName);

  const response = await drive.files.create({
    requestBody: { name: finalFileName, parents: [folderId] },
    media: { mimeType: "application/pdf", body: Readable.from(buffer) },
    fields: "id,name,size,mimeType",
  });

  return {
    fileId: response.data.id,
    fileName: response.data.name,
    fileSize: Number(response.data.size || buffer.length || 0),
    mimeType: response.data.mimeType || "application/pdf",
    folderPath: parts.join("/"),
  };
};

export const downloadGeneratedMarksheetPdfFromDrive = async (fileId) => {
  if (!fileId) throw new Error("Marksheet Drive file id is missing.");
  const drive = await getDrive();
  const response = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  return Buffer.from(response.data);
};

export const deleteGeneratedMarksheetPdfFromDrive = async (fileId) => {
  if (!fileId) return;
  const drive = await getDrive();
  await drive.files.delete({ fileId });
};
