import { google } from "googleapis";
import { Readable } from "stream";
import { buildOAuthClient } from "./googleDriveService.js";
import { assertDriveFileWithinEnvironmentRoot, ensureEnvironmentDriveFolderPath } from "./driveFolderService.js";

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

export const buildMarksheetResultFolderParts = ({
  academicYear,
  schoolCode,
  courseCode,
  studyingYear,
  examType,
  artifactType,
}) => [
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
  const parts = Array.isArray(folderParts) && folderParts.length > 0 ? folderParts : ["Exams", "Results"];
  const folderContext = await ensureEnvironmentDriveFolderPath(drive, parts);
  const folderId = folderContext.folderId;
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
    folderPath: folderContext.folderPath,
  };
};

export const downloadGeneratedMarksheetPdfFromDrive = async (fileId) => {
  if (!fileId) throw new Error("Marksheet Drive file id is missing.");
  const drive = await getDrive();
  await assertDriveFileWithinEnvironmentRoot(drive, fileId);
  const response = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  return Buffer.from(response.data);
};

export const deleteGeneratedMarksheetPdfFromDrive = async (fileId) => {
  if (!fileId) return;
  const drive = await getDrive();
  await assertDriveFileWithinEnvironmentRoot(drive, fileId);
  await drive.files.delete({ fileId });
};
