import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OWNER, dayKey, ownedBackup, retentionCandidates } from './config.mjs';
import { encryptArchive, verifyArchive } from './archive.mjs';

export async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 ||
      (process.getuid && info.uid !== process.getuid()) || await realpath(path) !== path) {
    throw new Error('Backup work directory must be owned by the worker, mode 0700, without symlinks');
  }
}

export async function executable(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o022) !== 0) throw new Error('Tool or hook must be a regular executable file, not writable by group/others');
  await access(path, constants.X_OK);
}

export function command(binary, args, { input = '', timeout = 60000, signal, cwd, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Backup interrupted'));
    const child = spawn(binary, args, { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = ''; let failed = false; let settled = false; let killTimer;
    const stop = () => {
      failed = true; child.kill('SIGTERM');
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 5000);
      killTimer.unref();
    };
    const timer = setTimeout(stop, timeout); timer.unref();
    signal?.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
      if (Buffer.byteLength(output) > 65536) stop();
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    const finish = (error, code) => {
      if (settled) return; settled = true;
      clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', stop);
      if (error || failed || code !== 0) reject(new Error('Backup tool/hook failed, timed out or was interrupted; check its private operational logs'));
      else resolve(output);
    };
    child.on('error', (error) => finish(error));
    child.on('close', (code) => finish(null, code));
  });
}

export async function hook(path, context, action) {
  const output = await command(path, [], { input: JSON.stringify({ ...context, action }) + '\n', timeout: 60000 });
  let value;
  try { value = JSON.parse(output); } catch { throw new Error('Maintenance hook must return its JSON acknowledgement'); }
  if (value.environment !== context.environment || value.database !== context.database || value.runId !== context.runId ||
      (action === 'pause' ? value.paused !== true || value.drained !== true : value.resumed !== true)) {
    throw new Error('Maintenance hook did not confirm the correct environment, run and writer state');
  }
}

async function state(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

export async function runBackup(config, drive, {
  now = () => new Date(), runCommand = command, runHook = hook,
  encrypt = encryptArchive, verify = verifyArchive, signal, log = () => {},
} = {}) {
  const context = { environment: config.environment, database: config.database, runId: randomUUID(), day: dayKey(now()) };
  const interrupted = () => { if (signal?.aborted) throw new Error('Backup interrupted'); };
  await privateDirectory(config.workDir);
  const lock = join(config.workDir, 'backup.lock');
  try { await mkdir(lock, { mode: 0o700 }); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Backup lock exists; another run may be active. Never remove it before confirming the previous worker has stopped and writes have resumed');
    throw error;
  }
  let directory; let phase = 'preflight'; let resumeFailed = false;
  try {
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ ...context, pid: process.pid, startedAt: now().toISOString() }), { mode: 0o600, flag: 'wx' });
    directory = await mkdtemp(join(config.workDir, 'run-'));
    const plain = join(directory, 'database.archive.gz');
    const encrypted = join(directory, 'database.archive.gz.unisbkp');
    const toolConfig = join(directory, 'mongodump.yml');
    await executable(config.pauseHook); await executable(config.resumeHook); await executable(config.dumpBinary);
    await drive.validateFolder();
    const toolEnvironment = { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
    const versionOutput = await runCommand(config.dumpBinary, ['--version'], { env: toolEnvironment, cwd: directory, signal });
    const version = versionOutput.match(/^mongodump version: ([0-9.]+)$/m)?.[1];
    if (!version) throw new Error('Cannot identify mongodump tool version');
    await writeFile(toolConfig, JSON.stringify({ uri: config.uri }) + '\n', { mode: 0o600, flag: 'wx' });
    interrupted();
    phase = 'pause';
    const startedAt = now().toISOString();
    let dumpError;
    // A partially failed pause must still be followed by an idempotent resume.
    try {
      await runHook(config.pauseHook, context, 'pause');
      interrupted(); phase = 'dump'; log({ ...context, phase });
      await runCommand(config.dumpBinary, ['--config=' + toolConfig, '--db=' + config.database,
        '--archive=' + plain, '--gzip', '--readPreference=primary', '--numParallelCollections=1', '--quiet'],
      { timeout: 600000, signal, env: toolEnvironment, cwd: directory });
    } catch (error) { dumpError = error; }
    finally {
      phase = 'resume';
      try { await runHook(config.resumeHook, context, 'resume'); }
      catch { resumeFailed = true; throw new Error('RESUME FAILED: writes may still be paused. Backup stopped; lock retained. Restore writer service before removing the lock'); }
    }
    if (dumpError) throw dumpError;
    const dumpedAt = now().toISOString();
    await unlink(toolConfig);
    interrupted(); phase = 'encrypt';
    const result = await encrypt(plain, encrypted, config.key, {
      ...context, keyId: config.keyId, startedAt, dumpedAt, toolVersion: version,
      consistency: 'external-writers-paused-and-drained', timeZone: 'Asia/Kolkata',
    });
    await verify(encrypted, config.key, { ...context, keyId: config.keyId });
    await unlink(plain);
    interrupted(); phase = 'upload';
    await drive.validateFolder();
    const properties = { owner: OWNER, environment: config.environment, database: config.database,
      day: context.day, runId: context.runId, sha256: result.hash, state: 'pending', keyId: config.keyId };
    const remote = await drive.upload(encrypted, {
      name: `${config.database}_${context.day}_${context.runId}.archive.gz.unisbkp`, appProperties: properties,
    });
    interrupted(); phase = 'verify-remote';
    await drive.verifyRemote(remote.id, result.hash, result.bytes, context.runId, properties);
    interrupted(); phase = 'complete';
    await drive.validateFolder();
    const completed = await drive.markComplete(remote.id, properties);
    if (!ownedBackup(completed, config) || completed.appProperties.state !== 'complete' ||
        completed.appProperties.runId !== context.runId || completed.appProperties.sha256 !== result.hash ||
        completed.appProperties.day !== context.day || completed.appProperties.keyId !== config.keyId ||
        Number(completed.size) !== result.bytes) throw new Error('Drive did not confirm completion of the expected backup');
    const success = { ...context, fileId: remote.id, encryptedBytes: result.bytes, sha256: result.hash, completedAt: now().toISOString() };
    await state(join(config.workDir, 'last-success.json'), success);
    interrupted(); phase = 'retention';
    const files = await drive.backups();
    const expired = retentionCandidates(files, config, context.day, remote.id);
    for (const file of expired) { interrupted(); await drive.removeOwned(file.id, file.appProperties); }
    const summary = { ...success, status: 'success', deletedFiles: expired.length, phase: 'done' };
    await state(join(config.workDir, 'last-attempt.json'), summary); log(summary);
    return summary;
  } catch (error) {
    // Save only a safe phase summary. Child output, OAuth responses and URIs are never recorded.
    await state(join(config.workDir, 'last-attempt.json'), { ...context, status: 'failed', phase,
      failedAt: now().toISOString(), resumeRequired: resumeFailed }).catch(() => {});
    log({ ...context, status: 'failed', phase, resumeRequired: resumeFailed });
    throw error;
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
    // Resume failure requires operator recovery; prevent another scheduled pause/dump.
    if (!resumeFailed) await rm(lock, { recursive: true, force: true });
  }
}

export async function backupStatus(config, drive, now = new Date()) {
  await drive.validateFolder();
  const files = (await drive.backups()).filter((file) => file.appProperties.state === 'complete');
  files.sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)));
  const latest = files[0];
  if (!latest) throw new Error('No completed backup found for this environment');
  const ageHours = (now.getTime() - Date.parse(latest.createdTime)) / 3600000;
  if (!Number.isFinite(ageHours) || ageHours < -0.25 || ageHours > 30) throw new Error('Latest completed backup is stale or has an invalid timestamp');
  return { environment: config.environment, database: config.database, status: 'recent-backup',
    fileId: latest.id, day: latest.appProperties.day, createdAt: latest.createdTime, ageHours: Math.round(ageHours * 100) / 100 };
}
