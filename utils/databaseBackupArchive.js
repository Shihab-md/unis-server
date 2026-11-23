import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";

export class BackupError extends Error {
  constructor(message, status = 503) { super(message); this.name = "BackupError"; this.status = status; }
}

const zip = promisify(gzip);
const unzip = promisify(gunzip);
const MAGIC = Buffer.from("UNISDBB1");
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const readBackupKey = (value) => {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(text)) {
    throw new BackupError("DATABASE_BACKUP_ENCRYPTION_KEY must be a base64 encoded 32-byte key.");
  }
  const key = Buffer.from(text, "base64");
  if (key.length !== 32 || key.toString("base64") !== text) throw new BackupError("Invalid backup encryption key.");
  return key;
};

// Keep raw BSON intact: Dates, ObjectIds, decimals, binary and numeric types are
// never converted into plain JSON. The manifest contains only backup metadata.
export async function encodeBackup(snapshot, key) {
  const manifest = {
    format: "unis-raw-bson-v1", environment: snapshot.environment,
    database: snapshot.database, requestId: snapshot.requestId,
    keyId: snapshot.keyId, startedAt: snapshot.startedAt,
    snapshotTime: snapshot.snapshotTime, backupDate: snapshot.backupDate,
    collections: snapshot.collections.map(({ name, metadata, data, documentCount }) => ({
      name, metadata, byteLength: data.length, documentCount, sha256: sha256(data),
    })),
  };
  const metadata = Buffer.from(JSON.stringify(manifest), "utf8");
  const rawSize = snapshot.collections.reduce((sum, c) => sum + c.data.length, 0);
  if (metadata.length > MAX_MANIFEST_BYTES || rawSize > MAX_BACKUP_BYTES) throw new BackupError("Backup size limit exceeded.");
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(metadata.length);
  const compressed = await zip(Buffer.concat([prefix, metadata, ...snapshot.collections.map((c) => c.data)]), { level: 3 });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(MAGIC);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

export function validateCollectionName(name) {
  if (typeof name !== "string" || !name || name === "." || name === ".." || /[\\/\x00-\x1f]/.test(name)) {
    throw new BackupError("A collection name cannot be safely extracted.");
  }
  // Percent characters are escaped by MongoDB tools; refuse ambiguous filenames
  // instead of creating a backup whose namespace could change during recovery.
  if (name.includes("%")) throw new BackupError("Collection names containing percent characters are unsupported.");
  return name;
}

export async function decodeBackup(bytes, key) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 37 || bytes.length > MAX_BACKUP_BYTES + MAX_MANIFEST_BYTES + 65536 ||
      !bytes.subarray(0, 8).equals(MAGIC)) throw new BackupError("Invalid UNIS backup archive.");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(8, 20));
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(bytes.subarray(20, 36));
  const compressed = Buffer.concat([decipher.update(bytes.subarray(36)), decipher.final()]);
  const plain = await unzip(compressed, { maxOutputLength: MAX_BACKUP_BYTES + MAX_MANIFEST_BYTES + 4 });
  if (plain.length < 4) throw new BackupError("Truncated backup manifest.");
  const size = plain.readUInt32BE(0);
  if (size > MAX_MANIFEST_BYTES || size + 4 > plain.length) throw new BackupError("Invalid backup manifest length.");
  const manifest = JSON.parse(plain.subarray(4, size + 4).toString("utf8"));
  const targets = { production: "unisDB", staging: "unisDB_staging" };
  if (manifest.format !== "unis-raw-bson-v1" || !targets[manifest.environment] ||
      manifest.database !== targets[manifest.environment] || !Array.isArray(manifest.collections) ||
      !manifest.collections.length || manifest.collections.length > 1000) throw new BackupError("Invalid backup manifest.");
  let offset = size + 4;
  const names = new Set();
  const collections = manifest.collections.map((c) => {
    validateCollectionName(c.name);
    if (names.has(c.name) || !Number.isSafeInteger(c.byteLength) || c.byteLength < 0 ||
        !Number.isSafeInteger(c.documentCount) || c.documentCount < 0 || !c.metadata ||
        !Array.isArray(c.metadata.indexes) || offset + c.byteLength > plain.length) throw new BackupError("Invalid collection manifest.");
    names.add(c.name);
    const data = plain.subarray(offset, offset + c.byteLength);
    offset += c.byteLength;
    if (sha256(data) !== c.sha256) throw new BackupError("Collection checksum mismatch.");
    let position = 0;
    let count = 0;
    while (position < data.length) {
      if (data.length - position < 5) throw new BackupError("Truncated BSON document.");
      const length = data.readInt32LE(position);
      if (length < 5 || length > 16 * 1024 * 1024 || position + length > data.length || data[position + length - 1] !== 0) {
        throw new BackupError("Invalid BSON document framing.");
      }
      position += length;
      count += 1;
    }
    if (count !== c.documentCount) throw new BackupError("Collection document count mismatch.");
    return { ...c, data };
  });
  if (offset !== plain.length) throw new BackupError("Unexpected trailing archive data.");
  return { manifest, collections };
}
