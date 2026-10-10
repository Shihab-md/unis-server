import { isAbsolute, resolve } from 'node:path';

export const OWNER = 'unis-mongodb-backup-v1';
export const TARGETS = Object.freeze({
  production: { database: 'unisDB', rootName: 'UNIS' },
  staging: { database: 'unisDB_staging', rootName: 'UNIS-STAGING' },
});
export const TIME_ZONE = 'Asia/Kolkata';
export const RETENTION_DAYS = 10;

export function required(env, name) {
  const value = String(env[name] ?? '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function readKey(env = process.env) {
  const raw = required(env, 'UNIS_BACKUP_ENCRYPTION_KEY');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || key.toString('base64') !== raw) {
    throw new Error('UNIS_BACKUP_ENCRYPTION_KEY must be canonical base64 for 32 random bytes');
  }
  return key;
}

export function validateMongoUri(uri, expectedDatabase) {
  // Require Atlas SRV syntax, explicit database and explicit authSource=admin.
  // Credentials stay in a mode-0600 tool config, never command-line arguments.
  let parsed;
  try { parsed = new URL(uri); } catch { throw new Error('Invalid backup MongoDB URI'); }
  if (parsed.protocol !== 'mongodb+srv:' || !parsed.hostname.endsWith('.mongodb.net') ||
      parsed.port || parsed.hash || decodeURIComponent(parsed.pathname.slice(1)) !== expectedDatabase ||
      parsed.searchParams.get('authSource') !== 'admin') {
    throw new Error('Backup MongoDB URI must target the exact environment database on Atlas with authSource=admin');
  }
  for (const [name, value] of parsed.searchParams) {
    if (['tls', 'ssl'].includes(name.toLowerCase()) && value.toLowerCase() !== 'true') {
      throw new Error('MongoDB TLS cannot be disabled');
    }
    if (['tlsinsecure', 'tlsallowinvalidcertificates', 'tlsallowinvalidhostnames'].includes(name.toLowerCase()) && value.toLowerCase() !== 'false') {
      throw new Error('MongoDB TLS verification cannot be disabled');
    }
  }
}

export function configuration(env = process.env, mode = 'run') {
  const environment = required(env, 'UNIS_BACKUP_ENV');
  const target = TARGETS[environment];
  if (!target) throw new Error('UNIS_BACKUP_ENV must be production or staging');
  const config = {
    ...target, environment,
    rootId: required(env, 'UNIS_BACKUP_DRIVE_ROOT_ID'),
    clientId: required(env, 'UNIS_BACKUP_GOOGLE_CLIENT_ID'),
    clientSecret: required(env, 'UNIS_BACKUP_GOOGLE_CLIENT_SECRET'),
    refreshToken: required(env, 'UNIS_BACKUP_GOOGLE_REFRESH_TOKEN'),
  };
  if (mode === 'init') return config;
  config.folderId = required(env, 'UNIS_BACKUP_DRIVE_FOLDER_ID');
  if (mode === 'status') return config;
  if (env.UNIS_BACKUP_ENABLED !== 'true') throw new Error('UNIS_BACKUP_ENABLED must be true before running a backup');
  config.key = readKey(env);
  config.keyId = required(env, 'UNIS_BACKUP_KEY_ID');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(config.keyId)) throw new Error('Invalid UNIS_BACKUP_KEY_ID');
  config.uri = required(env, 'UNIS_BACKUP_MONGO_URI');
  validateMongoUri(config.uri, target.database);
  config.workDir = required(env, 'UNIS_BACKUP_WORK_DIR');
  config.pauseHook = required(env, 'UNIS_BACKUP_PAUSE_HOOK');
  config.resumeHook = required(env, 'UNIS_BACKUP_RESUME_HOOK');
  config.dumpBinary = required(env, 'UNIS_BACKUP_MONGODUMP');
  for (const name of ['workDir', 'pauseHook', 'resumeHook', 'dumpBinary']) {
    if (!isAbsolute(config[name])) throw new Error(`${name} must be an absolute path`);
    config[name] = resolve(config[name]);
  }
  if (config.workDir === '/') throw new Error('The work directory cannot be the filesystem root');
  return config;
}

export function dayKey(date = new Date()) {
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid backup time');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (name) => parts.find((part) => part.type === name).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function validDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function oldestDay(today) {
  if (!validDay(today)) throw new Error('Invalid retention day');
  return new Date(Date.parse(`${today}T00:00:00Z`) - (RETENTION_DAYS - 1) * 86400000).toISOString().slice(0, 10);
}

export function ownedBackup(file, config) {
  const p = file.appProperties ?? {};
  return !file.trashed && file.mimeType === 'application/octet-stream' &&
    file.parents?.length === 1 && file.parents[0] === config.folderId &&
    p.owner === OWNER && p.environment === config.environment && p.database === config.database &&
    validDay(p.day) && /^[0-9a-f-]{36}$/.test(p.runId ?? '') &&
    /^[0-9a-f]{64}$/.test(p.sha256 ?? '') && ['pending', 'complete'].includes(p.state);
}

export function retentionCandidates(files, config, today, keepId) {
  const current = files.find((file) => file.id === keepId);
  if (!current || !ownedBackup(current, config) || current.appProperties.state !== 'complete' || current.appProperties.day !== today) {
    throw new Error('Retention requires a verified completed backup for today');
  }
  const cutoff = oldestDay(today);
  const keepByDay = new Map([[today, keepId]]);
  const ordered = files.filter((file) => ownedBackup(file, config)).sort((a, b) =>
    String(b.createdTime).localeCompare(String(a.createdTime)) || b.id.localeCompare(a.id));
  for (const file of ordered) {
    const p = file.appProperties;
    if (p.day >= cutoff && p.day <= today && p.state === 'complete' && !keepByDay.has(p.day)) keepByDay.set(p.day, file.id);
  }
  return ordered.filter((file) => {
    const p = file.appProperties;
    if (p.day > today) return false;
    if (p.day < cutoff) return true;
    // Remove duplicates/incomplete replacements only when a complete backup exists for that day.
    return keepByDay.has(p.day) && keepByDay.get(p.day) !== file.id;
  });
}
