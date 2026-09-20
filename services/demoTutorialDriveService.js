import fs from "fs";
import { google } from "googleapis";
import { buildOAuthClient } from "./googleDriveService.js";

export const DEMO_TUTORIAL_DRIVE_PATH = Object.freeze(["UNIS", "Demo-Tutorial"]);

const escapeDriveQuery = (value) => String(value || "").replace(/'/g, "\\'");

const safeFolderName = (value, fallback = "Folder") => {
  const cleaned = String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ");
  return cleaned || fallback;
};

const safeDriveFileName = (value, fallback = "tutorial-file") => {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return cleaned || fallback;
};

const findChildFolderId = async (drive, parentId, folderName) => {
  const q = [
    "mimeType='application/vnd.google-apps.folder'",
    `name='${escapeDriveQuery(folderName)}'`,
    "trashed=false",
    parentId ? `'${parentId}' in parents` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  const response = await drive.files.list({
    q,
    fields: "files(id,name)",
    spaces: "drive",
    pageSize: 1,
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
  for (const rawPart of parts) {
    const folderName = safeFolderName(rawPart);
    let folderId = await findChildFolderId(drive, parentId, folderName);
    if (!folderId) folderId = await createFolder(drive, parentId, folderName);
    parentId = folderId;
  }
  return parentId;
};

const normalizeDriveError = (error) => {
  const message = String(
    error?.response?.data?.error?.message ||
      error?.response?.data?.error ||
      error?.message ||
      ""
  );

  if (/invalid_grant/i.test(message)) {
    return new Error("Google Drive connection expired. Please reconnect Google Drive.");
  }
  if (/not connected/i.test(message)) {
    return new Error("Google Drive is not connected. Please connect Google Drive.");
  }
  return error;
};

const getDrive = async () => {
  try {
    const { client } = await buildOAuthClient();
    await client.getAccessToken();
    return google.drive({ version: "v3", auth: client });
  } catch (error) {
    throw normalizeDriveError(error);
  }
};

const mediaForFile = (file) => ({
  mimeType: file.mimetype,
  body: fs.createReadStream(file.path),
});

export const uploadDemoTutorialFileToDrive = async (file) => {
  const drive = await getDrive();
  const folderId = await ensureFolderPath(drive, DEMO_TUTORIAL_DRIVE_PATH);
  const driveFileName = safeDriveFileName(file.originalname);

  try {
    const response = await drive.files.create({
      requestBody: {
        name: driveFileName,
        parents: [folderId],
      },
      media: mediaForFile(file),
      fields: "id,name,size,mimeType",
    });

    return {
      driveFileId: response.data.id,
      driveFileName: response.data.name || driveFileName,
      fileSize: Number(response.data.size || file.size || 0),
      mimeType: response.data.mimeType || file.mimetype,
      driveFolderPath: DEMO_TUTORIAL_DRIVE_PATH.join("/"),
    };
  } catch (error) {
    throw normalizeDriveError(error);
  }
};

export const replaceDemoTutorialFileInDrive = async ({ fileId, file }) => {
  const drive = await getDrive();
  const driveFileName = safeDriveFileName(file.originalname);

  try {
    const response = await drive.files.update({
      fileId,
      requestBody: { name: driveFileName },
      media: mediaForFile(file),
      fields: "id,name,size,mimeType",
    });

    return {
      driveFileId: response.data.id || fileId,
      driveFileName: response.data.name || driveFileName,
      fileSize: Number(response.data.size || file.size || 0),
      mimeType: response.data.mimeType || file.mimetype,
      driveFolderPath: DEMO_TUTORIAL_DRIVE_PATH.join("/"),
    };
  } catch (error) {
    throw normalizeDriveError(error);
  }
};

export const getDemoTutorialDownloadStream = async (fileId) => {
  const drive = await getDrive();

  try {
    const response = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );
    return response.data;
  } catch (error) {
    throw normalizeDriveError(error);
  }
};

export const deleteDemoTutorialFileFromDrive = async (fileId) => {
  if (!fileId) return false;
  const drive = await getDrive();

  try {
    await drive.files.delete({ fileId });
    return true;
  } catch (error) {
    const status = Number(error?.response?.status || error?.code || 0);
    if (status === 404) return false;
    throw normalizeDriveError(error);
  }
};
