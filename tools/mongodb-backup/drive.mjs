import { open, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { OWNER, ownedBackup } from './config.mjs';

const API = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,parents,trashed,size,createdTime,appProperties,capabilities(canAddChildren,canDelete)';
const escapeQuery = (value) => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const transient = (status) => status === 429 || status >= 500;

export class DriveClient {
  constructor(config, { fetchImpl = fetch, sleep = delay } = {}) {
    this.config = config; this.fetch = fetchImpl; this.sleep = sleep;
    this.accessToken = ''; this.expiresAt = 0;
  }

  async token(force = false) {
    if (this.shutdownSignal?.aborted) throw new Error('Backup interrupted');
    if (!force && this.accessToken && Date.now() < this.expiresAt) return this.accessToken;
    for (let attempt = 0; attempt < 4; attempt++) {
      let response;
      try {
        response = await this.fetch('https://oauth2.googleapis.com/token', {
          method: 'POST', redirect: 'error', signal: this.shutdownSignal ? AbortSignal.any([this.shutdownSignal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret,
            refresh_token: this.config.refreshToken, grant_type: 'refresh_token' }),
        });
      } catch {
        if (this.shutdownSignal?.aborted) throw new Error('Backup interrupted');
        if (attempt === 3) throw new Error('Google OAuth network failure');
      }
      if (response?.ok) {
        const value = await response.json();
        if (!value.access_token) throw new Error('Google OAuth returned no access token');
        this.accessToken = value.access_token;
        this.expiresAt = Date.now() + Math.max(0, Number(value.expires_in ?? 3600) - 120) * 1000;
        return this.accessToken;
      }
      if (response && !transient(response.status)) throw new Error(`Google OAuth rejected the credentials (HTTP ${response.status})`);
      if (attempt === 3) throw new Error('Google OAuth retry limit reached');
      await this.sleep(1000 * 2 ** attempt);
    }
  }

  async request(url, options = {}, { retry = true, timeout = 60000 } = {}) {
    // Session URLs must stay on the Google API host. Never log URLs or bodies.
    if (new URL(url).origin !== 'https://www.googleapis.com') throw new Error('Unexpected Drive API host');
    for (let attempt = 0; attempt < (retry ? 5 : 2); attempt++) {
      if (this.shutdownSignal?.aborted) throw new Error('Backup interrupted');
      const token = await this.token();
      let response;
      try {
        response = await this.fetch(url, { ...options, redirect: 'error', signal: this.shutdownSignal ? AbortSignal.any([this.shutdownSignal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
          headers: { ...options.headers, Authorization: `Bearer ${token}` } });
      } catch {
        if (this.shutdownSignal?.aborted) throw new Error('Backup interrupted');
        if (!retry || attempt === 4) throw new Error('Drive API network failure');
      }
      if (response?.status === 401 && attempt === 0) { await this.token(true); continue; }
      if (response && (!transient(response.status) || !retry)) return response;
      if (attempt === 4) throw new Error('Drive API retry limit reached');
      await this.sleep(1000 * 2 ** attempt);
    }
    throw new Error('Drive API authentication retry limit reached');
  }

  async json(path, options = {}) {
    const response = await this.request(`${API}${path}`, {
      ...options, headers: { 'Content-Type': 'application/json; charset=UTF-8', ...options.headers },
    }, { retry: options.method !== 'POST' });
    if (!response.ok) throw new Error(`Drive API operation failed (HTTP ${response.status})`);
    return response.status === 204 ? null : response.json();
  }

  async get(id) { return this.json(`/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(FIELDS)}`); }

  async list(query) {
    const files = []; let pageToken = '';
    do {
      const params = new URLSearchParams({ q: query, fields: `nextPageToken,incompleteSearch,files(${FIELDS})`,
        pageSize: '1000', spaces: 'drive' });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await this.json(`/files?${params}`);
      if (page.incompleteSearch) throw new Error('Drive returned an incomplete file listing');
      files.push(...(page.files ?? [])); pageToken = page.nextPageToken ?? '';
    } while (pageToken);
    return files;
  }

  async root() {
    const root = await this.get(this.config.rootId);
    if (root.trashed || root.mimeType !== FOLDER || root.name !== this.config.rootName || !root.capabilities?.canAddChildren) {
      throw new Error('The configured Drive root does not match this environment or is not writable');
    }
    return root;
  }

  async init() {
    await this.root();
    const child = async (parentId, name, tagged) => {
      const matches = await this.list(`'${escapeQuery(parentId)}' in parents and trashed = false and name = '${escapeQuery(name)}'`);
      if (matches.length > 1) throw new Error(`Multiple ${name} folders found; resolve the ambiguity before setup`);
      let folder = matches[0];
      if (!folder) folder = await this.json('/files?fields=' + encodeURIComponent(FIELDS), {
        method: 'POST', body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId],
          ...(tagged ? { appProperties: { owner: OWNER, environment: this.config.environment, database: this.config.database, role: 'archive-folder' } } : {}) }),
      });
      if (folder.mimeType !== FOLDER || folder.parents?.length !== 1 || folder.parents[0] !== parentId) throw new Error('Invalid backup folder hierarchy');
      if (tagged && !this.folderOwned(folder)) throw new Error('Existing MongoDB folder is not owned by this backup worker; do not reuse it');
      return folder;
    };
    const parent = await child(this.config.rootId, 'Backups', false);
    const folder = await child(parent.id, 'MongoDB', true);
    return { environment: this.config.environment, database: this.config.database, rootId: this.config.rootId, folderId: folder.id };
  }

  folderOwned(folder) {
    const p = folder.appProperties ?? {};
    return p.owner === OWNER && p.environment === this.config.environment && p.database === this.config.database && p.role === 'archive-folder';
  }

  async validateFolder() {
    await this.root();
    const folder = await this.get(this.config.folderId);
    if (folder.trashed || folder.mimeType !== FOLDER || folder.name !== 'MongoDB' || !this.folderOwned(folder) ||
        folder.parents?.length !== 1 || !folder.capabilities?.canAddChildren) throw new Error('Invalid environment backup folder');
    const parent = await this.get(folder.parents[0]);
    if (parent.trashed || parent.mimeType !== FOLDER || parent.name !== 'Backups' ||
        parent.parents?.length !== 1 || parent.parents[0] !== this.config.rootId) throw new Error('Backup folder is outside the configured environment root');
  }

  async backups() {
    const query = `'${escapeQuery(this.config.folderId)}' in parents and trashed = false and ` +
      `appProperties has { key='owner' and value='${OWNER}' }`;
    return (await this.list(query)).filter((file) => ownedBackup(file, this.config));
  }

  async upload(path, metadata) {
    const size = (await stat(path)).size;
    const { ids } = await this.json('/files/generateIds?count=1&space=drive&type=files');
    const id = ids?.[0]; if (!id) throw new Error('Drive did not reserve a file ID');
    const start = await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=' + encodeURIComponent(FIELDS), {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(size) },
      body: JSON.stringify({ ...metadata, id, mimeType: 'application/octet-stream', parents: [this.config.folderId] }),
    }, { retry: false });
    if (!start.ok) throw new Error(`Drive upload initiation failed (HTTP ${start.status})`);
    const session = start.headers.get('Location');
    if (!session || new URL(session).origin !== 'https://www.googleapis.com') throw new Error('Invalid Drive upload session');
    const handle = await open(path, 'r');
    const chunkSize = 2 * 1024 * 1024; let offset = 0; let failures = 0;
    const consume = async (response, previous, maximum) => {
      if (response.ok) {
        const result = await response.json();
        if (result.id !== id) throw new Error('Drive upload returned an unexpected file ID');
        return result;
      }
      if (response.status !== 308) throw new Error(`Drive resumable upload failed (HTTP ${response.status})`);
      const range = response.headers.get('Range');
      const match = range?.match(/^bytes=0-(\d+)$/);
      const next = range ? (match ? Number(match[1]) + 1 : NaN) : 0;
      if (!Number.isSafeInteger(next) || next < previous || next > maximum || next >= size) throw new Error('Invalid Drive resumable upload range');
      offset = next;
      return null;
    };
    try {
      while (offset < size) {
        const previous = offset;
        const chunk = Buffer.alloc(Math.min(chunkSize, size - offset));
        if ((await handle.read(chunk, 0, chunk.length, offset)).bytesRead !== chunk.length) throw new Error('Backup file changed during upload');
        let response;
        try {
          response = await this.request(session, { method: 'PUT', headers: { 'Content-Length': String(chunk.length),
            'Content-Range': `bytes ${offset}-${offset + chunk.length - 1}/${size}` }, body: chunk }, { retry: false });
        } catch { response = null; }
        if (this.shutdownSignal?.aborted) throw new Error('Backup interrupted');
        if (!response || transient(response.status)) {
          if (++failures > 5) throw new Error('Drive upload recovery limit reached');
          await this.sleep(1000 * 2 ** (failures - 1));
          response = await this.request(session, { method: 'PUT', headers: { 'Content-Length': '0',
            'Content-Range': `bytes */${size}` } });
        }
        const complete = await consume(response, previous, previous + chunk.length);
        if (complete) return complete;
        if (offset > previous) failures = 0;
        else if (++failures > 5) throw new Error('Drive upload made no progress');
      }
      throw new Error('Drive upload ended without completion metadata');
    } finally { await handle.close(); }
  }

  async verifyRemote(id, expectedHash, expectedBytes, expectedRunId, expectedProperties = {}) {
    const file = await this.get(id);
    if (!ownedBackup(file, this.config) || file.appProperties.runId !== expectedRunId ||
        file.appProperties.sha256 !== expectedHash || Number(file.size) !== expectedBytes ||
        Object.entries(expectedProperties).some(([key, value]) => file.appProperties[key] !== value)) throw new Error('Remote backup metadata or size mismatch');
    // Download and hash the encrypted object. This verifies all bytes, not only its metadata.
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await this.request(`${API}/files/${encodeURIComponent(id)}?alt=media`, {}, { timeout: 300000 });
      if (!response.ok || !response.body) throw new Error('Cannot read back the uploaded backup');
      const hash = createHash('sha256'); let bytes = 0;
      try {
        for await (const chunk of response.body) { hash.update(chunk); bytes += chunk.length; }
      } catch {
        if (attempt === 2) throw new Error('Remote backup verification download failed');
        await this.sleep(1000 * 2 ** attempt); continue;
      }
      if (bytes !== expectedBytes || hash.digest('hex') !== expectedHash) throw new Error('Remote backup checksum mismatch');
      return file;
    }
  }

  async markComplete(id, properties) {
    return this.json(`/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(FIELDS)}`, {
      method: 'PATCH', body: JSON.stringify({ appProperties: { ...properties, state: 'complete' } }),
    });
  }

  async removeOwned(id, expectedProperties) {
    // Recheck both ancestry and file tags immediately before permanent deletion.
    await this.validateFolder();
    const file = await this.get(id);
    if (!ownedBackup(file, this.config) || !file.capabilities?.canDelete ||
        Object.keys(file.appProperties).length !== Object.keys(expectedProperties).length ||
        Object.entries(expectedProperties).some(([key, value]) => file.appProperties[key] !== value)) throw new Error('Backup changed before retention deletion');
    const response = await this.request(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new Error(`Backup retention deletion failed (HTTP ${response.status})`);
  }
}
