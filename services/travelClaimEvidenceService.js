import { google } from "googleapis";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { buildOAuthClient } from "./googleDriveService.js";
import { getAppEnvironment, getGoogleDriveRootFolderId, getGoogleDriveRootFolderName } from "../utils/runtimeEnvironment.js";
import { failTa, evidenceType, MAX_EVIDENCE_BYTES } from "../utils/travelClaimPolicy.js";
import HqFinanceState from "../models/HqFinanceState.js";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const network = () => ({ timeout: 20000, retry: false });
const FOLDER = "application/vnd.google-apps.folder";
const folderFields = "id,name,mimeType,parents,trashed";
const quote = (value) => String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
async function assertRestrictedSharing(drive, fileId) {
  const { data } = await drive.permissions.list({ fileId, pageSize: 100, fields: "nextPageToken,permissions(type,role)" }, network());
  // Receipts inherit parent sharing. Do not upload into or serve files from a
  // publicly linked or whole-domain folder, even if the app itself adds no ACL.
  if (!Array.isArray(data.permissions) || data.nextPageToken || data.permissions.some((p) => ["anyone", "domain"].includes(p.type))) failTa("TA_EVIDENCE_UNAVAILABLE", 409);
}
async function resolveEvidenceFolder(drive, claimId) {
  const rootName = getAppEnvironment() === "staging" ? "UNIS-STAGING" : "UNIS";
  if (getGoogleDriveRootFolderName() !== rootName) failTa("TA_EVIDENCE_UNAVAILABLE", 409);
  const configured = getGoogleDriveRootFolderId();
  async function folder(name, parent = null, id = null) {
    if (!id) {
      const result = await drive.files.list({ q: `trashed = false and mimeType = '${FOLDER}' and name = '${quote(name)}'` + (parent ? ` and '${quote(parent)}' in parents` : ""), fields: `nextPageToken,files(${folderFields})`, pageSize: 100 }, network());
      if (result.data.nextPageToken || result.data.files?.length > 1) failTa("TA_EVIDENCE_UNAVAILABLE", 409);
      id = result.data.files?.[0]?.id;
      if (parent) {
        // Persist one preallocated Drive ID per logical folder. Concurrent first
        // uploads create the SAME ID; a 409 is resolved by reading that ID. A
        // lost response never leads to a second differently named folder.
        const planKey = `TA_FOLDER:${getAppEnvironment()}:${parent}:${name}`;
        let plan = await HqFinanceState.findById(planKey).lean();
        if (!plan?.driveFolderId) {
          const proposed = id || (await drive.files.generateIds({ count: 1, space: "drive", type: "files" }, network())).data.ids?.[0];
          if (!proposed) failTa("TA_UPLOAD_FAILED", 503);
          try { plan = await HqFinanceState.findOneAndUpdate({ _id: planKey }, { $setOnInsert: { driveFolderId: proposed } }, { upsert: true, new: true }).lean(); }
          catch (error) { if (error.code !== 11000) throw error; plan = await HqFinanceState.findById(planKey).lean(); }
        }
        id = plan?.driveFolderId;
        if (!id) failTa("TA_UPLOAD_FAILED", 503);
        try { await drive.files.get({ fileId: id, fields: "id" }, network()); }
        catch (error) {
          if (Number(error.code || error.response?.status) !== 404) throw error;
          try { await drive.files.create({ requestBody: { id, name, mimeType: FOLDER, parents: [parent] }, fields: "id" }, network()); }
          catch (createError) { if (Number(createError.code || createError.response?.status) !== 409) throw createError; }
        }
      }
      if (!id) failTa("TA_EVIDENCE_UNAVAILABLE", 409);
    }
    const { data } = await drive.files.get({ fileId: id, fields: folderFields }, network());
    if (data.trashed || data.mimeType !== FOLDER || data.name !== name || (parent && (data.parents?.length !== 1 || data.parents[0] !== parent))) failTa("TA_EVIDENCE_UNAVAILABLE", 409);
    await assertRestrictedSharing(drive, data.id);
    return data.id;
  }
  const rootFolderId = await folder(rootName, null, configured || null);
  const taFolder = await folder("TravelClaims", rootFolderId);
  const folderId = await folder(String(claimId), taFolder);
  return { folderId, rootFolderId };
}
export function taEvidenceName(fileName, preferredName, extension) {
  let name = typeof preferredName === "string" ? preferredName : String(fileName || "");
  // Busboy's filename parameter defaults to Latin-1, whereas browsers send UTF-8.
  // The new client sends an explicit UTF-8 form field. Legacy multipart clients
  // are repaired only when the complete byte sequence is valid UTF-8.
  if (typeof preferredName !== "string" && [...name].every((c) => c.codePointAt(0) <= 255)) {
    try { name = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(name, "latin1")); } catch { /* Genuine Latin-1 filename. */ }
  }
  if (Buffer.from(name, "utf8").toString("utf8") !== name) failTa("TA_INVALID_FILE");
  return Array.from(name.replace(/[\u0000-\u001f\u007f]/g, "")).slice(0, 180).join("") || `receipt.${extension}`;
}

export async function uploadTaEvidence(claim, file, uploadKey, preferredName) {
  const mimeType = evidenceType(file?.buffer);
  const { client } = await buildOAuthClient(); const drive = google.drive({ version: "v3", auth: client });
  const path = await resolveEvidenceFolder(drive, claim._id);
  const ids = await drive.files.generateIds({ count: 1, space: "drive", type: "files" }, network());
  const id = ids.data.ids?.[0]; if (!id) failTa("TA_UPLOAD_FAILED", 503);
  const extension = mimeType === "application/pdf" ? "pdf" : mimeType === "image/png" ? "png" : "jpg";
  const name = taEvidenceName(file.originalname, preferredName, extension);
  await drive.files.create({ requestBody: {
    id, name: `${uploadKey}.${extension}`, parents: [path.folderId],
    appProperties: { unisTa: "evidence-v1", claimId: String(claim._id), environment: getAppEnvironment(), uploadKey },
  }, media: { mimeType, body: Readable.from([file.buffer]) }, fields: "id,size,parents,appProperties" }, network());
  const { data } = await drive.files.get({ fileId: id, fields: "id,size,parents,trashed,appProperties,sha256Checksum" }, network());
  if (data.trashed || Number(data.size) !== file.buffer.length || data.parents?.length !== 1 || data.parents[0] !== path.folderId ||
      data.appProperties?.claimId !== String(claim._id) || data.appProperties?.environment !== getAppEnvironment() ||
      data.appProperties?.unisTa !== "evidence-v1" || data.appProperties?.uploadKey !== uploadKey ||
      (data.sha256Checksum && data.sha256Checksum !== digest(file.buffer))) failTa("TA_UPLOAD_FAILED", 503);
  await assertRestrictedSharing(drive, id);
  return { uploadKey, driveFileId: id, folderId: path.folderId, rootId: path.rootFolderId, environment: getAppEnvironment(),
    name: name || `receipt.${extension}`, mimeType, size: file.buffer.length, sha256: digest(file.buffer) };
}

export async function downloadTaEvidence(claim, evidence) {
  if (evidence.environment !== getAppEnvironment()) failTa("TA_FORBIDDEN", 403);
  const { client } = await buildOAuthClient(); const drive = google.drive({ version: "v3", auth: client });
  // Download only reads the recorded ancestor chain; it never creates folders.
  const root = await drive.files.get({ fileId: evidence.rootId, fields: folderFields }, network());
  const configured = getGoogleDriveRootFolderId();
  const expectedRoot = getAppEnvironment() === "staging" ? "UNIS-STAGING" : "UNIS";
  if ((configured && configured !== evidence.rootId) || root.data.trashed || root.data.mimeType !== FOLDER || root.data.name !== expectedRoot) failTa("TA_FORBIDDEN", 403);
  await assertRestrictedSharing(drive, evidence.rootId);
  const folder = await drive.files.get({ fileId: evidence.folderId, fields: folderFields }, network());
  if (folder.data.trashed || folder.data.mimeType !== FOLDER || folder.data.name !== String(claim._id) || folder.data.parents?.length !== 1) failTa("TA_FORBIDDEN", 403);
  await assertRestrictedSharing(drive, evidence.folderId);
  const parent = await drive.files.get({ fileId: folder.data.parents[0], fields: folderFields }, network());
  if (parent.data.trashed || parent.data.mimeType !== FOLDER || parent.data.name !== "TravelClaims" || parent.data.parents?.length !== 1 || parent.data.parents[0] !== evidence.rootId) failTa("TA_FORBIDDEN", 403);
  await assertRestrictedSharing(drive, parent.data.id);
  const { data } = await drive.files.get({ fileId: evidence.driveFileId, fields: "id,size,parents,trashed,appProperties" }, network());
  if (data.trashed || data.parents?.length !== 1 || data.parents[0] !== evidence.folderId || data.appProperties?.claimId !== String(claim._id) ||
      data.appProperties?.environment !== evidence.environment || data.appProperties?.unisTa !== "evidence-v1" ||
      data.appProperties?.uploadKey !== evidence.uploadKey || Number(data.size) !== evidence.size || evidence.size > MAX_EVIDENCE_BYTES) failTa("TA_EVIDENCE_UNAVAILABLE", 409);
  await assertRestrictedSharing(drive, evidence.driveFileId);
  const response = await drive.files.get({ fileId: evidence.driveFileId, alt: "media" }, { ...network(), responseType: "stream" });
  const chunks = []; let size = 0; const timer = setTimeout(() => response.data.destroy(new Error("timeout")), 20000);
  try { for await (const chunk of response.data) { size += chunk.length; if (size > evidence.size) failTa("TA_EVIDENCE_UNAVAILABLE", 409); chunks.push(chunk); } }
  finally { clearTimeout(timer); response.data.destroy(); }
  const bytes = Buffer.concat(chunks);
  if (size !== evidence.size || digest(bytes) !== evidence.sha256 || evidenceType(bytes) !== evidence.mimeType) failTa("TA_EVIDENCE_UNAVAILABLE", 409);
  return bytes;
}
