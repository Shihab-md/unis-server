import { google } from "googleapis";
import { Readable } from "stream";
import { buildOAuthClient } from "./googleDriveService.js";

const safeFolderName = (value, fallback = "Unknown") => {
  const cleaned = String(value || "").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
  return cleaned || fallback;
};

const safeFileBase = (value, fallback = "question-paper") => {
  const cleaned = String(value || "")
    .replace(/\.pdf$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
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

const timestamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
};

export const uploadQuestionPaperToDrive = async ({
  file,
  academicYear,
  courseCode,
  studyingYear,
  examType,
  subjectCode,
  examDate,
}) => {
  const drive = await getDrive();
  const parts = [
    "UNIS",
    "Exams",
    "QuestionPapers",
    safeFolderName(academicYear, "Academic-Year"),
    safeFolderName(courseCode, "Course"),
    `Year-${Number(studyingYear || 0)}`,
    safeFolderName(examType, "Exam"),
  ];
  const folderId = await ensureFolderPath(drive, parts);
  const driveFileName = `${safeFileBase(`${subjectCode}_${examType}_${examDate}`)}_${timestamp()}.pdf`;

  const response = await drive.files.create({
    requestBody: { name: driveFileName, parents: [folderId] },
    media: { mimeType: "application/pdf", body: Readable.from(file.buffer) },
    fields: "id,name,size,mimeType",
  });

  return {
    fileId: response.data.id,
    fileName: response.data.name,
    fileSize: Number(response.data.size || file.size || 0),
    mimeType: response.data.mimeType || "application/pdf",
    folderPath: parts.join("/"),
  };
};

export const downloadQuestionPaperFromDrive = async (fileId) => {
  const drive = await getDrive();
  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(response.data);
};

export const deleteQuestionPaperFromDrive = async (fileId) => {
  if (!fileId) return;
  const drive = await getDrive();
  await drive.files.delete({ fileId });
};
