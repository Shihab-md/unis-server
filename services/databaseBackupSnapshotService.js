import { BackupError, MAX_BACKUP_BYTES, validateCollectionName } from "../utils/databaseBackupArchive.js";

async function readCatalog(db, BSON, guard) {
  const options = { nameOnly: false, promoteValues: false, maxTimeMS: Math.min(30000, guard.remaining()) };
  const catalog = await guard.run(db.listCollections({}, options).toArray());
  if (!catalog.length || catalog.length > 1000) throw new BackupError("Database has no collections or exceeds the backup collection limit.");
  const result = [];
  for (const entry of catalog.sort((a, b) => a.name.localeCompare(b.name))) {
    guard.check();
    validateCollectionName(entry.name);
    if (entry.type !== "collection" || entry.name.startsWith("system.") || entry.options?.timeseries || entry.options?.encryptedFields) {
      throw new BackupError("This backup supports ordinary collections only; views, system, time-series or encrypted collections were found.");
    }
    if (!entry.info?.uuid) throw new BackupError("MongoDB collection identity is unavailable; backup stopped.");
    const indexes = await guard.run(db.collection(entry.name).listIndexes({
      promoteValues: false, maxTimeMS: Math.min(30000, guard.remaining()),
    }).toArray());
    if (indexes.some((index) => index.buildUUID)) throw new BackupError("An index is being built. Retry the backup after it completes.");
    result.push({
      name: entry.name,
      identity: BSON.EJSON.serialize(entry.info?.uuid, { relaxed: false }),
      metadata: BSON.EJSON.serialize({ options: entry.options || {}, indexes, collectionName: entry.name, type: "collection" }, { relaxed: false }),
    });
  }
  return result;
}

export async function captureDatabaseSnapshot({ db, client, BSON, context, requestId, backupDate, guard }) {
  const before = await readCatalog(db, BSON, guard);
  const session = client.startSession({ snapshot: true, causalConsistency: false });
  const collections = [];
  let totalBytes = 0;
  try {
    for (const entry of before) {
      guard.check();
      const chunks = [];
      let documentCount = 0;
      const cursor = db.collection(entry.name).find({}, {
        session, raw: true, readPreference: "primary", readConcern: { level: "snapshot" }, batchSize: 200,
        maxTimeMS: Math.min(60000, guard.remaining()),
      });
      try {
        while (true) {
          const raw = await guard.run(cursor.next());
          if (raw === null) break;
          guard.check();
          if (!Buffer.isBuffer(raw)) throw new BackupError("MongoDB did not return raw BSON; backup stopped.");
          totalBytes += raw.length;
          if (totalBytes > MAX_BACKUP_BYTES) throw new BackupError("Database exceeds this manual backup's 64 MiB raw BSON limit.");
          chunks.push(raw);
          documentCount += 1;
        }
      } finally {
        await cursor.close().catch(() => {});
      }
      collections.push({ name: entry.name, metadata: entry.metadata, documentCount, data: Buffer.concat(chunks) });
    }
    if (!session.snapshotTime) throw new BackupError("MongoDB did not establish a shared snapshot; backup stopped.");
    const after = await readCatalog(db, BSON, guard);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new BackupError("Collection or index definitions changed during backup. Retry after schema changes finish.");
    return {
      ...context, requestId, backupDate, startedAt: guard.startedAt,
      snapshotTime: BSON.EJSON.serialize(session.snapshotTime, { relaxed: false }), collections,
    };
  } finally {
    await session.endSession();
  }
}
