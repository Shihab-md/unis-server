import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import DemoTutorial, { DEMO_TUTORIAL_VIEW_ROLES } from "../models/DemoTutorial.js";
import {
  DEMO_TUTORIAL_DOWNLOAD_CHUNK_BYTES,
  DEMO_TUTORIAL_UPLOAD_CHUNK_BYTES,
  createDemoTutorialResumableSession,
  deleteDemoTutorialFileFromDrive,
  getDemoTutorialDownloadRange,
  getDemoTutorialDownloadStream,
  uploadDemoTutorialResumableChunk,
  verifyCompletedDemoTutorialUpload,
} from "../services/demoTutorialDriveService.js";
import { validateDemoTutorialUploadMetadata } from "../services/demoTutorialFileValidationService.js";

const SUPERADMIN_ROLE = "superadmin";
const VIEW_ROLE_SET = new Set(DEMO_TUTORIAL_VIEW_ROLES);
const UPLOAD_TOKEN_PURPOSE = "demo_tutorial_resumable_upload";
const UPLOAD_TOKEN_TTL = process.env.DEMO_TUTORIAL_UPLOAD_TOKEN_TTL || "2h";

const clean = (value) =>
  value === undefined || value === null ? "" : String(value).trim();
const roleOf = (req) => clean(req.user?.role).toLowerCase();
const isSuperadmin = (req) => roleOf(req) === SUPERADMIN_ROLE;
const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const escapeRegex = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const badRequest = (message) =>
  Object.assign(new Error(message), { status: 400 });

const normalizeVisibleRoles = (raw) => {
  let values = [];
  if (Array.isArray(raw)) values = raw;
  else if (raw !== undefined && raw !== null && raw !== "") {
    try {
      const parsed = JSON.parse(String(raw));
      values = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      values = String(raw).split(",");
    }
  }

  const normalized = [
    ...new Set(values.map((role) => clean(role).toLowerCase()).filter(Boolean)),
  ];
  const invalid = normalized.filter((role) => !VIEW_ROLE_SET.has(role));
  if (invalid.length) {
    throw Object.assign(
      new Error(`Invalid visible role(s): ${invalid.join(", ")}`),
      { status: 400 }
    );
  }
  if (!normalized.length) {
    throw Object.assign(
      new Error("Select at least one role that can view this Demo - Tutorial file."),
      { status: 400 }
    );
  }
  return normalized;
};

const validateTextFields = ({ title, description }) => {
  const cleanTitle = clean(title).replace(/\s+/g, " ");
  const cleanDescription = clean(description);

  if (!cleanTitle)
    throw Object.assign(new Error("Title is required."), { status: 400 });
  if (cleanTitle.length > 160)
    throw Object.assign(new Error("Title must be 160 characters or fewer."), {
      status: 400,
    });
  if (cleanDescription.length > 3000)
    throw Object.assign(
      new Error("Description must be 3000 characters or fewer."),
      { status: 400 }
    );

  return { title: cleanTitle, description: cleanDescription };
};

const canView = (tutorial, role) => {
  if (role === SUPERADMIN_ROLE) return true;
  if (!VIEW_ROLE_SET.has(role)) return false;
  return (tutorial.visibleRoles || []).includes(role);
};

const serializeTutorial = (tutorial, { includeRoles = true } = {}) => {
  const obj =
    typeof tutorial?.toObject === "function"
      ? tutorial.toObject()
      : { ...tutorial };
  return {
    _id: String(obj._id),
    title: obj.title,
    description: obj.description || "",
    ...(includeRoles ? { visibleRoles: obj.visibleRoles || [] } : {}),
    fileKind: obj.fileKind,
    originalFileName: obj.originalFileName,
    driveFileName: obj.driveFileName,
    mimeType: obj.mimeType,
    fileSize: Number(obj.fileSize || 0),
    driveFolderPath: obj.driveFolderPath || "UNIS/Demo-Tutorial",
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
};

const sendError = (
  res,
  error,
  fallback = "Demo - Tutorial operation failed."
) => {
  const status = Number(error?.status || 0);
  const message = clean(error?.message) || fallback;
  if (status >= 400 && status < 600) {
    return res.status(status).json({ success: false, error: message });
  }
  console.error("[demoTutorial]", error);
  return res.status(500).json({ success: false, error: fallback });
};

const signUploadToken = ({ req, mode, tutorialId = null, metadata, session }) =>
  jwt.sign(
    {
      purpose: UPLOAD_TOKEN_PURPOSE,
      mode,
      uid: String(req.user?._id || ""),
      tutorialId: tutorialId ? String(tutorialId) : null,
      existingFileId: mode === "update" ? String(session.existingFileId || "") : null,
      driveFolderId: session.driveFolderId || null,
      uploadNonce: session.uploadNonce || "",
      sessionUrl: session.sessionUrl || "",
      originalFileName: metadata.originalFileName,
      driveFileName: session.driveFileName,
      mimeType: metadata.mimeType,
      fileSize: metadata.fileSize,
      fileKind: metadata.fileKind,
    },
    process.env.JWT_SECRET,
    { expiresIn: UPLOAD_TOKEN_TTL }
  );

const verifyUploadToken = ({ req, rawToken, mode, tutorialId = null }) => {
  try {
    const decoded = jwt.verify(clean(rawToken), process.env.JWT_SECRET);
    if (
      decoded?.purpose !== UPLOAD_TOKEN_PURPOSE ||
      decoded?.mode !== mode ||
      String(decoded?.uid || "") !== String(req.user?._id || "") ||
      (tutorialId && String(decoded?.tutorialId || "") !== String(tutorialId))
    ) {
      throw new Error("invalid token scope");
    }
    return decoded;
  } catch {
    throw Object.assign(
      new Error("Upload session expired or is invalid. Please try again."),
      { status: 400 }
    );
  }
};

const verifyChunkUploadToken = ({ req, rawToken }) => {
  try {
    const decoded = jwt.verify(clean(rawToken), process.env.JWT_SECRET);
    const mode = clean(decoded?.mode).toLowerCase();
    const sessionUrl = clean(decoded?.sessionUrl);
    let parsedUrl = null;
    try {
      parsedUrl = new URL(sessionUrl);
    } catch {
      parsedUrl = null;
    }

    if (
      decoded?.purpose !== UPLOAD_TOKEN_PURPOSE ||
      !["create", "update"].includes(mode) ||
      String(decoded?.uid || "") !== String(req.user?._id || "") ||
      !parsedUrl ||
      parsedUrl.protocol !== "https:" ||
      parsedUrl.hostname !== "www.googleapis.com" ||
      !parsedUrl.pathname.startsWith("/upload/drive/v3/files")
    ) {
      throw new Error("invalid token scope");
    }
    return decoded;
  } catch {
    throw Object.assign(
      new Error("Upload session expired or is invalid. Please try again."),
      { status: 400 }
    );
  }
};

const parseUploadContentRange = ({ header, expectedTotal, bodyLength }) => {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(clean(header));
  if (!match) throw badRequest("Upload session expired or is invalid. Please try again.");

  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  const expectedLength = end - start + 1;
  const isFinalChunk = end + 1 === total;
  const alignment = 256 * 1024;

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    start < 0 ||
    end < start ||
    total !== Number(expectedTotal || 0) ||
    expectedLength !== Number(bodyLength || 0) ||
    expectedLength <= 0 ||
    expectedLength > DEMO_TUTORIAL_UPLOAD_CHUNK_BYTES ||
    start % alignment !== 0 ||
    (!isFinalChunk && expectedLength % alignment !== 0)
  ) {
    throw badRequest("Upload session expired or is invalid. Please try again.");
  }

  return { start, end, total };
};

const validateMetadataBeforeUpload = (body) => {
  // Validate the form before creating the resumable Drive session so a
  // title/role error does not waste the user's upload time.
  validateTextFields(body || {});
  normalizeVisibleRoles(body?.visibleRoles);

  return validateDemoTutorialUploadMetadata({
    fileName: body?.fileName,
    mimeType: body?.mimeType,
    fileSize: body?.fileSize,
    signatureBase64: body?.signatureBase64,
  });
};

export const listDemoTutorials = async (req, res) => {
  try {
    const role = roleOf(req);
    if (role !== SUPERADMIN_ROLE && !VIEW_ROLE_SET.has(role)) {
      return res.status(403).json({
        success: false,
        error: "Demo - Tutorial is not available for this role.",
      });
    }

    const page = Math.max(1, Number.parseInt(req.query?.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query?.limit, 10) || 20)
    );
    const search = clean(req.query?.search);

    const query = role === SUPERADMIN_ROLE ? {} : { visibleRoles: role };
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      query.$or = [
        { title: regex },
        { description: regex },
        { driveFileName: regex },
        { originalFileName: regex },
      ];
    }

    const [items, total] = await Promise.all([
      DemoTutorial.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      DemoTutorial.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      items: items.map((item) =>
        serializeTutorial(item, { includeRoles: role === SUPERADMIN_ROLE })
      ),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    return sendError(res, error, "Unable to load Demo - Tutorial files.");
  }
};

export const getDemoTutorial = async (req, res) => {
  try {
    if (!isObjectId(req.params?.id)) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid Demo - Tutorial ID." });
    }

    const tutorial = await DemoTutorial.findById(req.params.id).lean();
    if (!tutorial)
      return res
        .status(404)
        .json({ success: false, error: "Demo - Tutorial file not found." });

    const role = roleOf(req);
    if (!canView(tutorial, role)) {
      return res.status(403).json({
        success: false,
        error: "You are not allowed to view this Demo - Tutorial file.",
      });
    }

    return res.status(200).json({
      success: true,
      item: serializeTutorial(tutorial, {
        includeRoles: role === SUPERADMIN_ROLE,
      }),
    });
  } catch (error) {
    return sendError(res, error, "Unable to load Demo - Tutorial file.");
  }
};

export const createDemoTutorialUploadSession = async (req, res) => {
  try {
    if (!isSuperadmin(req)) {
      return res.status(403).json({
        success: false,
        error: "Only Superadmin can upload Demo - Tutorial files.",
      });
    }

    const metadata = validateMetadataBeforeUpload(req.body || {});
    const session = await createDemoTutorialResumableSession(metadata);
    const uploadToken = signUploadToken({
      req,
      mode: "create",
      metadata,
      session,
    });

    return res.status(200).json({
      success: true,
      uploadToken,
      uploadChunkBytes: DEMO_TUTORIAL_UPLOAD_CHUNK_BYTES,
      driveFileName: session.driveFileName,
      mimeType: metadata.mimeType,
      fileSize: metadata.fileSize,
      fileKind: metadata.fileKind,
    });
  } catch (error) {
    return sendError(res, error, "Unable to upload Demo - Tutorial file.");
  }
};

export const createDemoTutorialReplacementSession = async (req, res) => {
  try {
    if (!isSuperadmin(req)) {
      return res.status(403).json({
        success: false,
        error: "Only Superadmin can edit Demo - Tutorial files.",
      });
    }
    if (!isObjectId(req.params?.id)) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid Demo - Tutorial ID." });
    }

    const tutorial = await DemoTutorial.findById(req.params.id).lean();
    if (!tutorial)
      return res
        .status(404)
        .json({ success: false, error: "Demo - Tutorial file not found." });

    const metadata = validateMetadataBeforeUpload(req.body || {});
    const session = await createDemoTutorialResumableSession({
      ...metadata,
      existingFileId: tutorial.driveFileId,
    });
    const sessionForToken = {
      ...session,
      existingFileId: tutorial.driveFileId,
    };
    const uploadToken = signUploadToken({
      req,
      mode: "update",
      tutorialId: tutorial._id,
      metadata,
      session: sessionForToken,
    });

    return res.status(200).json({
      success: true,
      uploadToken,
      uploadChunkBytes: DEMO_TUTORIAL_UPLOAD_CHUNK_BYTES,
      driveFileName: session.driveFileName,
      driveFileId: tutorial.driveFileId,
      mimeType: metadata.mimeType,
      fileSize: metadata.fileSize,
      fileKind: metadata.fileKind,
    });
  } catch (error) {
    return sendError(res, error, "Unable to update Demo - Tutorial file.");
  }
};

export const uploadDemoTutorialChunk = async (req, res) => {
  try {
    if (!isSuperadmin(req)) {
      return res.status(403).json({
        success: false,
        error: "Only Superadmin can upload Demo - Tutorial files.",
      });
    }

    const decoded = verifyChunkUploadToken({
      req,
      rawToken: req.headers?.["x-demo-upload-token"],
    });

    const chunk = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const { start, end, total } = parseUploadContentRange({
      header: req.headers?.["content-range"],
      expectedTotal: decoded.fileSize,
      bodyLength: chunk.length,
    });

    const result = await uploadDemoTutorialResumableChunk({
      sessionUrl: decoded.sessionUrl,
      mimeType: decoded.mimeType,
      chunk,
      start,
      end,
      total,
    });

    return res.status(200).json({
      success: true,
      completed: Boolean(result.completed),
      nextOffset: Number(result.nextOffset || 0),
      driveFileId: clean(result.file?.id),
    });
  } catch (error) {
    return sendError(res, error, "Unable to upload Demo - Tutorial file.");
  }
};

export const createDemoTutorial = async (req, res) => {
  let verifiedUpload = null;
  try {
    if (!isSuperadmin(req)) {
      return res.status(403).json({
        success: false,
        error: "Only Superadmin can upload Demo - Tutorial files.",
      });
    }

    const fields = validateTextFields(req.body || {});
    const visibleRoles = normalizeVisibleRoles(req.body?.visibleRoles);
    const decoded = verifyUploadToken({
      req,
      rawToken: req.body?.uploadToken,
      mode: "create",
    });
    const driveFileId = clean(req.body?.driveFileId);
    if (!driveFileId) throw badRequest("PDF or video file is required.");

    verifiedUpload = await verifyCompletedDemoTutorialUpload({
      fileId: driveFileId,
      expectedFileName: decoded.driveFileName,
      expectedMimeType: decoded.mimeType,
      expectedFileSize: decoded.fileSize,
      expectedParentId: decoded.driveFolderId,
      expectedUploadNonce: decoded.uploadNonce,
    });

    if (verifiedUpload.fileKind !== decoded.fileKind) {
      throw badRequest("Uploaded Google Drive file could not be verified.");
    }

    // Idempotency guard: if the finalization response was lost and the browser
    // retries, never delete or duplicate the already-committed Drive file.
    const alreadyCreated = await DemoTutorial.findOne({
      driveFileId: verifiedUpload.driveFileId,
    });
    if (alreadyCreated) {
      return res.status(200).json({
        success: true,
        message: "Demo - Tutorial file uploaded successfully.",
        resourceId: String(alreadyCreated._id),
        item: serializeTutorial(alreadyCreated),
      });
    }

    let tutorial;
    try {
      tutorial = await DemoTutorial.create({
        ...fields,
        visibleRoles,
        fileKind: verifiedUpload.fileKind,
        originalFileName: decoded.originalFileName,
        driveFileId: verifiedUpload.driveFileId,
        driveFileName: verifiedUpload.driveFileName,
        driveFolderPath: verifiedUpload.driveFolderPath,
        mimeType: verifiedUpload.mimeType,
        fileSize: verifiedUpload.fileSize,
        createdBy: req.user._id,
        updatedBy: req.user._id,
      });
    } catch (dbError) {
      // A concurrent/retried finalization may have committed this Drive file.
      // Re-check before rollback so a valid record can never lose its file.
      const committed = await DemoTutorial.findOne({
        driveFileId: verifiedUpload.driveFileId,
      }).lean();
      if (committed) {
        return res.status(200).json({
          success: true,
          message: "Demo - Tutorial file uploaded successfully.",
          resourceId: String(committed._id),
          item: serializeTutorial(committed),
        });
      }

      try {
        await deleteDemoTutorialFileFromDrive(verifiedUpload.driveFileId);
      } catch (cleanupError) {
        console.error(
          "[demoTutorial] rollback Drive cleanup failed:",
          cleanupError?.message || cleanupError
        );
      }
      throw dbError;
    }

    return res.status(201).json({
      success: true,
      message: "Demo - Tutorial file uploaded successfully.",
      resourceId: String(tutorial._id),
      item: serializeTutorial(tutorial),
    });
  } catch (error) {
    return sendError(res, error, "Unable to upload Demo - Tutorial file.");
  }
};

export const updateDemoTutorial = async (req, res) => {
  try {
    if (!isSuperadmin(req)) {
      return res.status(403).json({
        success: false,
        error: "Only Superadmin can edit Demo - Tutorial files.",
      });
    }
    if (!isObjectId(req.params?.id)) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid Demo - Tutorial ID." });
    }

    const tutorial = await DemoTutorial.findById(req.params.id);
    if (!tutorial)
      return res
        .status(404)
        .json({ success: false, error: "Demo - Tutorial file not found." });

    const fields = validateTextFields(req.body || {});
    const visibleRoles = normalizeVisibleRoles(req.body?.visibleRoles);

    tutorial.title = fields.title;
    tutorial.description = fields.description;
    tutorial.visibleRoles = visibleRoles;
    tutorial.updatedBy = req.user._id;

    const rawUploadToken = clean(req.body?.uploadToken);
    const suppliedDriveFileId = clean(req.body?.driveFileId);
    if (rawUploadToken || suppliedDriveFileId) {
      if (!rawUploadToken || !suppliedDriveFileId) {
        throw badRequest("Upload session expired or is invalid. Please try again.");
      }

      const decoded = verifyUploadToken({
        req,
        rawToken: rawUploadToken,
        mode: "update",
        tutorialId: tutorial._id,
      });

      if (
        String(decoded.existingFileId || "") !== String(tutorial.driveFileId || "") ||
        suppliedDriveFileId !== String(tutorial.driveFileId || "")
      ) {
        throw badRequest("Upload session expired or is invalid. Please try again.");
      }

      const verifiedUpload = await verifyCompletedDemoTutorialUpload({
        fileId: tutorial.driveFileId,
        expectedFileName: decoded.driveFileName,
        expectedMimeType: decoded.mimeType,
        expectedFileSize: decoded.fileSize,
        expectedUploadNonce: decoded.uploadNonce,
      });

      if (verifiedUpload.fileKind !== decoded.fileKind) {
        throw badRequest("Uploaded Google Drive file could not be verified.");
      }

      tutorial.fileKind = verifiedUpload.fileKind;
      tutorial.originalFileName = decoded.originalFileName;
      tutorial.driveFileName = verifiedUpload.driveFileName;
      tutorial.mimeType = verifiedUpload.mimeType;
      tutorial.fileSize = verifiedUpload.fileSize;
      tutorial.driveFolderPath = verifiedUpload.driveFolderPath;
    }

    await tutorial.save();

    return res.status(200).json({
      success: true,
      message: "Demo - Tutorial file updated successfully.",
      resourceId: String(tutorial._id),
      item: serializeTutorial(tutorial),
    });
  } catch (error) {
    return sendError(res, error, "Unable to update Demo - Tutorial file.");
  }
};

export const deleteDemoTutorial = async (req, res) => {
  try {
    if (!isSuperadmin(req)) {
      return res.status(403).json({
        success: false,
        error: "Only Superadmin can delete Demo - Tutorial files.",
      });
    }
    if (!isObjectId(req.params?.id)) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid Demo - Tutorial ID." });
    }

    const tutorial = await DemoTutorial.findById(req.params.id);
    if (!tutorial)
      return res
        .status(404)
        .json({ success: false, error: "Demo - Tutorial file not found." });

    await deleteDemoTutorialFileFromDrive(tutorial.driveFileId);
    await tutorial.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Demo - Tutorial file deleted successfully.",
      resourceId: String(tutorial._id),
    });
  } catch (error) {
    return sendError(res, error, "Unable to delete Demo - Tutorial file.");
  }
};

const loadDownloadableTutorial = async (req) => {
  if (!isObjectId(req.params?.id)) {
    throw Object.assign(new Error("Invalid Demo - Tutorial ID."), { status: 400 });
  }

  const tutorial = await DemoTutorial.findById(req.params.id).lean();
  if (!tutorial) {
    throw Object.assign(new Error("Demo - Tutorial file not found."), { status: 404 });
  }

  const role = roleOf(req);
  if (!canView(tutorial, role)) {
    throw Object.assign(
      new Error("You are not allowed to download this Demo - Tutorial file."),
      { status: 403 }
    );
  }
  return tutorial;
};

export const downloadDemoTutorial = async (req, res) => {
  try {
    const tutorial = await loadDownloadableTutorial(req);
    if (Number(tutorial.fileSize || 0) > DEMO_TUTORIAL_DOWNLOAD_CHUNK_BYTES) {
      return res.status(409).json({
        success: false,
        code: "CHUNKED_DOWNLOAD_REQUIRED",
        error: "Unable to download Demo - Tutorial file.",
      });
    }

    const stream = await getDemoTutorialDownloadStream(tutorial.driveFileId);
    const downloadName = clean(
      tutorial.driveFileName || tutorial.originalFileName || "tutorial-file"
    );
    const asciiName = downloadName
      .replace(/[^\x20-\x7E]+/g, "_")
      .replace(/["\\]/g, "_");

    res.setHeader(
      "Content-Type",
      tutorial.mimeType || "application/octet-stream"
    );
    if (Number(tutorial.fileSize || 0) > 0) {
      res.setHeader("Content-Length", String(tutorial.fileSize));
    }
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(
        downloadName
      )}`
    );
    res.setHeader("Cache-Control", "private, no-store");

    stream.on("error", (error) => {
      console.error(
        "[demoTutorial] download stream failed:",
        error?.message || error
      );
      if (!res.headersSent)
        res.status(502).json({
          success: false,
          error: "Unable to download file from Google Drive.",
        });
      else res.destroy(error);
    });
    stream.pipe(res);
  } catch (error) {
    if (res.headersSent) return res.end();
    return sendError(res, error, "Unable to download Demo - Tutorial file.");
  }
};

export const downloadDemoTutorialChunk = async (req, res) => {
  try {
    const tutorial = await loadDownloadableTutorial(req);
    const total = Number(tutorial.fileSize || 0);
    const start = Number.parseInt(req.query?.start, 10);
    const end = Number.parseInt(req.query?.end, 10);

    if (
      !Number.isSafeInteger(total) ||
      total <= 0 ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end >= total ||
      end - start + 1 > DEMO_TUTORIAL_DOWNLOAD_CHUNK_BYTES
    ) {
      throw badRequest("Unable to download Demo - Tutorial file.");
    }

    const data = await getDemoTutorialDownloadRange({
      fileId: tutorial.driveFileId,
      start,
      end,
    });
    const expectedLength = end - start + 1;
    if (data.length !== expectedLength) {
      throw Object.assign(new Error("Unable to download file from Google Drive."), {
        status: 502,
      });
    }

    res.status(206);
    res.setHeader(
      "Content-Type",
      tutorial.mimeType || "application/octet-stream"
    );
    res.setHeader("Content-Length", String(data.length));
    res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(data);
  } catch (error) {
    return sendError(res, error, "Unable to download Demo - Tutorial file.");
  }
};
