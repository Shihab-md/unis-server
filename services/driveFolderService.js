import {
  getGoogleDriveRootFolderId,
  getGoogleDriveRootFolderName,
  isStagingEnvironment,
} from "../utils/runtimeEnvironment.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";

const escapeDriveQuery = (value) => String(value || "").replace(/'/g, "\\'");

const safeFolderName = (value, fallback = "Folder") => {
  const cleaned = String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ");
  return cleaned || fallback;
};

const findChildFolderId = async (drive, parentId, folderName) => {
  const q = [
    `mimeType='${FOLDER_MIME}'`,
    `name='${escapeDriveQuery(folderName)}'`,
    "trashed=false",
    parentId ? `'${parentId}' in parents` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  const response = await drive.files.list({
    q,
    fields: "files(id,name,mimeType,trashed)",
    spaces: "drive",
    pageSize: 10,
  });

  return response.data.files?.[0]?.id || null;
};

const createFolder = async (drive, parentId, folderName) => {
  const response = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: "id,name,mimeType,trashed",
  });

  return response.data.id;
};

export const resolveEnvironmentDriveRoot = async (drive) => {
  const configuredRootId = getGoogleDriveRootFolderId();
  const expectedRootName = getGoogleDriveRootFolderName();

  if (configuredRootId) {
    let metadata;
    try {
      const response = await drive.files.get({
        fileId: configuredRootId,
        fields: "id,name,mimeType,trashed",
      });
      metadata = response.data;
    } catch (error) {
      throw Object.assign(
        new Error(
          isStagingEnvironment()
            ? "STAGING SAFETY BLOCK: configured Google Drive root is not accessible."
            : "Configured Google Drive root is not accessible."
        ),
        { cause: error }
      );
    }

    if (!metadata?.id || metadata.trashed || metadata.mimeType !== FOLDER_MIME) {
      throw new Error(
        isStagingEnvironment()
          ? "STAGING SAFETY BLOCK: configured Google Drive root is not a valid folder."
          : "Configured Google Drive root is not a valid folder."
      );
    }

    if (String(metadata.name || "").trim() !== expectedRootName) {
      throw new Error(
        `${isStagingEnvironment() ? "STAGING SAFETY BLOCK: " : ""}` +
          `configured Google Drive root must be named '${expectedRootName}', received '${metadata.name || ""}'.`
      );
    }

    return { id: metadata.id, name: metadata.name };
  }

  if (isStagingEnvironment()) {
    throw new Error("STAGING SAFETY BLOCK: GOOGLE_DRIVE_ROOT_FOLDER_ID is required.");
  }

  let rootId = await findChildFolderId(drive, null, expectedRootName);
  if (!rootId) rootId = await createFolder(drive, null, expectedRootName);
  return { id: rootId, name: expectedRootName };
};

export const ensureEnvironmentDriveFolderPath = async (drive, relativeParts = []) => {
  const root = await resolveEnvironmentDriveRoot(drive);
  const safeParts = (Array.isArray(relativeParts) ? relativeParts : [])
    .map((part) => safeFolderName(part))
    .filter(Boolean);

  let parentId = root.id;
  for (const folderName of safeParts) {
    let folderId = await findChildFolderId(drive, parentId, folderName);
    if (!folderId) folderId = await createFolder(drive, parentId, folderName);
    parentId = folderId;
  }

  return {
    folderId: parentId,
    rootFolderId: root.id,
    rootFolderName: root.name,
    folderPath: [root.name, ...safeParts].join("/"),
  };
};

export const buildEnvironmentDrivePath = (relativeParts = []) => {
  const parts = (Array.isArray(relativeParts) ? relativeParts : [])
    .map((part) => safeFolderName(part))
    .filter(Boolean);
  return [getGoogleDriveRootFolderName(), ...parts].join("/");
};

export const assertDriveFileWithinEnvironmentRoot = async (drive, fileId) => {
  if (!isStagingEnvironment()) return true;

  const targetId = String(fileId || "").trim();
  if (!targetId) {
    throw new Error("STAGING SAFETY BLOCK: Google Drive file id is missing.");
  }

  const root = await resolveEnvironmentDriveRoot(drive);
  if (targetId === root.id) return true;

  const pending = [targetId];
  const visited = new Set();
  let inspected = 0;

  while (pending.length > 0 && inspected < 32) {
    const currentId = pending.shift();
    if (!currentId || visited.has(currentId)) continue;
    visited.add(currentId);
    inspected += 1;

    let metadata;
    try {
      const response = await drive.files.get({
        fileId: currentId,
        fields: "id,parents,trashed",
      });
      metadata = response.data;
    } catch (error) {
      throw Object.assign(
        new Error("STAGING SAFETY BLOCK: Google Drive file could not be validated against the staging root."),
        { cause: error }
      );
    }

    if (!metadata?.id || metadata.trashed) {
      throw new Error("STAGING SAFETY BLOCK: Google Drive file is missing or trashed.");
    }

    const parents = Array.isArray(metadata.parents) ? metadata.parents : [];
    if (parents.includes(root.id)) return true;

    for (const parentId of parents) {
      if (parentId === root.id) return true;
      if (parentId && !visited.has(parentId)) pending.push(parentId);
    }
  }

  throw new Error("STAGING SAFETY BLOCK: Google Drive file is outside the configured UNIS-STAGING root.");
};
