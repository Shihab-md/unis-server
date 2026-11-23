import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import mongoose from "mongoose";
import express from "express";
import jwt from "jsonwebtoken";
import { BackupError, encodeBackup, decodeBackup, readBackupKey, sha256, validateCollectionName } from "../../../utils/databaseBackupArchive.js";
import { captureDatabaseSnapshot } from "../../../services/databaseBackupSnapshotService.js";
import { createBackupGuard, runManualBackup, indiaBackupDate, getBackupContext, requireBackupConfiguration } from "../../../services/databaseBackupService.js";
import { resolveBackupFolder, retentionCandidates, uploadResumableArchive } from "../../../services/databaseBackupDriveService.js";
import router from "../../../routes/databaseBackupRoutes.js";
import User from "../../../models/User.js";
import Employee from "../../../models/Employee.js";
import AuditLog from "../../../models/AuditLog.js";

const BSON = mongoose.mongo.BSON;
const key = randomBytes(32);
const context = { environment: "production", database: "unisDB", rootName: "UNIS", keyId: "test-key", configuredRootId: "root" };
const rawDocument = BSON.serialize({
  _id: new BSON.ObjectId(), text: "தமிழ் العربية हिन्दी", date: new Date("2026-10-10T00:00:00.000Z"),
  int: new BSON.Int32(5), double: new BSON.Double(5), long: BSON.Long.fromString("9007199254740993"),
  decimal: BSON.Decimal128.fromString("12345.6700"), bin: new BSON.Binary(Buffer.from([0, 255, 12]), 128),
  bool: true, array: [null, "A", new BSON.Int32(9)], timestamp: new BSON.Timestamp({ t: 7, i: 8 }),
});
const snapshot = (requestId = randomUUID()) => ({
  ...context, requestId, backupDate: "2026-10-10", startedAt: "2026-10-10T01:00:00Z",
  snapshotTime: { $timestamp: { t: 1791594000, i: 1 } },
  collections: [{ name: "students", metadata: { options: {}, indexes: [{ name: "_id_", key: { _id: 1 }, v: 2 }] }, data: rawDocument, documentCount: 1 },
    { name: "empty_collection", metadata: { options: {}, indexes: [] }, data: Buffer.alloc(0), documentCount: 0 }],
});

class FakeRedis {
  values = new Map();
  async set(name, value, options) { this.options = options; if (this.values.has(name)) return null; this.values.set(name, value); return "OK"; }
  async get(name) { return this.values.get(name) ?? null; }
  async eval(script, { keys, arguments: args }) { if (this.values.get(keys[0]) === args[0]) { this.values.delete(keys[0]); return 1; } return 0; }
}

class FakeDrive {
  rows = new Map(); blobs = new Map(); deleted = []; calls = []; count = 0;
  constructor() {
    this.uploadClient = { request: async (params) => {
      if (this.fail === "create") throw new Error("Simulated upload failure");
      if (params.method === "POST") {
        this.uploadMetadata = params.data; this.uploadChunks = [];
        return { status: 200, headers: { location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=test" } };
      }
      this.uploadChunks.push(params.data);
      const [, , end, total] = params.headers["Content-Range"].match(/bytes (\d+)-(\d+)\/(\d+)/);
      if (Number(end) + 1 < Number(total)) return { status: 308, headers: { range: `bytes=0-${end}` } };
      const created = await this.create({ requestBody: this.uploadMetadata, media: { body: Readable.from(this.uploadChunks) } });
      return { status: 200, ...created };
    } };
    this.add({ id: "root", name: "UNIS", mimeType: "application/vnd.google-apps.folder", parents: ["drive-root"] });
    this.add({ id: "backups", name: "Backups", mimeType: "application/vnd.google-apps.folder", parents: ["root"] });
    this.add({ id: "mongodb", name: "MongoDB", mimeType: "application/vnd.google-apps.folder", parents: ["backups"] });
    this.files = Object.fromEntries(["get", "list", "create", "generateIds", "update", "delete"].map((name) => [name, async (params) => {
      this.calls.push(name);
      if (this.fail === name) throw new Error("Simulated API failure");
      if (this.onCall) await this.onCall(name, params);
      return this[name](params);
    }]));
  }
  add(file) { this.rows.set(file.id, { trashed: false, size: "0", createdTime: "2026-10-10T01:00:00Z", ...file }); }
  get(params) {
    const file = this.rows.get(params.fileId);
    if (!file) throw new Error("Not found");
    if (params.alt === "media") {
      const bytes = this.blobs.get(params.fileId);
      return { data: this.downloadStream ? this.downloadStream(bytes) : Readable.from([this.corrupt ? Buffer.from("wrong bytes") : bytes]) };
    }
    return { data: structuredClone(file) };
  }
  list(params) {
    const parent = params.q.match(/'([^']+)' in parents/)?.[1];
    const name = params.q.match(/ and name = '([^']+)'/)?.[1];
    const rows = [...this.rows.values()].filter((file) => !file.trashed && (!parent || file.parents?.includes(parent)) &&
      (!name || file.name === name) && (!params.q.includes("mimeType =") || file.mimeType === "application/vnd.google-apps.folder") &&
      (!params.q.includes("unisBackup") || file.appProperties?.unisBackup === "manual-v1"));
    return { data: { files: rows.map((r) => structuredClone(r)) } };
  }
  async create(params) {
    const file = { id: `folder-${++this.count}`, ...params.requestBody, createdTime: "2026-10-10T12:00:00Z" };
    if (params.media) {
      const chunks = [];
      for await (const chunk of params.media.body) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      file.size = String(bytes.length);
      file.sha256Checksum = sha256(bytes);
      this.blobs.set(file.id, bytes);
    }
    this.add(file);
    return this.get({ fileId: file.id });
  }
  generateIds() { return { data: { ids: [`archive-${++this.count}`] } }; }
  update(params) { Object.assign(this.rows.get(params.fileId), structuredClone(params.requestBody)); return this.get(params); }
  delete(params) { this.deleted.push(params.fileId); this.rows.delete(params.fileId); this.blobs.delete(params.fileId); return { data: {} }; }
  old(id, date, overrides = {}) {
    this.add({ id, name: `${id}.unisbackup`, mimeType: "application/octet-stream", parents: ["mongodb"],
      appProperties: { unisBackup: "manual-v1", environment: "production", database: "unisDB", rootId: "root",
        requestId: randomUUID(), backupDate: date, status: "complete", sha256: "old-checksum", keyId: "test-key", ...overrides } });
  }
}

async function run(options = {}) {
  const drive = options.drive || new FakeDrive();
  const redis = options.redis || new FakeRedis();
  const guard = createBackupGuard(options.seconds || 10);
  if (options.startedAt) guard.startedAt = options.startedAt;
  let captured = 0;
  try {
    const result = await runManualBackup({ context: options.context || context, drive, uploadClient: drive.uploadClient, redis, guard, key,
      requestId: options.requestId || randomUUID(),
      capture: options.capture || (async (args) => { captured += 1; return { ...snapshot(args.requestId), backupDate: args.backupDate }; }),
    });
    return { result, drive, redis, captured };
  } finally { guard.close(); }
}

test("archive round-trip retains raw BSON bytes and all BSON types", async () => {
  const original = snapshot();
  const bytes = await encodeBackup(original, key);
  const recovered = await decodeBackup(bytes, key);
  assert.deepEqual(recovered.collections[0].data, rawDocument);
  assert.equal(recovered.collections[1].documentCount, 0);
  const decoded = BSON.deserialize(recovered.collections[0].data, { promoteValues: false, promoteLongs: false });
  assert.equal(decoded.text, "தமிழ் العربية हिन्दी");
  assert.equal(decoded.long.toString(), "9007199254740993");
  assert.equal(decoded.decimal.toString(), "12345.6700");
  assert.equal(decoded.int._bsontype, "Int32");
  assert.equal(decoded.double._bsontype, "Double");
  assert.equal(decoded.bin.sub_type, 128);
  assert.equal(decoded.date.toISOString(), "2026-10-10T00:00:00.000Z");
});
test("backup encryption uses a fresh IV and hides multilingual plaintext", async () => {
  const a = await encodeBackup(snapshot(), key); const b = await encodeBackup(snapshot(), key);
  assert.notDeepEqual(a.subarray(8, 20), b.subarray(8, 20));
  assert.equal(a.includes(Buffer.from("தமிழ்")), false);
});
test("wrong encryption key is rejected", async () => { await assert.rejects(decodeBackup(await encodeBackup(snapshot(), key), randomBytes(32))); });
test("tampered ciphertext is rejected", async () => { const a = await encodeBackup(snapshot(), key); a[a.length - 1] ^= 1; await assert.rejects(decodeBackup(a, key)); });
test("truncated archive is rejected", async () => { const a = await encodeBackup(snapshot(), key); await assert.rejects(decodeBackup(a.subarray(0, 30), key)); });
test("invalid document count is rejected", async () => { const s = snapshot(); s.collections[0].documentCount = 2; await assert.rejects(decodeBackup(await encodeBackup(s, key), key), /count/); });
test("invalid BSON framing is rejected", async () => { const s = snapshot(); s.collections[0].data = Buffer.from(rawDocument); s.collections[0].data.writeInt32LE(4); await assert.rejects(decodeBackup(await encodeBackup(s, key), key), /framing/); });
test("namespace traversal and ambiguous collection filenames are rejected", () => { for (const value of ["../students", "bad\\name", "..", "percent%2f", "nul\u0000name"]) assert.throws(() => validateCollectionName(value)); });
test("key must be canonical base64 containing exactly 32 bytes", () => { assert.deepEqual(readBackupKey(key.toString("base64")), key); for (const value of ["", "secret", randomBytes(16).toString("base64"), key.toString("hex")]) assert.throws(() => readBackupKey(value)); });

function fakeMongo({ changeCatalog = false, failRead = false, noSnapshot = false, objectRead = false, view = false, manyDocuments = 1 } = {}) {
  const state = { ended: false, closed: 0, reads: [], catalogReads: 0 };
  const session = { snapshotTime: noSnapshot ? undefined : new BSON.Timestamp({ t: 123, i: 1 }), endSession: async () => { state.ended = true; } };
  const client = { startSession: (options) => { assert.equal(options.snapshot, true); assert.equal(options.causalConsistency, false); return session; } };
  const db = {
    listCollections: () => ({ toArray: async () => {
      state.catalogReads += 1;
      return [{ name: "students", type: view ? "view" : "collection", options: {}, info: { uuid: new BSON.Binary(Buffer.alloc(16, changeCatalog && state.catalogReads > 1 ? 2 : 1), 4) } },
        { name: "unregistered_collection", type: "collection", options: {}, info: { uuid: new BSON.Binary(Buffer.alloc(16, 3), 4) } }];
    } }),
    collection: (name) => ({
      listIndexes: () => ({ toArray: async () => [{ name: "_id_", key: { _id: 1 }, v: 2 }] }),
      find: (filter, options) => {
        state.reads.push({ name, filter, options });
        let yielded = 0;
        const document = manyDocuments > 1 ? BSON.serialize({ text: "X".repeat(1024 * 1024) }) : rawDocument;
        return { next: async () => { if (failRead) throw new Error("SnapshotTooOld"); if (yielded++ >= manyDocuments) return null; return objectRead ? { fake: true } : document; }, close: async () => { state.closed += 1; } };
      },
    }),
  };
  return { state, session, client, db };
}
async function captureMongo(options) {
  const mongo = fakeMongo(options); const guard = createBackupGuard(10);
  try { const data = await captureDatabaseSnapshot({ ...mongo, BSON, context, requestId: randomUUID(), backupDate: "2026-10-10", guard }); return { data, ...mongo }; }
  finally { guard.close(); }
}
test("one snapshot session covers every discovered collection, including unregistered collections", async () => {
  const { data, state, session } = await captureMongo({});
  assert.equal(data.collections.length, 2); assert.equal(state.catalogReads, 2); assert.equal(state.ended, true);
  for (const { options } of state.reads) { assert.equal(options.session, session); assert.equal(options.raw, true); assert.equal(options.readPreference, "primary"); assert.equal(options.readConcern.level, "snapshot"); }
});
test("collection drop/recreate during backup causes rejection", async () => { await assert.rejects(captureMongo({ changeCatalog: true }), /definitions changed/); });
test("ordinary JSON cursor output is rejected rather than silently changing BSON types", async () => { await assert.rejects(captureMongo({ objectRead: true }), /raw BSON/); });
test("backup is rejected if the driver did not establish a snapshot", async () => { await assert.rejects(captureMongo({ noSnapshot: true }), /shared snapshot/); });
test("snapshot read failure closes cursor and session", async () => {
  const mongo = fakeMongo({ failRead: true }); const guard = createBackupGuard(10);
  try { await assert.rejects(captureDatabaseSnapshot({ ...mongo, BSON, context, requestId: randomUUID(), backupDate: "2026-10-10", guard })); assert.equal(mongo.state.closed, 1); assert.equal(mongo.state.ended, true); }
  finally { guard.close(); }
});
test("unsupported views cause complete failure, not an incomplete backup", async () => { await assert.rejects(captureMongo({ view: true }), /ordinary collections/); });
test("raw BSON limit rejects a growing database before compression or upload", async () => { await assert.rejects(captureMongo({ manyDocuments: 65 }), /64 MiB/); });

test("normal upload is encrypted, verified, marked complete and releases the shared lock", async () => {
  const { result, drive, redis } = await run();
  assert.equal(result.backup.status, "complete"); assert.equal(result.backup.collections, 2);
  assert.equal(result.backup.sha256, sha256(drive.blobs.get(result.backup.id)));
  assert.equal(redis.values.size, 0); assert.deepEqual(redis.options, { NX: true, EX: 600 });
});
test("corrupted Drive download leaves upload pending and keeps all older backups", async () => {
  const drive = new FakeDrive(); drive.corrupt = true; drive.old("old", "2026-01-01");
  await assert.rejects(run({ drive })); assert.deepEqual(drive.deleted, []);
  assert.equal([...drive.rows.values()].some((r) => r.appProperties?.status === "pending"), true);
});
test("failed upload never triggers retention", async () => { const drive = new FakeDrive(); drive.fail = "create"; drive.old("old", "2026-01-01"); await assert.rejects(run({ drive })); assert.deepEqual(drive.deleted, []); });
test("snapshot failure never uploads or deletes older backups", async () => {
  const drive = new FakeDrive(); drive.old("old", "2026-01-01"); await assert.rejects(run({ drive, capture: async () => { throw new Error("failed"); } }));
  assert.equal(drive.calls.includes("create"), false); assert.deepEqual(drive.deleted, []);
});
test("retention keeps ten calendar dates including the current date and replaces same-day duplicates", () => {
  const drive = new FakeDrive();
  for (let day = 1; day <= 10; day++) drive.old(`day-${day}`, `2026-10-${String(day).padStart(2, "0")}`);
  drive.old("too-old", "2026-09-30"); drive.old("pending", "2026-09-01", { status: "pending" }); drive.old("future", "2026-10-11");
  drive.old("today-old", "2026-10-10"); drive.old("current", "2026-10-10");
  const removed = retentionCandidates([...drive.rows.values()].filter((r) => r.appProperties), "2026-10-10", "current").map((r) => r.id);
  assert.deepEqual(new Set(removed), new Set(["too-old", "today-old", "day-10"]));
});
test("India retention date handles the UTC day boundary", () => { assert.equal(indiaBackupDate(new Date("2026-10-10T18:29:59Z")), "2026-10-10"); assert.equal(indiaBackupDate(new Date("2026-10-10T18:30:00Z")), "2026-10-11"); });
test("retention deletes only owned backup files in the selected environment", async () => {
  const drive = new FakeDrive(); drive.old("old", "2026-01-01"); drive.old("staging", "2026-01-01", { environment: "staging", database: "unisDB_staging" }); drive.old("foreign", "2026-01-01", { unisBackup: "other-app" });
  drive.old("foreign-root", "2026-01-01", { rootId: "another-root" });
  const { result } = await run({ drive }); assert.equal(result.backup.status, "complete"); assert.deepEqual(drive.deleted, ["old"]);
  for (const id of ["staging", "foreign", "foreign-root"]) assert.equal(drive.rows.has(id), true);
});
test("cleanup failure reports a warning while keeping verified success", async () => {
  const drive = new FakeDrive(); drive.old("old", "2026-01-01"); drive.fail = "delete";
  const { result } = await run({ drive }); assert.equal(result.backup.status, "complete"); assert.equal(result.warnings.length, 1); assert.equal(drive.rows.has("old"), true);
});
test("production refuses a staging root folder", async () => { const drive = new FakeDrive(); drive.rows.get("root").name = "UNIS-STAGING"; await assert.rejects(run({ drive }), /environment/); assert.deepEqual(drive.deleted, []); });
test("staging refuses a copied production root ID", async () => { await assert.rejects(run({ context: { ...context, environment: "staging", database: "unisDB_staging", rootName: "UNIS-STAGING" } }), /environment/); });
test("duplicate root folders are refused instead of choosing an arbitrary folder", async () => {
  const drive = new FakeDrive(); drive.add({ id: "duplicate", name: "UNIS", mimeType: "application/vnd.google-apps.folder" }); const guard = createBackupGuard(10);
  try { await assert.rejects(resolveBackupFolder(drive, { ...context, configuredRootId: "" }, guard), /Duplicate/); } finally { guard.close(); }
});
test("a folder moved to a different root before cleanup stops deletion", async () => {
  const drive = new FakeDrive(); drive.old("old", "2026-01-01");
  drive.onCall = (name, params) => { if (name === "update" && params.requestBody.appProperties.status === "complete") drive.rows.get("backups").parents = ["other-root"]; };
  const { result } = await run({ drive }); assert.equal(result.warnings.length, 1); assert.deepEqual(drive.deleted, []);
});
test("a busy distributed lock prevents capture and upload", async () => {
  const redis = new FakeRedis(); redis.values.set("unis:database-backup:production:unisDB:lock", "another-owner"); const drive = new FakeDrive();
  await assert.rejects(run({ redis, drive }), (e) => e.status === 409); assert.equal(drive.calls.length, 0); assert.equal(redis.values.size, 1);
});
test("lost lock stops upload and cannot delete the replacement owner's lock", async () => {
  const redis = new FakeRedis(); const drive = new FakeDrive();
  await assert.rejects(run({ redis, drive, capture: async (args) => { redis.values.set("unis:database-backup:production:unisDB:lock", "new-owner"); return snapshot(args.requestId); } }), /lock was lost/);
  assert.equal(redis.values.get("unis:database-backup:production:unisDB:lock"), "new-owner"); assert.equal(drive.calls.includes("create"), false);
});
test("repeating a completed request does not create another backup", async () => {
  const requestId = randomUUID(); const drive = new FakeDrive(); const first = await run({ drive, requestId });
  const second = await run({ drive, requestId }); assert.equal(second.result.reused, true); assert.equal(second.captured, 0); assert.equal(second.result.backup.id, first.result.backup.id);
});
test("repeating a pending upload does not create a duplicate", async () => {
  const requestId = randomUUID(); const drive = new FakeDrive(); drive.old("pending", "2026-10-10", { requestId, status: "pending" });
  await assert.rejects(run({ drive, requestId }), /unverified upload/); assert.equal(drive.calls.includes("create"), false); assert.deepEqual(drive.deleted, []);
});
test("failed download verification never marks a backup complete", async () => {
  const drive = new FakeDrive(); drive.downloadStream = () => Readable.from((async function* () { throw new Error("disconnected"); })());
  await assert.rejects(run({ drive })); assert.equal(drive.calls.includes("update"), false); assert.deepEqual(drive.deleted, []);
});
test("large archives use acknowledged 4 MiB chunks and a smaller final chunk", async () => {
  const drive = new FakeDrive(); const guard = createBackupGuard(10); const bytes = Buffer.alloc(4 * 1024 * 1024 + 73, 7);
  try {
    const file = await uploadResumableArchive({ uploadClient: drive.uploadClient, metadata: { id: "chunk-test", parents: ["mongodb"] }, archive: bytes, guard });
    assert.equal(file.id, "chunk-test"); assert.deepEqual(drive.uploadChunks.map((c) => c.length), [4 * 1024 * 1024, 73]);
    assert.deepEqual(drive.blobs.get(file.id), bytes);
  } finally { guard.close(); }
});
test("unacknowledged intermediate upload chunk is not treated as sent", async () => {
  const guard = createBackupGuard(10); let requests = 0;
  const uploadClient = { request: async () => ++requests === 1 ? { headers: { location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=test" } } : { status: 308, headers: { range: "bytes=0-4" } } };
  try { await assert.rejects(uploadResumableArchive({ uploadClient, metadata: { id: "test" }, archive: Buffer.alloc(4 * 1024 * 1024 + 1), guard }), /acknowledge/); assert.equal(requests, 2); }
  finally { guard.close(); }
});
test("unexpected upload session host is rejected", async () => {
  const guard = createBackupGuard(10); const uploadClient = { request: async () => ({ headers: { location: "https://example.com/upload/drive/v3/files" } }) };
  try { await assert.rejects(uploadResumableArchive({ uploadClient, metadata: { id: "test" }, archive: Buffer.from("archive"), guard }), /Unexpected/); }
  finally { guard.close(); }
});
test("deadline interrupts network waits and blocks subsequent operations", async () => {
  const guard = createBackupGuard(0.03);
  try { await assert.rejects(guard.run(new Promise((_, reject) => setTimeout(() => reject(new Error("late")), 70))), (e) => e.status === 504); assert.throws(() => guard.options(), /time limit/); }
  finally { guard.close(); }
});
test("encryption setup is optional for normal app startup but mandatory for backup", () => {
  const previous = { ...process.env };
  try {
    delete process.env.DATABASE_BACKUP_ENABLED; assert.throws(() => requireBackupConfiguration(context), /not enabled/);
    process.env.DATABASE_BACKUP_ENABLED = "true"; process.env.DATABASE_BACKUP_ENCRYPTION_KEY = key.toString("base64");
    assert.deepEqual(requireBackupConfiguration(context), key);
    assert.throws(() => requireBackupConfiguration({ ...context, keyId: "bad value" }), /identifier/);
  } finally { process.env = previous; }
});
test("environment and actual connected database must match exactly", () => {
  const previous = { ...process.env }; const oldDb = mongoose.connection.db;
  try {
    process.env.APP_ENV = "staging"; process.env.MONGODB_URL = "mongodb://localhost/unisDB";
    mongoose.connection.db = { databaseName: "unisDB" }; assert.throws(getBackupContext, /does not match/);
    process.env.MONGODB_URL = "mongodb://localhost/unisDB_staging"; mongoose.connection.db = { databaseName: "unisDB_staging" };
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME = "UNIS-STAGING"; assert.equal(getBackupContext().database, "unisDB_staging");
  } finally { mongoose.connection.db = oldDb; process.env = previous; }
});

test("real Express router enforces authentication and Super Admin before auditing or backup access", async () => {
  const prior = { secret: process.env.JWT_SECRET, findUser: User.findById, findEmployee: Employee.findOne, audit: AuditLog.create };
  let auditCount = 0; let currentRole = "guest";
  User.findById = () => ({ select: async () => ({ _id: "507f1f77bcf86cd799439011", role: currentRole }) });
  Employee.findOne = () => ({ select: () => ({ lean: async () => ({ _id: "employee", organizationType: "HQ" }) }) });
  AuditLog.create = async () => { auditCount += 1; };
  process.env.JWT_SECRET = "unit-test-secret-never-use-in-production";
  const app = express(); app.use(express.json()); app.use("/api/database-backup", router);
  const server = await new Promise((ready) => { const instance = app.listen(0, "127.0.0.1", () => ready(instance)); });
  const base = `http://127.0.0.1:${server.address().port}/api/database-backup`;
  try {
    assert.equal((await fetch(`${base}/status`)).status, 401);
    assert.equal((await fetch(`${base}/now`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
    for (const role of ["guest", "admin", "hqadmin", "hquser", "accountant", "teacher", "supervisor", "student"]) {
      currentRole = role; const token = jwt.sign({ _id: "507f1f77bcf86cd799439011", role }, process.env.JWT_SECRET);
      for (const [path, method] of [["status", "GET"], ["now", "POST"]]) {
        const res = await fetch(`${base}/${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) });
        assert.equal(res.status, 403, role);
      }
    }
    assert.equal(auditCount, 0);
    currentRole = "admin"; const stale = jwt.sign({ _id: "507f1f77bcf86cd799439011", role: "superadmin" }, process.env.JWT_SECRET);
    assert.equal((await fetch(`${base}/status`, { headers: { Authorization: `Bearer ${stale}` } })).status, 401);
    currentRole = "superadmin"; const token = jwt.sign({ _id: "507f1f77bcf86cd799439011", role: currentRole }, process.env.JWT_SECRET);
    for (const body of [{ requestId: randomUUID(), database: "unisDB_staging" }, { requestId: "wrong" }]) {
      const res = await fetch(`${base}/now`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      assert.equal(res.status, 400);
    }
    assert.equal(auditCount, 2);
  } finally {
    await new Promise((done) => server.close(done));
    User.findById = prior.findUser; Employee.findOne = prior.findEmployee; AuditLog.create = prior.audit;
    if (prior.secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prior.secret;
  }
});

test("offline extractor verifies and creates byte-identical BSON without database access", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unis-backup-recovery-test-"));
  const input = join(directory, "test.unisbackup"); const output = join(directory, "recovered");
  await writeFile(input, await encodeBackup(snapshot(), key));
  const tool = resolve("tools/manual-database-backup/extract-backup.mjs");
  const { stdout } = await promisify(execFile)(process.execPath, [tool, input, output], { env: { ...process.env, DATABASE_BACKUP_ENCRYPTION_KEY: key.toString("base64") } });
  assert.match(stdout, /Verified 2 collections/);
  assert.deepEqual(await readFile(join(output, "unisDB/students.bson")), rawDocument);
  const metadata = JSON.parse(await readFile(join(output, "unisDB/students.metadata.json"), "utf8")); assert.equal(metadata.indexes[0].name, "_id_");
  await assert.rejects(promisify(execFile)(process.execPath, [tool, input, output], { env: { ...process.env, DATABASE_BACKUP_ENCRYPTION_KEY: key.toString("base64") } }));
  assert.deepEqual(await readFile(join(output, "unisDB/students.bson")), rawDocument);
});
