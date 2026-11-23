import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import { TARGETS, validDay } from './config.mjs';

const MAGIC = Buffer.from('UNISBKP1');
const HEADER_LIMIT = 16384;

export async function digestFile(path, algorithm = 'sha256') {
  const hash = createHash(algorithm);
  let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  return { hash: hash.digest('hex'), bytes };
}

export async function encryptArchive(source, destination, key, metadata) {
  const plain = await digestFile(source);
  if (!plain.bytes) throw new Error('Cannot encrypt an empty dump');
  const iv = randomBytes(12);
  const header = Buffer.from(JSON.stringify({
    ...metadata, format: 'UNISBKP1', encryption: 'AES-256-GCM', archive: 'mongodump-gzip',
    iv: iv.toString('base64'), plainSha256: plain.hash, plainBytes: plain.bytes,
  }), 'utf8');
  if (header.length > HEADER_LIMIT) throw new Error('Backup header is too large');
  const length = Buffer.alloc(4); length.writeUInt32BE(header.length);
  const prefix = Buffer.concat([MAGIC, length, header]);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(prefix);
  const output = await open(destination, 'wx', 0o600);
  const sink = output.createWriteStream();
  try {
    sink.write(prefix);
    await pipeline(createReadStream(source), cipher, sink, { end: false });
    await new Promise((resolve, reject) => {
      sink.once('error', reject); sink.end(cipher.getAuthTag(), resolve);
    });
  } catch (error) {
    sink.destroy(); await output.close().catch(() => {}); await unlink(destination).catch(() => {}); throw error;
  }
  return { header: JSON.parse(header.toString('utf8')), ...(await digestFile(destination)) };
}

export async function archiveHeader(path) {
  const handle = await open(path, 'r');
  try {
    const lead = Buffer.alloc(12);
    if ((await handle.read(lead, 0, 12, 0)).bytesRead !== 12 || !lead.subarray(0, 8).equals(MAGIC)) throw new Error('Unsupported backup format');
    const length = lead.readUInt32BE(8);
    if (length < 2 || length > HEADER_LIMIT) throw new Error('Invalid backup header size');
    const raw = Buffer.alloc(length);
    if ((await handle.read(raw, 0, length, 12)).bytesRead !== length) throw new Error('Truncated backup header');
    let header;
    try { header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { throw new Error('Invalid UTF-8 backup header'); }
    const iv = Buffer.from(header.iv ?? '', 'base64');
    if (header.format !== 'UNISBKP1' || header.encryption !== 'AES-256-GCM' || header.archive !== 'mongodump-gzip' ||
        iv.length !== 12 || iv.toString('base64') !== header.iv ||
        TARGETS[header.environment]?.database !== header.database || !validDay(header.day) ||
        !/^[0-9a-f]{64}$/.test(header.plainSha256 ?? '') || !Number.isSafeInteger(header.plainBytes) || header.plainBytes <= 0) {
      throw new Error('Invalid backup metadata');
    }
    const size = (await handle.stat()).size;
    const start = 12 + length;
    if (size !== start + header.plainBytes + 16) throw new Error('Backup length does not match its header');
    const tag = Buffer.alloc(16); await handle.read(tag, 0, 16, size - 16);
    return { header, iv, tag, prefix: Buffer.concat([lead, raw]), start, end: size - 17 };
  } finally { await handle.close(); }
}

export async function verifyArchive(path, key, expected = {}) {
  const info = await archiveHeader(path);
  for (const field of ['environment', 'database', 'day', 'keyId']) {
    if (expected[field] !== undefined && info.header[field] !== expected[field]) throw new Error(`Archive ${field} does not match the expected value`);
  }
  const decipher = createDecipheriv('aes-256-gcm', key, info.iv);
  decipher.setAAD(info.prefix); decipher.setAuthTag(info.tag);
  const hash = createHash('sha256'); let bytes = 0;
  const sink = new Writable({ write(chunk, encoding, callback) { hash.update(chunk); bytes += chunk.length; callback(); } });
  await pipeline(createReadStream(path, { start: info.start, end: info.end }), decipher, sink);
  if (hash.digest('hex') !== info.header.plainSha256 || bytes !== info.header.plainBytes) throw new Error('Decrypted archive checksum mismatch');
  return info.header;
}

export async function decryptArchive(path, destination, key, expected = {}) {
  // Authenticate the entire archive before writing any restore input.
  const header = await verifyArchive(path, key, expected);
  const info = await archiveHeader(path);
  const decipher = createDecipheriv('aes-256-gcm', key, info.iv);
  decipher.setAAD(info.prefix); decipher.setAuthTag(info.tag);
  // Own the output before starting the pipeline; failed exclusive creation must never delete a user file.
  const output = await open(destination, 'wx', 0o600);
  try {
    await pipeline(createReadStream(path, { start: info.start, end: info.end }), decipher,
      output.createWriteStream());
    const restored = await digestFile(destination);
    if (restored.hash !== header.plainSha256 || restored.bytes !== header.plainBytes) throw new Error('Restore output checksum mismatch');
  } catch (error) {
    await output.close().catch(() => {});
    await unlink(destination).catch(() => {});
    throw error;
  }
  return header;
}
