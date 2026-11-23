import mongoose from "mongoose";
import { google } from "googleapis";
import getRedis from "../db/redis.js";
import { buildOAuthClient } from "./googleDriveService.js";
import { getAppEnvironment, getGoogleDriveRootFolderId, getGoogleDriveRootFolderName, getMongoDatabaseName } from "../utils/runtimeEnvironment.js";
import { BackupError, readBackupKey, encodeBackup, decodeBackup, MAX_BACKUP_BYTES } from "../utils/databaseBackupArchive.js";
import { captureDatabaseSnapshot } from "./databaseBackupSnapshotService.js";
import { resolveBackupFolder, listBackupFiles, backupFileSummary, uploadAndVerifyBackup, pruneVerifiedBackups } from "./databaseBackupDriveService.js";

export const indiaBackupDate = (date = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
}).format(date);

export function createBackupGuard(seconds = 240) {
  const controller = new AbortController();
  const started = Date.now();
  const deadline = started + seconds * 1000;
  const error = new BackupError("Backup time limit reached. Check history before retrying; older verified backups were kept.", 504);
  const timer = setTimeout(() => controller.abort(), seconds * 1000);
  timer.unref?.();
  const guard = {
    startedAt: new Date(started).toISOString(), signal: controller.signal,
    remaining: () => Math.max(1, deadline - Date.now()),
    check: () => { if (controller.signal.aborted || Date.now() >= deadline) throw error; },
    options: () => { guard.check(); return { timeout: Math.min(45000, guard.remaining()), retry: false, signal: controller.signal }; },
    async run(promise) {
      // Attach handlers even after a deadline, so late network rejections cannot
      // become unhandled promises or start any subsequent backup mutation.
      const tracked = Promise.resolve(promise);
      tracked.catch(() => {});
      guard.check();
      let abort;
      const timeout = new Promise((_, reject) => {
        abort = () => reject(error);
        controller.signal.addEventListener("abort", abort, { once: true });
      });
      try { const value = await Promise.race([tracked, timeout]); guard.check(); return value; }
      finally { controller.signal.removeEventListener("abort", abort); }
    },
    assertLock: async () => { guard.check(); },
    close: () => clearTimeout(timer),
  };
  return guard;
}

export function getBackupContext() {
  const environment = getAppEnvironment();
  const database = { production: "unisDB", staging: "unisDB_staging" }[environment];
  if (!database) throw new BackupError("Manual backup is available only in production or staging.", 503);
  if (getMongoDatabaseName() !== database || mongoose.connection.db?.databaseName !== database) {
    throw new BackupError("Backup database does not match this environment. Check APP_ENV and MONGODB_URL.", 503);
  }
  const rootName = environment === "staging" ? "UNIS-STAGING" : "UNIS";
  if (getGoogleDriveRootFolderName() !== rootName) throw new BackupError("Google Drive root name does not match this backup environment.", 503);
  return {
    environment, database, rootName,
    configuredRootId: String(process.env.DATABASE_BACKUP_DRIVE_ROOT_ID || getGoogleDriveRootFolderId()).trim(),
    keyId: String(process.env.DATABASE_BACKUP_KEY_ID || "").trim(),
  };
}

export function requireBackupConfiguration(context) {
  if (process.env.DATABASE_BACKUP_ENABLED !== "true") throw new BackupError("Manual backup is not enabled. Complete the server backup setup first.", 503);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(context.keyId)) throw new BackupError("Set DATABASE_BACKUP_KEY_ID to a short key identifier.", 503);
  let key;
  try { key = readBackupKey(process.env.DATABASE_BACKUP_ENCRYPTION_KEY); }
  catch { throw new BackupError("Set DATABASE_BACKUP_ENCRYPTION_KEY to a base64 encoded 32-byte key.", 503); }
  return key;
}

const createDrive = async (guard) => {
  try {
    const { client } = await guard.run(buildOAuthClient());
    return { drive: google.drive({ version: "v3", auth: client }), uploadClient: client };
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError("Google Drive is not connected or its credentials cannot be read. Reconnect Google Drive in Masters.", 503);
  }
};

export async function getDatabaseBackupStatus() {
  const guard = createBackupGuard(40);
  const result = {
    environment: getAppEnvironment(), database: null, ready: false, setupMessage: "",
    retentionDays: 10, timeZone: "Asia/Kolkata", maxRawBytes: MAX_BACKUP_BYTES,
    running: false, backups: [], pending: [],
  };
  try {
    const context = getBackupContext();
    Object.assign(result, { database: context.database, drivePath: `${context.rootName}/Backups/MongoDB`, keyId: context.keyId });
    try { requireBackupConfiguration(context); result.ready = true; }
    catch (error) { result.setupMessage = error.message; }
    const redis = await guard.run(getRedis());
    result.running = Boolean(await guard.run(redis.get(`unis:database-backup:${context.environment}:${context.database}:lock`)));
    const { drive } = await createDrive(guard);
    const path = await resolveBackupFolder(drive, context, guard);
    const files = await listBackupFiles(drive, path, guard);
    result.backups = files.filter((f) => f.appProperties.status === "complete").map(backupFileSummary);
    result.pending = files.filter((f) => f.appProperties.status !== "complete").map(backupFileSummary);
    if (path.folderId) result.folderUrl = `https://drive.google.com/drive/folders/${encodeURIComponent(path.folderId)}`;
    return result;
  } finally { guard.close(); }
}

export async function runManualBackup({ requestId, guard, redis, drive, uploadClient, context, key, capture }) {
  const lockKey = `unis:database-backup:${context.environment}:${context.database}:lock`;
  // The fixed 10-minute lease exceeds the 4-minute job deadline. No process-only
  // lock and no background worker: different Vercel instances share this lock.
  const lease = `${requestId}:${Date.now()}`;
  const acquired = await guard.run(redis.set(lockKey, lease, { NX: true, EX: 600 }));
  if (acquired !== "OK") throw new BackupError("Another backup is running. Refresh status before trying again.", 409);
  guard.assertLock = async () => {
    guard.check();
    if (await guard.run(redis.get(lockKey)) !== lease) throw new BackupError("Backup lock was lost. Older verified backups were kept.", 409);
  };
  let completed;
  const warnings = [];
  try {
    const path = await resolveBackupFolder(drive, context, guard, true);
    const existing = (await listBackupFiles(drive, path, guard)).filter((f) => f.appProperties.requestId === requestId);
    if (existing.length > 1) throw new BackupError("Duplicate backup request records found. Review Drive before retrying.", 409);
    if (existing[0]) {
      if (existing[0].appProperties.status !== "complete") throw new BackupError("This request has an unverified upload. Check history before starting a new backup.", 409);
      return { backup: backupFileSummary(existing[0]), warnings, reused: true };
    }
    const snapshot = await capture({ context, requestId, backupDate: indiaBackupDate(new Date(guard.startedAt)), guard });
    await guard.assertLock();
    const archive = await guard.run(encodeBackup(snapshot, key));
    // Verify the recovery reader against the actual archive before it leaves the
    // server. This also checks every BSON boundary, count and collection digest.
    await guard.run(decodeBackup(archive, key));
    await guard.assertLock();
    completed = await uploadAndVerifyBackup({ drive, uploadClient, context: path, archive, snapshot, guard });
    try { await pruneVerifiedBackups(drive, path, completed, guard); }
    catch { warnings.push("Backup is verified, but older-file cleanup did not finish. Older files were kept where cleanup could not be confirmed."); }
    return { backup: backupFileSummary(completed), warnings, reused: false };
  } finally {
    // Owner-only release must not remove another instance's lease. If Redis is
    // unreachable the lease expires naturally; successful backup stays success.
    try {
      await guard.run(redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", {
        keys: [lockKey], arguments: [lease],
      }));
    } catch { /* Fixed expiry handles release failures and platform termination. */ }
  }
}

export async function createDatabaseBackup(requestId) {
  const guard = createBackupGuard();
  try {
    const context = getBackupContext();
    const key = requireBackupConfiguration(context);
    const redis = await guard.run(getRedis());
    const { drive, uploadClient } = await createDrive(guard);
    return await runManualBackup({
      requestId, guard, redis, drive, uploadClient, context, key,
      capture: (options) => captureDatabaseSnapshot({
        ...options, db: mongoose.connection.db, client: mongoose.connection.getClient(), BSON: mongoose.mongo.BSON,
      }),
    });
  } finally { guard.close(); }
}
