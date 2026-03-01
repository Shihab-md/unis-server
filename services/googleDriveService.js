import { google } from "googleapis";
import { Readable } from "stream";
import IntegrationCredential from "../models/IntegrationCredential.js";
import { decryptText } from "../utils/cryptoHelper.js";

export const buildOAuthClient = async () => {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  const cred = await IntegrationCredential.findOne({ key: "google_drive" }).lean();
  if (!cred) throw new Error("Google Drive not connected");

  const refreshToken = decryptText(cred.refreshTokenEnc);
  client.setCredentials({ refresh_token: refreshToken });

  return { client, folderId: cred.folderId };
};

const findChildFolderId = async (drive, parentId, folderName) => {
  const q = [
    `mimeType='application/vnd.google-apps.folder'`,
    `name='${folderName.replace(/'/g, "\\'")}'`,
    `trashed=false`,
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

// Ensure folder path exists: UNIS/PaymentProofs
export const ensureUNISPaymentProofsFolder = async (oauthClient) => {
  const drive = google.drive({ version: "v3", auth: oauthClient });

  let unisId = await findChildFolderId(drive, null, "UNIS");
  if (!unisId) unisId = await createFolder(drive, null, "UNIS");

  let proofsId = await findChildFolderId(drive, unisId, "PaymentProofs");
  if (!proofsId) proofsId = await createFolder(drive, unisId, "PaymentProofs");

  return proofsId;
};

export const uploadProofToDrive = async ({ file }) => {
  const { client, folderId } = await buildOAuthClient();
  const drive = google.drive({ version: "v3", auth: client });

  // ✅ Convert Buffer to stream so googleapis multipart upload works
  const stream = Readable.from(file.buffer);

  const driveFileName = buildTimestampedName(file.originalname);

  const res = await drive.files.create({
    requestBody: {
      name: driveFileName,          // ✅ abc_03012026112233.png
      parents: [folderId],
    },
    media: {
      mimeType: file.mimetype,
      body: Readable.from(file.buffer),
    },
    fields: "id,name,webViewLink",
  });

  const fileId = res.data.id;
  const viewUrl = res.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  return { fileId, fileName: res.data.name, viewUrl, downloadUrl };
};

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

const buildTimestampedName = (originalName = "file") => {
  const dot = originalName.lastIndexOf(".");
  const base = dot > 0 ? originalName.slice(0, dot) : originalName;
  const ext = dot > 0 ? originalName.slice(dot) : "";
  // remove risky chars for filenames
  const safeBase = base.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return `${safeBase || "file"}_${formatTs()}${ext}`;
};