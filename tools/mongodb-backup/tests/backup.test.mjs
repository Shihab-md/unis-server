import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { OWNER, configuration, dayKey, oldestDay, ownedBackup, retentionCandidates, validateMongoUri } from '../config.mjs';
import { decryptArchive, digestFile, encryptArchive, verifyArchive } from '../archive.mjs';
import { backupStatus, command, hook, runBackup } from '../worker.mjs';
import { DriveClient } from '../drive.mjs';
import { main } from '../backup.mjs';

const NOW = new Date('2026-10-10T02:00:00Z');
const RUN = '11111111-1111-4111-8111-111111111111';
const HASH = 'a'.repeat(64);
const base = { environment: 'production', database: 'unisDB', rootName: 'UNIS', rootId: 'root', folderId: 'folder' };
function file(id, day, extra = {}) {
  return { id, mimeType: 'application/octet-stream', parents: ['folder'], trashed: false, size: '123',
    createdTime: `${day}T01:00:00Z`, capabilities: { canDelete: true },
    appProperties: { owner: OWNER, environment: 'production', database: 'unisDB', day, runId: RUN, sha256: HASH, state: 'complete' }, ...extra };
}
async function temporary(t) {
  const path = await mkdtemp(join(tmpdir(), 'unis-backup-test-'));
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}

test('configuration strictly separates databases and fails closed before activation', () => {
  const env = { UNIS_BACKUP_ENV: 'production', UNIS_BACKUP_DRIVE_ROOT_ID: 'root', UNIS_BACKUP_DRIVE_FOLDER_ID: 'folder',
    UNIS_BACKUP_GOOGLE_CLIENT_ID: 'id', UNIS_BACKUP_GOOGLE_CLIENT_SECRET: 'secret', UNIS_BACKUP_GOOGLE_REFRESH_TOKEN: 'token',
    UNIS_BACKUP_ENABLED: 'true', UNIS_BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('base64'), UNIS_BACKUP_KEY_ID: 'prod-v1',
    UNIS_BACKUP_MONGO_URI: 'mongodb+srv://u:p@cluster0.example.mongodb.net/unisDB?authSource=admin',
    UNIS_BACKUP_WORK_DIR: '/var/lib/unis-backup/production', UNIS_BACKUP_MONGODUMP: '/usr/bin/mongodump',
    UNIS_BACKUP_PAUSE_HOOK: '/opt/hooks/pause', UNIS_BACKUP_RESUME_HOOK: '/opt/hooks/resume' };
  assert.equal(configuration(env).database, 'unisDB');
  assert.throws(() => configuration({ ...env, UNIS_BACKUP_ENV: 'staging' }), /exact environment database/);
  assert.throws(() => configuration({ ...env, UNIS_BACKUP_ENABLED: 'false' }), /must be true/);
  assert.throws(() => configuration({ ...env, UNIS_BACKUP_PAUSE_HOOK: '' }), /required/);
  assert.throws(() => configuration({ ...env, UNIS_BACKUP_ENCRYPTION_KEY: 'weak' }), /32 random bytes/);
  assert.throws(() => configuration({ ...env, UNIS_BACKUP_WORK_DIR: '/' }), /filesystem root/);
});

test('URI guard rejects implicit DB, wrong DB, disabled TLS and non-Atlas hosts', () => {
  for (const uri of ['mongodb+srv://u:p@cluster0.example.mongodb.net/?authSource=admin',
    'mongodb+srv://u:p@cluster0.example.mongodb.net/unisDB_staging?authSource=admin',
    'mongodb+srv://u:p@cluster0.example.mongodb.net/unisDB',
    'mongodb+srv://u:p@cluster0.example.mongodb.net/unisDB?authSource=admin&tls=false',
    'mongodb+srv://u:p@cluster0.example.mongodb.net/unisDB?authSource=admin&tlsInsecure=true',
    'mongodb+srv://u:p@other.example/unisDB?authSource=admin']) assert.throws(() => validateMongoUri(uri, 'unisDB'));
});

test('calendar date uses India timezone and exact today-plus-nine retention including leap dates', () => {
  assert.equal(dayKey(new Date('2026-10-09T18:29:59Z')), '2026-10-09');
  assert.equal(dayKey(new Date('2026-10-09T18:30:00Z')), '2026-10-10');
  assert.equal(oldestDay('2026-10-10'), '2026-10-01');
  assert.equal(oldestDay('2024-03-01'), '2024-02-21');
});

test('retention removes expired owned backups and same-day duplicates, preserving ten dates', () => {
  const files = Array.from({ length: 12 }, (_, i) => file(`day-${i}`, new Date(Date.parse('2026-10-10T00:00:00Z') - i * 86400000).toISOString().slice(0, 10)));
  files.push(file('old-today', '2026-10-10', { createdTime: '2026-10-10T00:00:00Z' }));
  const remove = retentionCandidates(files, base, '2026-10-10', 'day-0').map((f) => f.id);
  assert.deepEqual(new Set(remove), new Set(['day-10', 'day-11', 'old-today']));
  assert.equal(files.length - remove.length, 10);
});

test('retention never touches other environments, folders, unowned files or future dates', () => {
  const other = file('other-env', '2026-09-01'); other.appProperties.environment = 'staging';
  const moved = file('moved', '2026-09-01', { parents: ['other-folder'] });
  const unowned = file('ordinary-file', '2026-09-01'); delete unowned.appProperties.owner;
  const pending = file('pending-only', '2026-10-08'); pending.appProperties.state = 'pending';
  const files = [file('today', '2026-10-10'), other, moved, unowned, pending, file('future', '2026-10-11')];
  assert.deepEqual(retentionCandidates(files, base, '2026-10-10', 'today'), []);
  assert.throws(() => retentionCandidates(files, base, '2026-10-10', 'missing'), /requires a verified/);
  const incomplete = file('today-pending', '2026-10-10'); incomplete.appProperties.state = 'pending';
  assert.throws(() => retentionCandidates([incomplete], base, '2026-10-10', incomplete.id));
});

test('AES-GCM roundtrip preserves binary BSON-like bytes, Tamil, Arabic, Japanese and long streams exactly', async (t) => {
  const dir = await temporary(t); const key = randomBytes(32);
  const bytes = Buffer.concat([Buffer.from('தமிழ் العربية 日本語 \u0000 A a 75', 'utf8'), randomBytes(4 * 1024 * 1024), Buffer.from([0, 255, 128, 1])]);
  const plain = join(dir, 'archive.gz'); const encrypted = join(dir, 'encrypted'); const decrypted = join(dir, 'decrypted');
  await writeFile(plain, bytes);
  const result = await encryptArchive(plain, encrypted, key, { ...base, day: '2026-10-10', keyId: 'prod-v1' });
  await verifyArchive(encrypted, key, { environment: 'production', database: 'unisDB', keyId: 'prod-v1' });
  await decryptArchive(encrypted, decrypted, key, { database: 'unisDB' });
  assert.deepEqual(await readFile(decrypted), bytes);
  assert.equal(result.hash, (await digestFile(encrypted)).hash);
  assert.equal((await stat(encrypted)).mode & 0o777, 0o600);
  assert.equal((await stat(decrypted)).mode & 0o777, 0o600);
  await assert.rejects(verifyArchive(encrypted, randomBytes(32)));
  await assert.rejects(verifyArchive(encrypted, key, { database: 'unisDB_staging' }), /does not match/);
});

test('tampered header, ciphertext and authentication tag fail; existing decrypt outputs remain intact', async (t) => {
  const dir = await temporary(t); const key = randomBytes(32);
  const plain = join(dir, 'plain'); const encrypted = join(dir, 'cipher'); const existing = join(dir, 'existing');
  await writeFile(plain, Buffer.from('தமிழ் العربية')); await writeFile(existing, 'KEEP');
  await encryptArchive(plain, encrypted, key, { ...base, day: '2026-10-10', keyId: 'v1' });
  await assert.rejects(decryptArchive(encrypted, existing, key), { code: 'EEXIST' });
  assert.equal(await readFile(existing, 'utf8'), 'KEEP');
  await assert.rejects(encryptArchive(plain, existing, key, { ...base, day: '2026-10-10', keyId: 'v1' }), { code: 'EEXIST' });
  assert.equal(await readFile(existing, 'utf8'), 'KEEP');
  const original = await readFile(encrypted);
  for (const position of [20, original.length - 20, original.length - 1]) {
    const modified = Buffer.from(original); modified[position] ^= 1;
    const path = join(dir, `tampered-${position}`); const out = path + '.restore'; await writeFile(path, modified);
    await assert.rejects(decryptArchive(path, out, key));
    await assert.rejects(stat(out), { code: 'ENOENT' });
  }
});

test('operator verification/decryption command runs with recovery credentials only and checks the environment', async (t) => {
  const dir = await temporary(t); const key = randomBytes(32); const plain = join(dir, 'plain'); const encrypted = join(dir, 'cipher');
  const bytes = Buffer.from('தமிழ் العربية 日本語 \u0000', 'utf8'); await writeFile(plain, bytes);
  await encryptArchive(plain, encrypted, key, { environment: 'staging', database: 'unisDB_staging', day: '2026-10-10', keyId: 'staging-v1' });
  const env = { UNIS_BACKUP_ENV: 'staging', UNIS_BACKUP_KEY_ID: 'staging-v1', UNIS_BACKUP_ENCRYPTION_KEY: key.toString('base64') };
  const saved = console.log; const output = []; console.log = (value) => output.push(JSON.parse(value));
  try {
    await main(['verify', encrypted], env); await main(['decrypt', encrypted, join(dir, 'restore')], env);
    await assert.rejects(main(['verify', encrypted], { ...env, UNIS_BACKUP_ENV: 'production' }), /does not match/);
  } finally { console.log = saved; }
  assert.deepEqual(await readFile(join(dir, 'restore')), bytes);
  assert.deepEqual(output.map((entry) => entry.status), ['authenticated', 'decrypted']);
});

async function fixture(t, options = {}) {
  const dir = await temporary(t); const events = []; const files = [];
  const config = { ...base, ...(options.environment === 'staging' ? { environment: 'staging', database: 'unisDB_staging', rootName: 'UNIS-STAGING' } : {}),
    workDir: dir, key: randomBytes(32), keyId: 'prod-v1', uri: 'SECRET-URI',
    pauseHook: process.execPath, resumeHook: process.execPath, dumpBinary: process.execPath };
  const drive = {
    async validateFolder() { events.push('folder-check'); },
    async upload(path, metadata) {
      events.push('upload'); if (options.fail === 'upload') throw new Error('upload failure');
      const entry = file('new', metadata.appProperties.day, { size: String((await stat(path)).size), appProperties: metadata.appProperties,
        createdTime: NOW.toISOString(), name: metadata.name }); files.push(entry); return entry;
    },
    async verifyRemote() { events.push('remote-verify'); if (options.fail === 'verify') throw new Error('checksum mismatch'); },
    async markComplete(id, props) { events.push('complete'); if (options.fail === 'complete') throw new Error('completion failure');
      const entry = files.find((f) => f.id === id); entry.appProperties = { ...props, state: 'complete' }; return entry; },
    async backups() { events.push('list'); return [...files, file('expired', '2026-09-30')]; },
    async removeOwned() { events.push('delete'); if (options.fail === 'delete') throw new Error('delete failure'); },
  };
  const runCommand = async (binary, args) => {
    if (args[0] === '--version') return 'mongodump version: 100.14.1\n';
    events.push('dump'); if (options.fail === 'dump') throw new Error('dump failure');
    assert.equal(args.includes('--db=' + config.database), true);
    assert.equal(args.some((a) => a.includes('SECRET-URI')), false);
    assert.equal(args.includes('--oplog'), false);
    const configFile = args.find((a) => a.startsWith('--config=')).slice(9);
    assert.equal((await stat(configFile)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(configFile, 'utf8')).uri, 'SECRET-URI');
    await writeFile(args.find((a) => a.startsWith('--archive=')).slice(10), Buffer.from('binary \u0000 தமிழ் العربية 日本語'));
    if (options.afterDump) options.afterDump();
  };
  const runHook = async (path, context, action) => {
    events.push(action);
    if (options.fail === action) throw new Error('hook failure');
    if (options.onPause && action === 'pause') await options.onPause();
  };
  return { config, drive, events, files, deps: { now: () => NOW, runCommand, runHook } };
}

test('successful worker resumes before encryption/upload, verifies before completion and prunes last', async (t) => {
  const f = await fixture(t); const result = await runBackup(f.config, f.drive, f.deps);
  assert.equal(result.status, 'success'); assert.equal(result.deletedFiles, 1);
  assert.deepEqual(f.events, ['folder-check', 'pause', 'dump', 'resume', 'folder-check', 'upload', 'remote-verify', 'folder-check', 'complete', 'list', 'delete']);
  assert.deepEqual((await readdir(f.config.workDir)).sort(), ['last-attempt.json', 'last-success.json']);
});

test('staging uses only its own database, archive name and ownership metadata', async (t) => {
  const f = await fixture(t, { environment: 'staging' }); const result = await runBackup(f.config, f.drive, f.deps);
  assert.equal(result.database, 'unisDB_staging');
  assert.equal(result.environment, 'staging');
  assert.equal(f.files[0].name.startsWith('unisDB_staging_'), true);
  assert.equal(f.files[0].appProperties.database, 'unisDB_staging');
  assert.equal(f.files[0].appProperties.environment, 'staging');
  assert.equal(f.events.includes('delete'), false); // Fake expired production object must be preserved.
});

test('preflight folder failure never pauses writers or uploads', async (t) => {
  const f = await fixture(t); f.drive.validateFolder = async () => { throw new Error('Invalid environment backup folder'); };
  await assert.rejects(runBackup(f.config, f.drive, f.deps));
  assert.deepEqual(f.events, []);
});

test('local authentication failure resumes writers and never uploads or prunes', async (t) => {
  const f = await fixture(t);
  await assert.rejects(runBackup(f.config, f.drive, { ...f.deps, verify: async () => { throw new Error('authentication failed'); } }));
  assert.equal(f.events.includes('resume'), true); assert.equal(f.events.includes('upload'), false);
});

for (const fail of ['pause', 'dump', 'upload', 'verify', 'complete']) {
  test(`failure at ${fail} preserves previous backups and always resumes an attempted pause`, async (t) => {
    const f = await fixture(t, { fail }); await assert.rejects(runBackup(f.config, f.drive, f.deps));
    assert.equal(f.events.includes('resume'), true); assert.equal(f.events.includes('delete'), false);
    const status = JSON.parse(await readFile(join(f.config.workDir, 'last-attempt.json'), 'utf8'));
    assert.equal(status.status, 'failed'); assert.equal(status.resumeRequired, false);
    assert.deepEqual(await readdir(f.config.workDir), ['last-attempt.json']);
  });
}

test('resume failure retains the lock, stops uploads and records required recovery', async (t) => {
  const f = await fixture(t, { fail: 'resume' }); await assert.rejects(runBackup(f.config, f.drive, f.deps), /RESUME FAILED/);
  assert.equal(f.events.includes('upload'), false);
  assert.equal(JSON.parse(await readFile(join(f.config.workDir, 'last-attempt.json'), 'utf8')).resumeRequired, true);
  assert.deepEqual((await readdir(f.config.workDir)).sort(), ['backup.lock', 'last-attempt.json']);
});

test('retention failure records failure but keeps the newly completed backup and last-success', async (t) => {
  const f = await fixture(t, { fail: 'delete' }); await assert.rejects(runBackup(f.config, f.drive, f.deps));
  assert.equal(f.files[0].appProperties.state, 'complete');
  assert.equal(JSON.parse(await readFile(join(f.config.workDir, 'last-success.json'), 'utf8')).fileId, 'new');
  assert.equal(JSON.parse(await readFile(join(f.config.workDir, 'last-attempt.json'), 'utf8')).phase, 'retention');
});

test('concurrent run is blocked without touching its active lock or resuming its writers', async (t) => {
  let enter; const entered = new Promise((resolve) => { enter = resolve; });
  let release; const paused = new Promise((resolve) => { release = resolve; });
  const f = await fixture(t, { onPause: async () => { enter(); await paused; } });
  const first = runBackup(f.config, f.drive, f.deps); await entered;
  await assert.rejects(runBackup(f.config, f.drive, f.deps), /lock exists/);
  assert.equal(f.events.filter((e) => e === 'pause').length, 1);
  assert.equal(f.events.includes('resume'), false); release(); await first;
});

test('shutdown after dump still resumes, then stops before upload or retention', async (t) => {
  const controller = new AbortController();
  const f = await fixture(t, { afterDump: () => controller.abort() });
  await assert.rejects(runBackup(f.config, f.drive, { ...f.deps, signal: controller.signal }), /interrupted/);
  assert.equal(f.events.includes('resume'), true); assert.equal(f.events.includes('upload'), false);
});

test('private work directory rejects unsafe permissions', async (t) => {
  const f = await fixture(t); const unsafe = join(f.config.workDir, 'unsafe'); await mkdir(unsafe, { mode: 0o755 });
  await assert.rejects(runBackup({ ...f.config, workDir: unsafe }, f.drive, f.deps), /mode 0700/);
  assert.deepEqual(f.events, []);
});

test('hook acknowledgements bind environment, database, run and drained state', async (t) => {
  const dir = await temporary(t); const script = join(dir, 'hook');
  await writeFile(script, '#!/usr/bin/env node\nlet s="";for await(const x of process.stdin)s+=x;const c=JSON.parse(s);console.log(JSON.stringify({...c,paused:true,drained:false,resumed:true}));\n', { mode: 0o700 });
  const context = { environment: 'production', database: 'unisDB', runId: RUN };
  await assert.rejects(hook(script, context, 'pause'), /did not confirm/);
  await hook(script, context, 'resume');
});

test('real child failure and abort are redacted and terminate promptly', async () => {
  await assert.rejects(command(process.execPath, ['-e', 'console.error("SECRET");process.exit(1)']), (e) => !e.message.includes('SECRET'));
  const controller = new AbortController();
  const child = command(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal });
  controller.abort(); await assert.rejects(child, /interrupted/);
});

test('status uses Drive independently and fails for missing or stale completed backups', async () => {
  const drive = { async validateFolder() {}, async backups() { return [file('recent', '2026-10-10')]; } };
  assert.equal((await backupStatus(base, drive, NOW)).fileId, 'recent');
  await assert.rejects(backupStatus(base, drive, new Date('2026-10-12T00:00:00Z')), /stale/);
  await assert.rejects(backupStatus(base, { ...drive, async backups() { return []; } }, NOW), /No completed/);
});

function httpClient(config, handler) {
  const client = new DriveClient(config, { sleep: async () => {}, fetchImpl: async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'FAKE', expires_in: 3600 });
    return handler(url, options);
  } }); return client;
}

test('Drive listing follows pagination and rejects incomplete searches', async () => {
  let pages = 0;
  const client = httpClient(base, async (url) => {
    pages++; return Response.json(pages === 1 ? { files: [file('a', '2026-10-10')], nextPageToken: 'NEXT' } :
      { files: [file('b', '2026-10-09')] });
  });
  assert.equal((await client.backups()).length, 2); assert.equal(pages, 2);
  const incomplete = httpClient(base, async () => Response.json({ incompleteSearch: true, files: [] }));
  await assert.rejects(incomplete.backups(), /incomplete/);
});

test('Drive guard verifies root name, folder owner and entire environment hierarchy', async () => {
  const folders = { root: { id: 'root', name: 'UNIS', mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true } },
    parent: { id: 'parent', name: 'Backups', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] },
    folder: { id: 'folder', name: 'MongoDB', mimeType: 'application/vnd.google-apps.folder', parents: ['parent'], capabilities: { canAddChildren: true },
      appProperties: { owner: OWNER, environment: 'production', database: 'unisDB', role: 'archive-folder' } } };
  const client = httpClient(base, async (url) => Response.json(folders[new URL(url).pathname.split('/').pop()]));
  await client.validateFolder(); folders.root.name = 'UNIS-STAGING'; await assert.rejects(client.validateFolder(), /does not match/);
  folders.root.name = 'UNIS'; folders.parent.parents = ['other-root']; await assert.rejects(client.validateFolder(), /outside/);
});

test('Drive resumable upload recovers an ambiguous chunk using acknowledged server offset', async (t) => {
  const dir = await temporary(t); const path = join(dir, 'cipher'); const bytes = randomBytes(3 * 1024 * 1024 + 11); await writeFile(path, bytes);
  let received = Buffer.alloc(0); let queries = 0; let interrupted = false;
  const metadata = file('RESERVED', '2026-10-10', { size: String(bytes.length) });
  const client = httpClient(base, async (url, options) => {
    if (url.includes('generateIds')) return Response.json({ ids: ['RESERVED'] });
    if (options.method === 'POST') return new Response(null, { status: 200, headers: { Location: 'https://www.googleapis.com/upload/session' } });
    const range = options.headers['Content-Range'];
    if (range.startsWith('bytes */')) { queries++; return new Response(null, { status: 308, headers: { Range: `bytes=0-${received.length - 1}` } }); }
    const start = Number(range.match(/^bytes (\d+)-/)[1]); assert.equal(start, received.length);
    received = Buffer.concat([received, options.body]);
    if (!interrupted) { interrupted = true; throw new Error('connection lost after accepted bytes'); }
    if (received.length === bytes.length) return Response.json(metadata);
    return new Response(null, { status: 308, headers: { Range: `bytes=0-${received.length - 1}` } });
  });
  assert.equal((await client.upload(path, { appProperties: metadata.appProperties })).id, 'RESERVED');
  assert.deepEqual(received, bytes); assert.equal(queries, 1);
});

test('Drive remote verification hashes the downloaded bytes and rejects corruption', async () => {
  const bytes = Buffer.from('encrypted data'); const expectedHash = createHash('sha256').update(bytes).digest('hex');
  const metadata = file('id', '2026-10-10', { size: String(bytes.length) }); metadata.appProperties.sha256 = expectedHash;
  let corrupt = false;
  const client = httpClient(base, async (url) => url.includes('alt=media') ? new Response(corrupt ? Buffer.from('corrupt') : bytes) : Response.json(metadata));
  await client.verifyRemote('id', expectedHash, bytes.length, RUN); corrupt = true;
  await assert.rejects(client.verifyRemote('id', expectedHash, bytes.length, RUN), /checksum/);
  await assert.rejects(client.verifyRemote('id', expectedHash, bytes.length, RUN, { day: '2026-10-09' }), /metadata/);
});

test('Drive refreshes a rejected token once, retries transient failures and never follows another host', async () => {
  let tokens = 0; let calls = 0;
  const client = new DriveClient(base, { sleep: async () => {}, fetchImpl: async (url) => {
    if (url === 'https://oauth2.googleapis.com/token') { tokens++; return Response.json({ access_token: `TOKEN-${tokens}`, expires_in: 3600 }); }
    calls++; if (calls === 1) return new Response(null, { status: 401 });
    if (calls === 2) return new Response(null, { status: 503 });
    return Response.json({ id: 'ok' });
  } });
  assert.equal((await client.get('ok')).id, 'ok'); assert.equal(tokens, 2); assert.equal(calls, 3);
  await assert.rejects(client.request('https://other.example/upload'), /Unexpected Drive API host/);
});

test('invalid resumable Range acknowledgement fails rather than skipping bytes', async (t) => {
  const dir = await temporary(t); const path = join(dir, 'cipher'); await writeFile(path, randomBytes(99));
  const client = httpClient(base, async (url, options) => {
    if (url.includes('generateIds')) return Response.json({ ids: ['RESERVED'] });
    if (options.method === 'POST') return new Response(null, { status: 200, headers: { Location: 'https://www.googleapis.com/upload/session' } });
    return new Response(null, { status: 308, headers: { Range: 'bytes=0-10000' } });
  });
  await assert.rejects(client.upload(path, {}), /Invalid Drive resumable upload range/);
});

test('Drive deletion rechecks file ownership and properties, allowing reordered JSON only', async () => {
  const entry = file('id', '2026-09-01'); let deletes = 0;
  const client = httpClient(base, async (url, options) => {
    if (options.method === 'DELETE') { deletes++; return new Response(null, { status: 204 }); }
    return Response.json(entry);
  }); client.validateFolder = async () => {};
  const reordered = Object.fromEntries(Object.entries(entry.appProperties).reverse());
  await client.removeOwned('id', reordered); assert.equal(deletes, 1);
  entry.parents = ['other-folder']; await assert.rejects(client.removeOwned('id', reordered), /changed before/);
  assert.equal(deletes, 1);
});
