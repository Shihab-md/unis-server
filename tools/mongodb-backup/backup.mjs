#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lstat, readFile } from 'node:fs/promises';
import { configuration, readKey, required, TARGETS } from './config.mjs';
import { decryptArchive, verifyArchive } from './archive.mjs';
import { DriveClient } from './drive.mjs';
import { backupStatus, runBackup } from './worker.mjs';

export async function main(args = process.argv.slice(2), env = process.env) {
  const [action, source, destination] = args;
  const log = (value) => console.log(JSON.stringify(value));
  if (['verify', 'decrypt'].includes(action)) {
    if (!source || (action === 'decrypt' && !destination) || args.length !== (action === 'decrypt' ? 3 : 2)) throw new Error('Use: backup.mjs verify INPUT or backup.mjs decrypt INPUT NEW_OUTPUT');
    const environment = required(env, 'UNIS_BACKUP_ENV');
    if (!TARGETS[environment]) throw new Error('UNIS_BACKUP_ENV must be production or staging');
    const expected = { environment, database: TARGETS[environment].database, keyId: required(env, 'UNIS_BACKUP_KEY_ID') };
    const key = readKey(env);
    const header = action === 'verify' ? await verifyArchive(resolve(source), key, expected) :
      await decryptArchive(resolve(source), resolve(destination), key, expected);
    log({ status: action === 'verify' ? 'authenticated' : 'decrypted', environment, database: header.database,
      day: header.day, plainSha256: header.plainSha256, toolVersion: header.toolVersion });
    return;
  }
  if (!['init', 'run', 'status'].includes(action) || args.length !== 1) throw new Error('Use: backup.mjs init | run | status | verify INPUT | decrypt INPUT NEW_OUTPUT');
  if (env.UNIS_BACKUP_SECRETS_FILE) {
    const path = resolve(env.UNIS_BACKUP_SECRETS_FILE);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 ||
        (process.getuid && info.uid !== process.getuid())) throw new Error('Invalid private Google credential file permissions');
    let values;
    try { values = JSON.parse(await readFile(path, 'utf8')); } catch { throw new Error('Invalid private Google credential file'); }
    const permitted = ['UNIS_BACKUP_GOOGLE_CLIENT_ID', 'UNIS_BACKUP_GOOGLE_CLIENT_SECRET', 'UNIS_BACKUP_GOOGLE_REFRESH_TOKEN'];
    if (!values || typeof values !== 'object' || Object.keys(values).length !== permitted.length ||
        permitted.some((name) => typeof values[name] !== 'string' || !values[name].trim()) ||
        Object.keys(values).some((name) => !permitted.includes(name))) throw new Error('Invalid private Google credential file fields');
    env = { ...env, ...values };
  }
  const config = configuration(env, action);
  const drive = new DriveClient(config);
  if (action === 'init') { log(await drive.init()); return; }
  if (action === 'status') { log(await backupStatus(config, drive)); return; }
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGTERM', interrupt); process.on('SIGINT', interrupt);
  // HTTP work stops promptly; the worker's finally block still runs the resume hook.
  drive.shutdownSignal = controller.signal;
  try { await runBackup(config, drive, { signal: controller.signal, log }); }
  finally { process.off('SIGTERM', interrupt); process.off('SIGINT', interrupt); }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  main().catch((error) => {
    // Error messages emitted by this worker are deliberately redacted.
    // Unexpected exceptions may contain credentials; do not print their details.
    const safe = /^(UNIS_BACKUP_|Backup |Invalid |Cannot |Google |Drive |The configured |Tool |Maintenance |RESUME FAILED|No completed |Latest completed |Archive |Unsupported |Decrypted |Restore output |Multiple |Existing |Unexpected |MongoDB |The work |Cannot identify|Use:)/;
    console.error(JSON.stringify({ status: 'failed', error: safe.test(error.message) ? error.message :
      'Backup failed; review the last-attempt phase and private worker configuration. No credentials have been logged.' }));
    process.exitCode = 1;
  });
}
