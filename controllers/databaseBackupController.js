import { BackupError } from "../utils/databaseBackupArchive.js";
import { getDatabaseBackupStatus, createDatabaseBackup } from "../services/databaseBackupService.js";

const respondFailure = (res, error) => {
  console.error("[database-backup] request failed", { type: error?.name || "Error", code: error?.code || null });
  return res.status(error instanceof BackupError ? error.status : 503).json({
    success: false,
    error: error instanceof BackupError ? error.message : "Backup could not finish. Check history, MongoDB snapshot support and Google Drive access before retrying. Older verified backups were kept.",
  });
};

export async function databaseBackupStatus(req, res) {
  res.set("Cache-Control", "no-store");
  try { return res.json({ success: true, ...(await getDatabaseBackupStatus()) }); }
  catch (error) { return respondFailure(res, error); }
}

export async function databaseBackupNow(req, res) {
  res.set("Cache-Control", "no-store");
  const requestId = req.body?.requestId;
  if (Object.keys(req.body || {}).some((key) => key !== "requestId") ||
      typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return res.status(400).json({ success: false, error: "Send only a valid backup request ID. The server selects its own database and Drive folder." });
  }
  try {
    const result = await createDatabaseBackup(requestId.toLowerCase());
    return res.json({ success: true, message: result.reused ? "This backup request was already completed." : "Database backup uploaded and verified.", ...result });
  } catch (error) { return respondFailure(res, error); }
}
