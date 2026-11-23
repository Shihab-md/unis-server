import { createHash } from "node:crypto";
import { BackupError, sha256 } from "../utils/databaseBackupArchive.js";

const FOLDER = "application/vnd.google-apps.folder";
const FIELDS = "id,name,mimeType,parents,trashed,size,createdTime,appProperties,webViewLink,sha256Checksum";
const quote = (text) => String(text).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const owned = (file, context, folderId) => file?.appProperties?.unisBackup === "manual-v1" &&
  file.appProperties.environment === context.environment && file.appProperties.database === context.database &&
  file.appProperties.rootId === context.rootId && file.parents?.length === 1 && file.parents[0] === folderId && !file.trashed;

async function getFolder(drive, id, name, parent, guard) {
  const { data } = await guard.run(drive.files.get({ fileId: id, fields: FIELDS }, guard.options()));
  if (data.trashed || data.mimeType !== FOLDER || data.name !== name ||
      (parent && (data.parents?.length !== 1 || data.parents[0] !== parent))) {
    throw new BackupError("Google Drive backup folder does not match this environment.");
  }
  return data.id;
}

async function findFolder(drive, name, parent, createMissing, guard) {
  const q = `trashed = false and mimeType = '${FOLDER}' and name = '${quote(name)}'` +
    (parent ? ` and '${quote(parent)}' in parents` : "");
  const { data } = await guard.run(drive.files.list({ q, pageSize: 100, fields: `nextPageToken,files(${FIELDS})` }, guard.options()));
  if (data.nextPageToken || data.files?.length > 1) throw new BackupError("Duplicate Google Drive backup folders found. Configure one explicit backup root folder ID.");
  if (data.files?.length) return getFolder(drive, data.files[0].id, name, parent, guard);
  if (!createMissing) return null;
  await guard.assertLock();
  const created = await guard.run(drive.files.create({
    requestBody: { name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }, fields: "id",
  }, guard.options()));
  return getFolder(drive, created.data.id, name, parent, guard);
}

export async function resolveBackupFolder(drive, context, guard, createMissing = false) {
  const rootId = context.configuredRootId
    ? await getFolder(drive, context.configuredRootId, context.rootName, null, guard)
    : await findFolder(drive, context.rootName, null, createMissing, guard);
  if (!rootId) return { ...context, rootId: null, folderId: null, backupsFolderId: null };
  const backupsFolderId = await findFolder(drive, "Backups", rootId, createMissing, guard);
  const folderId = backupsFolderId ? await findFolder(drive, "MongoDB", backupsFolderId, createMissing, guard) : null;
  return { ...context, rootId, backupsFolderId, folderId };
}

export async function assertBackupPath(drive, context, guard) {
  await getFolder(drive, context.rootId, context.rootName, null, guard);
  await getFolder(drive, context.backupsFolderId, "Backups", context.rootId, guard);
  await getFolder(drive, context.folderId, "MongoDB", context.backupsFolderId, guard);
}

export async function listBackupFiles(drive, context, guard) {
  if (!context.folderId) return [];
  const files = [];
  let pageToken;
  do {
    const { data } = await guard.run(drive.files.list({
      q: `trashed = false and '${quote(context.folderId)}' in parents and appProperties has { key='unisBackup' and value='manual-v1' }`,
      fields: `nextPageToken,files(${FIELDS})`, pageSize: 100, pageToken,
    }, guard.options()));
    files.push(...(data.files || []).filter((file) => owned(file, context, context.folderId)));
    if (files.length > 1000) throw new BackupError("Too many backup files. Review the backup folder before continuing.");
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files.sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)) || b.id.localeCompare(a.id));
}

export function backupFileSummary(file) {
  return {
    id: file.id, name: file.name, createdAt: file.createdTime,
    backupDate: file.appProperties?.backupDate, status: file.appProperties?.status,
    requestId: file.appProperties?.requestId,
    collections: Number(file.appProperties?.collections || 0),
    documents: Number(file.appProperties?.documents || 0), bytes: Number(file.size || 0),
    keyId: file.appProperties?.keyId || "", sha256: file.appProperties?.sha256 || "",
    viewUrl: `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`,
  };
}

export async function uploadResumableArchive({ uploadClient, metadata, archive, guard }) {
  await guard.assertLock();
  const session = await guard.run(uploadClient.request({
    ...guard.options(), method: "POST",
    url: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=${encodeURIComponent(FIELDS)}`,
    headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/octet-stream", "X-Upload-Content-Length": String(archive.length) },
    data: metadata,
  }));
  const header = (response, name) => response.headers?.get?.(name) || response.headers?.[name];
  const location = header(session, "location");
  let url;
  try { url = new URL(location); } catch { throw new BackupError("Google Drive did not provide an upload session."); }
  if (url.origin !== "https://www.googleapis.com" || url.pathname !== "/upload/drive/v3/files") throw new BackupError("Unexpected Google Drive upload session URL.");
  // Every non-final chunk is an exact multiple of Drive's 256 KiB requirement.
  const chunkSize = 4 * 1024 * 1024;
  for (let start = 0; start < archive.length; start += chunkSize) {
    await guard.assertLock();
    const end = Math.min(start + chunkSize, archive.length) - 1;
    const response = await guard.run(uploadClient.request({
      ...guard.options(), method: "PUT", url: location, maxRedirects: 0,
      headers: { "Content-Type": "application/octet-stream", "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${archive.length}` },
      data: archive.subarray(start, end + 1), validateStatus: (status) => status === 308 || (status >= 200 && status < 300),
    }));
    if (end === archive.length - 1) {
      if ((response.status !== 200 && response.status !== 201) || response.data?.id !== metadata.id) throw new BackupError("Google Drive upload completion was not confirmed.");
      return response.data;
    }
    if (response.status !== 308 || header(response, "range") !== `bytes=0-${end}`) throw new BackupError("Google Drive did not acknowledge the uploaded chunk. Older backups were kept.");
  }
  throw new BackupError("Empty backup upload was rejected.");
}

export async function uploadAndVerifyBackup({ drive, uploadClient, context, archive, snapshot, guard }) {
  await guard.assertLock();
  await assertBackupPath(drive, context, guard);
  const ids = await guard.run(drive.files.generateIds({ count: 1, space: "drive", type: "files" }, guard.options()));
  const id = ids.data.ids?.[0];
  if (!id) throw new BackupError("Google Drive did not provide a backup file ID.");
  const properties = {
    unisBackup: "manual-v1", environment: context.environment, database: context.database,
    rootId: context.rootId, requestId: snapshot.requestId, backupDate: snapshot.backupDate,
    status: "pending", keyId: context.keyId, sha256: sha256(archive),
    collections: String(snapshot.collections.length),
    documents: String(snapshot.collections.reduce((sum, c) => sum + c.documentCount, 0)),
  };
  // A preallocated ID and disabled HTTP retries avoid an ambiguous repeated upload.
  await guard.assertLock();
  await uploadResumableArchive({ uploadClient, archive, guard, metadata: {
    id, name: `${context.database}_${snapshot.backupDate}_${snapshot.requestId}.unisbackup`,
    parents: [context.folderId], appProperties: properties,
  } });
  const result = await guard.run(drive.files.get({ fileId: id, fields: FIELDS }, guard.options()));
  if (!owned(result.data, context, context.folderId) || Number(result.data.size) !== archive.length ||
      (result.data.sha256Checksum && result.data.sha256Checksum !== properties.sha256) ||
      result.data.appProperties?.requestId !== snapshot.requestId) throw new BackupError("Uploaded backup metadata could not be verified.");
  const download = await guard.run(drive.files.get({ fileId: id, alt: "media" }, { ...guard.options(), responseType: "stream" }));
  const stream = download.data;
  const hash = createHash("sha256");
  let received = 0;
  const stop = () => stream.destroy(new BackupError("Backup verification deadline exceeded."));
  guard.signal.addEventListener("abort", stop, { once: true });
  try {
    await guard.run((async () => {
      for await (const chunk of stream) {
        guard.check();
        received += chunk.length;
        if (received > archive.length) throw new BackupError("Uploaded backup size mismatch.");
        hash.update(chunk);
      }
    })());
  } finally {
    guard.signal.removeEventListener("abort", stop);
    stream.destroy();
  }
  if (received !== archive.length || hash.digest("hex") !== properties.sha256) throw new BackupError("Uploaded backup checksum mismatch. Older backups were kept.");
  await guard.assertLock();
  await assertBackupPath(drive, context, guard);
  const completed = await guard.run(drive.files.update({
    fileId: id, requestBody: { appProperties: { ...properties, status: "complete" } }, fields: FIELDS,
  }, guard.options()));
  if (!owned(completed.data, context, context.folderId) || completed.data.appProperties?.status !== "complete" ||
      completed.data.appProperties?.sha256 !== properties.sha256 ||
      completed.data.appProperties?.requestId !== properties.requestId || completed.data.appProperties?.backupDate !== properties.backupDate ||
      Number(completed.data.size) !== archive.length) throw new BackupError("Backup completion could not be confirmed. Check backup history.");
  return completed.data;
}

export function retentionCandidates(files, today, currentId) {
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(end)) throw new BackupError("Invalid retention date.");
  const oldest = new Date(end - 9 * 86400000).toISOString().slice(0, 10);
  const keptDates = new Set();
  const ordered = [...files].sort((a, b) => a.id === b.id ? 0 :
    (a.id === currentId ? -1 : b.id === currentId ? 1 : String(b.createdTime).localeCompare(String(a.createdTime)) || b.id.localeCompare(a.id)));
  return ordered.filter((file) => {
    const date = file.appProperties?.backupDate;
    if (file.id === currentId) { keptDates.add(today); return false; }
    if (file.appProperties?.status !== "complete" || !/^\d{4}-\d{2}-\d{2}$/.test(date || "") ||
        !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || date > today) return false;
    if (date < oldest || keptDates.has(date)) return true;
    keptDates.add(date);
    return false;
  });
}

export async function pruneVerifiedBackups(drive, context, completed, guard) {
  await guard.assertLock();
  await assertBackupPath(drive, context, guard);
  const fresh = await guard.run(drive.files.get({ fileId: completed.id, fields: FIELDS }, guard.options()));
  if (!owned(fresh.data, context, context.folderId) || fresh.data.appProperties?.status !== "complete" ||
      fresh.data.appProperties?.sha256 !== completed.appProperties.sha256 ||
      fresh.data.appProperties?.requestId !== completed.appProperties.requestId ||
      fresh.data.appProperties?.backupDate !== completed.appProperties.backupDate ||
      (fresh.data.sha256Checksum && fresh.data.sha256Checksum !== completed.appProperties.sha256) ||
      Number(fresh.data.size) !== Number(completed.size)) {
    throw new BackupError("New backup is no longer verified; retention stopped.");
  }
  const files = await listBackupFiles(drive, context, guard);
  let deleted = 0;
  for (const candidate of retentionCandidates(files, completed.appProperties.backupDate, completed.id)) {
    await guard.assertLock();
    await assertBackupPath(drive, context, guard);
    const check = await guard.run(drive.files.get({ fileId: candidate.id, fields: FIELDS }, guard.options()));
    if (!owned(check.data, context, context.folderId) || check.data.appProperties?.status !== "complete" ||
        check.data.appProperties?.requestId !== candidate.appProperties.requestId ||
        check.data.appProperties?.backupDate !== candidate.appProperties.backupDate) throw new BackupError("An older backup changed; retention stopped.");
    await guard.run(drive.files.delete({ fileId: candidate.id }, guard.options()));
    deleted += 1;
  }
  return deleted;
}
