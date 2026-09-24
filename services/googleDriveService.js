import { google } from "googleapis";
import { Readable } from "stream";
import IntegrationCredential from "../models/IntegrationCredential.js";
import { decryptText } from "../utils/cryptoHelper.js";
import { ensureEnvironmentDriveFolderPath } from "./driveFolderService.js";

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

// Backward-compatible function name. The actual root is environment-aware:
// production -> UNIS, staging -> configured UNIS-STAGING root folder.
export const ensureUNISPaymentProofsFolder = async (oauthClient) => {
  const drive = google.drive({ version: "v3", auth: oauthClient });
  const { folderId } = await ensureEnvironmentDriveFolderPath(drive, ["PaymentProofs"]);
  return folderId;
};

export const uploadProofToDrive = async ({ file }) => {
  const { client } = await buildOAuthClient();
  const drive = google.drive({ version: "v3", auth: client });

  // Resolve the folder on every upload so a stale/copy-pasted IntegrationCredential
  // can never silently point staging at a production folder.
  const { folderId } = await ensureEnvironmentDriveFolderPath(drive, ["PaymentProofs"]);

  const driveFileName = buildTimestampedName(file.originalname);

  const res = await drive.files.create({
    requestBody: {
      name: driveFileName,
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
  const safeBase = base.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return `${safeBase || "file"}_${formatTs()}${ext}`;
};
