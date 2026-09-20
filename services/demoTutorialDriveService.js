import crypto from "crypto";
import { google } from "googleapis";
import { buildOAuthClient } from "./googleDriveService.js";
import { validateDemoTutorialSignatureBytes } from "./demoTutorialFileValidationService.js";

export const DEMO_TUTORIAL_DRIVE_PATH = Object.freeze(["UNIS", "Demo-Tutorial"]);
export const DEMO_TUTORIAL_DOWNLOAD_CHUNK_BYTES = 2 * 1024 * 1024;
export const DEMO_TUTORIAL_UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;

const escapeDriveQuery = (value) => String(value || "").replace(/'/g, "\\'");

const safeFolderName = (value, fallback = "Folder") => {
  const cleaned = String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ");
  return cleaned || fallback;
};

export const safeDemoTutorialDriveFileName = (value, fallback = "tutorial-file") => {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return fallback;
  const dot = cleaned.lastIndexOf(".");
  const extension = dot > 0 ? cleaned.slice(dot).slice(0, 12) : "";
  const base = dot > 0 ? cleaned.slice(0, dot) : cleaned;
  const maxBaseLength = Math.max(1, 180 - extension.length);
  return `${base.slice(0, maxBaseLength).trim() || "tutorial-file"}${extension}`;
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
    return Object.assign(
      new Error("Google Drive connection expired. Please reconnect Google Drive."),
      { status: 502 }
    );
  }
  if (/not connected/i.test(message)) {
    return Object.assign(
      new Error("Google Drive is not connected. Please connect Google Drive."),
      { status: 502 }
    );
  }
  return error;
};

const getDriveContext = async () => {
  try {
    const { client } = await buildOAuthClient();
    await client.getAccessToken();
    return {
      client,
      drive: google.drive({ version: "v3", auth: client }),
    };
  } catch (error) {
    throw normalizeDriveError(error);
  }
};

const getOAuthBearerToken = async (client) => {
  try {
    const response = await client.getAccessToken();
    const token = typeof response === "string" ? response : response?.token;
    if (!token) {
      throw new Error("Google Drive is not connected. Please connect Google Drive.");
    }
    return token;
  } catch (error) {
    throw normalizeDriveError(error);
  }
};

const parseResumeRange = (value) => {
  const match = /^bytes=(\d+)-(\d+)$/i.exec(String(value || "").trim());
  if (!match) return 0;
  const end = Number(match[2]);
  return Number.isSafeInteger(end) && end >= 0 ? end + 1 : 0;
};

const parseGoogleJson = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};

const normalizeResumableUploadResponseError = async (response) => {
  if (response.status === 404 || response.status === 410) {
    return Object.assign(
      new Error("Upload session expired or is invalid. Please try again."),
      { status: 400 }
    );
  }

  let detail = "";
  try {
    const data = await response.clone().json();
    detail = String(data?.error?.message || data?.error || "");
  } catch {
    try {
      detail = await response.clone().text();
    } catch {
      detail = "";
    }
  }

  const error = new Error(detail || "Unable to upload Demo - Tutorial file.");
  error.status = response.status >= 400 && response.status < 500 ? 400 : 502;
  return error;
};

const queryDemoTutorialResumableStatus = async ({
  sessionUrl,
  total,
  bearerToken,
}) => {
  const response = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Range": `bytes */${total}`,
    },
    redirect: "manual",
  });

  if (response.status === 308) {
    return {
      completed: false,
      nextOffset: parseResumeRange(response.headers.get("range")),
      file: null,
    };
  }

  if (response.status === 200 || response.status === 201) {
    return {
      completed: true,
      nextOffset: total,
      file: await parseGoogleJson(response),
    };
  }

  throw await normalizeResumableUploadResponseError(response);
};

export const uploadDemoTutorialResumableChunk = async ({
  sessionUrl,
  mimeType,
  chunk,
  start,
  end,
  total,
}) => {
  if (!Buffer.isBuffer(chunk) || chunk.length <= 0) {
    throw Object.assign(
      new Error("Upload session expired or is invalid. Please try again."),
      { status: 400 }
    );
  }

  const { client } = await getDriveContext();
  const bearerToken = await getOAuthBearerToken(client);

  // Query Drive first. If the previous Vercel response was lost after Google
  // accepted a chunk, this makes retrying the same browser chunk idempotent.
  const current = await queryDemoTutorialResumableStatus({
    sessionUrl,
    total,
    bearerToken,
  });

  if (current.completed) return current;
  if (current.nextOffset > start) return current;
  if (current.nextOffset !== start) {
    throw Object.assign(
      new Error("Upload session expired or is invalid. Please try again."),
      { status: 409 }
    );
  }

  const response = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": mimeType || "application/octet-stream",
      "Content-Range": `bytes ${start}-${end}/${total}`,
    },
    body: chunk,
    redirect: "manual",
  });

  if (response.status === 308) {
    return {
      completed: false,
      nextOffset: parseResumeRange(response.headers.get("range")),
      file: null,
    };
  }

  if (response.status === 200 || response.status === 201) {
    return {
      completed: true,
      nextOffset: total,
      file: await parseGoogleJson(response),
    };
  }

  throw await normalizeResumableUploadResponseError(response);
};

export const createDemoTutorialResumableSession = async ({
  originalFileName,
  mimeType,
  fileSize,
  existingFileId = null,
}) => {
  const { client, drive } = await getDriveContext();
  const driveFileName = safeDemoTutorialDriveFileName(originalFileName);
  const uploadNonce = crypto.randomBytes(16).toString("hex");
  const folderId = existingFileId
    ? null
    : await ensureFolderPath(drive, DEMO_TUTORIAL_DRIVE_PATH);

  const baseUrl = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingFileId)}`
    : "https://www.googleapis.com/upload/drive/v3/files";
  const url = `${baseUrl}?uploadType=resumable&fields=id,name,size,mimeType,parents,trashed,appProperties`;

  try {
    const response = await client.request({
      url,
      method: existingFileId ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(fileSize),
      },
      data: {
        name: driveFileName,
        mimeType,
        appProperties: { unisDemoUpload: uploadNonce },
        ...(!existingFileId && folderId ? { parents: [folderId] } : {}),
      },
    });

    const sessionUrl = String(
      response?.headers?.location || response?.headers?.get?.("location") || ""
    ).trim();
    if (!sessionUrl) {
      throw new Error("Google Drive did not return a resumable upload session URL.");
    }

    return {
      sessionUrl,
      driveFileName,
      uploadNonce,
      driveFolderId: folderId,
      driveFolderPath: DEMO_TUTORIAL_DRIVE_PATH.join("/"),
    };
  } catch (error) {
    throw normalizeDriveError(error);
  }
};

export const getDemoTutorialDriveFileMetadata = async (fileId) => {
  const { drive } = await getDriveContext();
  try {
    const response = await drive.files.get({
      fileId,
      fields: "id,name,size,mimeType,parents,trashed,appProperties",
    });
    return response.data;
  } catch (error) {
    throw normalizeDriveError(error);
  }
};

const readDemoTutorialDriveFileHead = async (fileId, maxBytes = 16) => {
  const { client } = await getDriveContext();

  try {
    const response = await client.request({
      url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      method: "GET",
      headers: { Range: `bytes=0-${Math.max(0, maxBytes - 1)}` },
      responseType: "stream",
    });

    const stream = response.data;
    return await new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks, total).subarray(0, maxBytes));
      };

      stream.on("data", (chunk) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = maxBytes - total;
        if (remaining > 0) {
          const part = buffer.subarray(0, remaining);
          chunks.push(part);
          total += part.length;
        }
        if (total >= maxBytes) {
          finish();
          stream.destroy();
        }
      });
      stream.on("end", finish);
      stream.on("close", () => {
        if (!settled && total > 0) finish();
      });
      stream.on("error", (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
    });
  } catch (error) {
    throw normalizeDriveError(error);
  }
};

export const verifyCompletedDemoTutorialUpload = async ({
  fileId,
  expectedFileName,
  expectedMimeType,
  expectedFileSize,
  expectedParentId = null,
  expectedUploadNonce = "",
}) => {
  const metadata = await getDemoTutorialDriveFileMetadata(fileId);
  if (!metadata?.id || metadata.trashed) {
    throw Object.assign(new Error("Uploaded Google Drive file could not be verified."), { status: 400 });
  }

  if (String(metadata.name || "") !== String(expectedFileName || "")) {
    throw Object.assign(new Error("Uploaded Google Drive file could not be verified."), { status: 400 });
  }

  const actualSize = Number(metadata.size || 0);
  if (!Number.isSafeInteger(actualSize) || actualSize !== Number(expectedFileSize || 0)) {
    throw Object.assign(new Error("Uploaded Google Drive file could not be verified."), { status: 400 });
  }

  if (String(metadata.mimeType || "") !== String(expectedMimeType || "")) {
    throw Object.assign(new Error("Uploaded Google Drive file could not be verified."), { status: 400 });
  }

  if (expectedParentId) {
    const parents = Array.isArray(metadata.parents) ? metadata.parents : [];
    if (!parents.includes(expectedParentId)) {
      throw Object.assign(new Error("Uploaded Google Drive file could not be verified."), { status: 400 });
    }
  }
  if (
    expectedUploadNonce &&
    String(metadata.appProperties?.unisDemoUpload || "") !== String(expectedUploadNonce)
  ) {
    throw Object.assign(new Error("Uploaded Google Drive file could not be verified."), { status: 400 });
  }

  const head = await readDemoTutorialDriveFileHead(fileId, 16);
  const fileKind = validateDemoTutorialSignatureBytes({
    fileName: expectedFileName,
    bytes: head,
  });

  return {
    driveFileId: metadata.id,
    driveFileName: metadata.name,
    fileSize: actualSize,
    mimeType: metadata.mimeType,
    fileKind,
    driveFolderPath: DEMO_TUTORIAL_DRIVE_PATH.join("/"),
  };
};

export const getDemoTutorialDownloadStream = async (fileId) => {
  const { drive } = await getDriveContext();

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

export const getDemoTutorialDownloadRange = async ({ fileId, start, end }) => {
  const { client } = await getDriveContext();
  const expectedLength = end - start + 1;
  try {
    const response = await client.request({
      url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      method: "GET",
      headers: { Range: `bytes=${start}-${end}` },
      responseType: "stream",
    });

    const contentRange = String(
      response?.headers?.["content-range"] ||
        response?.headers?.get?.("content-range") ||
        ""
    );
    if (Number(response?.status || 0) !== 206 || !contentRange.startsWith(`bytes ${start}-${end}/`)) {
      response?.data?.destroy?.();
      throw Object.assign(new Error("Unable to download file from Google Drive."), { status: 502 });
    }

    const stream = response.data;
    return await new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      let settled = false;

      const fail = (error) => {
        if (settled) return;
        settled = true;
        stream.destroy();
        reject(error);
      };

      stream.on("data", (chunk) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > expectedLength) {
          fail(Object.assign(new Error("Unable to download file from Google Drive."), { status: 502 }));
          return;
        }
        chunks.push(buffer);
      });
      stream.on("end", () => {
        if (settled) return;
        if (total !== expectedLength) {
          fail(Object.assign(new Error("Unable to download file from Google Drive."), { status: 502 }));
          return;
        }
        settled = true;
        resolve(Buffer.concat(chunks, total));
      });
      stream.on("error", (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
    });
  } catch (error) {
    throw normalizeDriveError(error);
  }
};

export const deleteDemoTutorialFileFromDrive = async (fileId) => {
  if (!fileId) return false;
  const { drive } = await getDriveContext();

  try {
    await drive.files.delete({ fileId });
    return true;
  } catch (error) {
    const status = Number(error?.response?.status || error?.code || 0);
    if (status === 404) return false;
    throw normalizeDriveError(error);
  }
};
