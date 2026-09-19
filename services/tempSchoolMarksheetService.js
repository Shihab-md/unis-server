import { google } from "googleapis";
import { Readable } from "stream";

import { buildOAuthClient } from "./googleDriveService.js";
import { buildTempSchoolMarksheetPdf } from "./tempSchoolMarksheetPdfService.js";
import { resolveTempSchoolMarksheetTemplate } from "./tempSchoolMarksheetTemplateService.js";
import { normalizeTempSchoolMarksheetRow } from "../utils/tempSchoolMarksheetHelper.js";

const DRIVE_FOLDER_PATH = ["UNIS", "Marksheets", "Temp-School"];

const escapeDriveQueryValue = (value) =>
  String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");

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
  const safeName = escapeDriveQueryValue(folderName);
  const q = [
    "mimeType='application/vnd.google-apps.folder'",
    `name='${safeName}'`,
    "trashed=false",
    parentId ? `'${parentId}' in parents` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  const response = await drive.files.list({
    q,
    fields: "files(id,name)",
    spaces: "drive",
    pageSize: 10,
  });

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
  for (const folderName of parts) {
    let folderId = await findChildFolderId(drive, parentId, folderName);
    if (!folderId) folderId = await createFolder(drive, parentId, folderName);
    parentId = folderId;
  }
  return parentId;
};

const findFilesByExactName = async (drive, folderId, fileName) => {
  const safeName = escapeDriveQueryValue(fileName);
  const q = [
    `name='${safeName}'`,
    "trashed=false",
    `'${folderId}' in parents`,
  ].join(" and ");

  const response = await drive.files.list({
    q,
    fields: "files(id,name,webViewLink,createdTime)",
    spaces: "drive",
    pageSize: 100,
  });

  return Array.isArray(response.data.files) ? response.data.files : [];
};

const buildDownloadUrl = (fileId) =>
  `https://drive.google.com/uc?export=download&id=${fileId}`;

const createPdfFile = async ({ drive, folderId, fileName, pdfBytes }) => {
  const response = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType: "application/pdf", body: Readable.from(pdfBytes) },
    fields: "id,name,webViewLink,size,mimeType",
  });

  return {
    action: "CREATED",
    fileId: response.data.id,
    fileName: response.data.name,
    viewUrl:
      response.data.webViewLink ||
      `https://drive.google.com/file/d/${response.data.id}/view`,
    downloadUrl: buildDownloadUrl(response.data.id),
  };
};

const replacePdfFile = async ({ drive, existingFiles, fileName, pdfBytes }) => {
  const primary = existingFiles[0];
  const response = await drive.files.update({
    fileId: primary.id,
    requestBody: { name: fileName },
    media: { mimeType: "application/pdf", body: Readable.from(pdfBytes) },
    fields: "id,name,webViewLink,size,mimeType",
  });

  // If an older run somehow produced duplicate files with the exact same name,
  // keep one canonical file and move the extras to Trash.
  for (const duplicate of existingFiles.slice(1)) {
    try {
      await drive.files.update({
        fileId: duplicate.id,
        requestBody: { trashed: true },
        fields: "id",
      });
    } catch (error) {
      console.log(
        "[tempSchoolMarksheet] unable to trash duplicate Drive file:",
        duplicate.id,
        error?.message || error
      );
    }
  }

  return {
    action: "REPLACED",
    fileId: response.data.id,
    fileName: response.data.name,
    viewUrl:
      response.data.webViewLink ||
      `https://drive.google.com/file/d/${response.data.id}/view`,
    downloadUrl: buildDownloadUrl(response.data.id),
  };
};

const uploadOrReplacePdf = async ({ drive, folderId, fileName, pdfBytes }) => {
  if (!Buffer.isBuffer(pdfBytes) || pdfBytes.length === 0) {
    throw new Error("Generated PDF is empty");
  }
  if (!pdfBytes.subarray(0, 5).toString("utf8").startsWith("%PDF-")) {
    throw new Error("Generated file is not a valid PDF");
  }

  const existingFiles = await findFilesByExactName(drive, folderId, fileName);
  if (existingFiles.length > 0) {
    return replacePdfFile({ drive, existingFiles, fileName, pdfBytes });
  }
  return createPdfFile({ drive, folderId, fileName, pdfBytes });
};

export const getTempSchoolMarksheetTemplateInfo = async () => {
  const context = await resolveTempSchoolMarksheetTemplate({ includePdfBytes: true });
  return context.info;
};

export const processTempSchoolMarksheetRows = async ({ rows = [], expectedTemplateVersion = null }) => {
  // Resolve and download the uploaded Template-module PDF once per request/chunk,
  // exactly like the bulk certificate flow caches template bytes per batch.
  // expectedTemplateVersion prevents a multi-chunk run from mixing template versions.
  const templateContext = await resolveTempSchoolMarksheetTemplate({
    expectedVersion: expectedTemplateVersion,
    includePdfBytes: true,
  });

  const normalizedRows = (Array.isArray(rows) ? rows : []).map((row, index) =>
    normalizeTempSchoolMarksheetRow(row, index)
  );

  const results = [];
  let created = 0;
  let replaced = 0;
  let invalid = 0;
  let failed = 0;

  let drive = null;
  let folderId = null;

  const getDriveContext = async () => {
    if (drive && folderId) return { drive, folderId };
    drive = await getDrive();
    folderId = await ensureFolderPath(drive, DRIVE_FOLDER_PATH);
    return { drive, folderId };
  };

  for (const row of normalizedRows) {
    if (row.errors.length > 0) {
      invalid += 1;
      results.push({
        sourceRowNumber: row.sourceRowNumber,
        regNumber: row.regNumber,
        name: row.studentName,
        status: "INVALID",
        action: "",
        totalSubjects: "",
        totalMarks: "",
        percentage: "",
        fileName: row.fileName || "",
        viewUrl: "",
        downloadUrl: "",
        message: row.errors.join(", "),
      });
      continue;
    }

    try {
      const pdfBytes = await buildTempSchoolMarksheetPdf({
        row,
        templatePdfBytes: templateContext.templatePdfBytes,
      });
      let uploaded;

      try {
        const driveContext = await getDriveContext();
        uploaded = await uploadOrReplacePdf({
          drive: driveContext.drive,
          folderId: driveContext.folderId,
          fileName: row.fileName,
          pdfBytes,
        });
      } catch (firstError) {
        const firstMessage = String(firstError?.message || "");
        const noRetry =
          /reconnect Google Drive/i.test(firstMessage) ||
          /not connected/i.test(firstMessage);

        if (noRetry) throw firstError;

        console.log(
          "[tempSchoolMarksheet] retrying Drive operation once:",
          firstMessage || firstError
        );
        drive = null;
        folderId = null;
        const retryContext = await getDriveContext();
        uploaded = await uploadOrReplacePdf({
          drive: retryContext.drive,
          folderId: retryContext.folderId,
          fileName: row.fileName,
          pdfBytes,
        });
      }

      if (uploaded.action === "REPLACED") replaced += 1;
      else created += 1;

      results.push({
        sourceRowNumber: row.sourceRowNumber,
        regNumber: row.regNumber,
        name: row.studentName,
        status: "SUCCESS",
        action: uploaded.action,
        totalSubjects: row.totalSubjects,
        totalMarks: row.totalMarksText,
        percentage: row.percentageText,
        fileName: uploaded.fileName,
        viewUrl: uploaded.viewUrl,
        downloadUrl: uploaded.downloadUrl,
        message:
          uploaded.action === "REPLACED"
            ? "Existing Google Drive PDF replaced successfully"
            : "PDF created and uploaded successfully",
      });
    } catch (error) {
      failed += 1;
      console.log(
        "[processTempSchoolMarksheetRows] row error:",
        row.sourceRowNumber,
        error?.message || error
      );
      results.push({
        sourceRowNumber: row.sourceRowNumber,
        regNumber: row.regNumber,
        name: row.studentName,
        status: "FAILED",
        action: "",
        totalSubjects: row.totalSubjects || "",
        totalMarks: row.totalMarksText || "",
        percentage: row.percentageText || "",
        fileName: row.fileName || "",
        viewUrl: "",
        downloadUrl: "",
        message: error?.message || "Temporary school marksheet generation failed",
      });
    }
  }

  return {
    summary: {
      total: normalizedRows.length,
      created,
      replaced,
      invalid,
      failed,
      success: created + replaced,
    },
    rows: results,
    drivePath: DRIVE_FOLDER_PATH.join("/"),
    template: templateContext.info,
  };
};
