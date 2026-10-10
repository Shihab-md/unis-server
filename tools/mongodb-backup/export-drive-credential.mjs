#!/usr/bin/env node
// One-time operator helper. It imports only the model/crypto helper, never index.js.
// Run with the environment of the matching UNIS deployment, then store the output off the database.
import { open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import IntegrationCredential from '../../models/IntegrationCredential.js';
import { decryptText } from '../../utils/cryptoHelper.js';
import { getAppEnvironment, getMongoDatabaseName } from '../../utils/runtimeEnvironment.js';
import { TARGETS, required } from './config.mjs';

async function main() {
  const [environment, outputPath] = process.argv.slice(2);
  if (process.argv.length !== 4 || !TARGETS[environment] || getAppEnvironment() !== environment ||
      getMongoDatabaseName() !== TARGETS[environment].database) throw new Error('Use the exact environment and database of the matching deployment');
  const clientId = required(process.env, 'GOOGLE_CLIENT_ID');
  const clientSecret = required(process.env, 'GOOGLE_CLIENT_SECRET');
  required(process.env, 'INTEGRATION_ENC_SECRET');
  await mongoose.connect(required(process.env, 'MONGODB_URL'), {
    maxPoolSize: 1, serverSelectionTimeoutMS: 15000, autoIndex: false, autoCreate: false,
  });
  try {
    const credential = await IntegrationCredential.findOne({ key: 'google_drive' }).lean();
    if (!credential?.refreshTokenEnc) throw new Error('Matching deployment has no connected Drive credential');
    const token = decryptText(credential.refreshTokenEnc);
    if (!token) throw new Error('Drive refresh token is empty');
    const path = resolve(outputPath);
    const handle = await open(path, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify({
        UNIS_BACKUP_GOOGLE_CLIENT_ID: clientId,
        UNIS_BACKUP_GOOGLE_CLIENT_SECRET: clientSecret,
        UNIS_BACKUP_GOOGLE_REFRESH_TOKEN: token,
      }, null, 2) + '\n', 'utf8');
    } catch (error) { await unlink(path).catch(() => {}); throw error; }
    finally { await handle.close(); }
    console.log(JSON.stringify({ status: 'exported', environment, database: TARGETS[environment].database,
      notice: 'Private credential file created. Store it separately from MongoDB; never commit or share it.' }));
  } finally { await mongoose.disconnect(); }
}

main().catch(() => {
  console.error('Drive credential export failed. Check environment, database, encryption secret and output path privately. No credential details were logged.');
  process.exitCode = 1;
});
