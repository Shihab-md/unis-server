import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { readBackupKey, decodeBackup, sha256 } from "../../utils/databaseBackupArchive.js";

// Offline recovery only. Never connects to MongoDB, and never overwrites an
// existing output directory. Restore into a separate test database first.
async function main() {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) throw new Error("Usage: node tools/manual-database-backup/extract-backup.mjs backup.unisbackup NEW_OUTPUT_DIRECTORY");
  const archive = await readFile(resolve(input));
  const key = readBackupKey(process.env.DATABASE_BACKUP_ENCRYPTION_KEY);
  const { manifest, collections } = await decodeBackup(archive, key);
  // Validate all names and archive bytes before creating any output.
  const filenames = collections.map((c) => c.name.normalize("NFC").toLowerCase());
  if (new Set(filenames).size !== filenames.length) throw new Error("Collection filenames collide on this filesystem.");
  const root = resolve(output);
  await mkdir(root, { mode: 0o700 });
  const databaseDirectory = join(root, manifest.database);
  await mkdir(databaseDirectory, { mode: 0o700 });
  for (const collection of collections) {
    await writeFile(join(databaseDirectory, `${collection.name}.bson`), collection.data, { flag: "wx", mode: 0o600 });
    await writeFile(join(databaseDirectory, `${collection.name}.metadata.json`), JSON.stringify(collection.metadata), { flag: "wx", mode: 0o600 });
  }
  await writeFile(join(root, "UNIS-backup-manifest.json"), JSON.stringify({ ...manifest, archiveSha256: sha256(archive) }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(`Verified ${collections.length} collections. Extracted raw BSON and index/collection metadata to ${root}`);
  console.log("Use mongorestore with namespace mapping into a new recovery-test database. See MANUAL_DATABASE_BACKUP.md.");
}

main().catch(() => {
  console.error("Backup extraction failed. Check arguments, archive, original encryption key and a new output directory. No database was modified.");
  process.exitCode = 1;
});
