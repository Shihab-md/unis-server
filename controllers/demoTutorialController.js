import mongoose from "mongoose";
import DemoTutorial, { DEMO_TUTORIAL_VIEW_ROLES } from "../models/DemoTutorial.js";
import {
  cleanupDemoTutorialTempFile,
  validateDemoTutorialFileSignature,
} from "../middleware/demoTutorialUpload.js";
import {
  deleteDemoTutorialFileFromDrive,
  getDemoTutorialDownloadStream,
  replaceDemoTutorialFileInDrive,
  uploadDemoTutorialFileToDrive,
} from "../services/demoTutorialDriveService.js";

const SUPERADMIN_ROLE = "superadmin";
const VIEW_ROLE_SET = new Set(DEMO_TUTORIAL_VIEW_ROLES);

const clean = (value) => (value === undefined || value === null ? "" : String(value).trim());
const roleOf = (req) => clean(req.user?.role).toLowerCase();
const isSuperadmin = (req) => roleOf(req) === SUPERADMIN_ROLE;
const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

  const normalized = [...new Set(values.map((role) => clean(role).toLowerCase()).filter(Boolean))];
  const invalid = normalized.filter((role) => !VIEW_ROLE_SET.has(role));
  if (invalid.length) {
    throw Object.assign(new Error(`Invalid visible role(s): ${invalid.join(", ")}`), { status: 400 });
  }
  if (!normalized.length) {
    throw Object.assign(new Error("Select at least one role that can view this Demo - Tutorial file."), { status: 400 });
  }
  return normalized;
};

const validateTextFields = ({ title, description }) => {
  const cleanTitle = clean(title).replace(/\s+/g, " ");
  const cleanDescription = clean(description);

  if (!cleanTitle) throw Object.assign(new Error("Title is required."), { status: 400 });
  if (cleanTitle.length > 160) throw Object.assign(new Error("Title must be 160 characters or fewer."), { status: 400 });
  if (cleanDescription.length > 3000) throw Object.assign(new Error("Description must be 3000 characters or fewer."), { status: 400 });

  return { title: cleanTitle, description: cleanDescription };
};

const canView = (tutorial, role) => {
  if (role === SUPERADMIN_ROLE) return true;
  if (!VIEW_ROLE_SET.has(role)) return false;
  return (tutorial.visibleRoles || []).includes(role);
};

const serializeTutorial = (tutorial, { includeRoles = true } = {}) => {
  const obj = typeof tutorial?.toObject === "function" ? tutorial.toObject() : { ...tutorial };
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

const sendError = (res, error, fallback = "Demo - Tutorial operation failed.") => {
  const status = Number(error?.status || 0);
  const message = clean(error?.message) || fallback;
  if (status >= 400 && status < 600) {
    return res.status(status).json({ success: false, error: message });
  }
  console.error("[demoTutorial]", error);
  return res.status(500).json({ success: false, error: fallback });
};

export const listDemoTutorials = async (req, res) => {
  try {
    const role = roleOf(req);
    if (role !== SUPERADMIN_ROLE && !VIEW_ROLE_SET.has(role)) {
      return res.status(403).json({ success: false, error: "Demo - Tutorial is not available for this role." });
    }

    const page = Math.max(1, Number.parseInt(req.query?.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query?.limit, 10) || 20));
    const search = clean(req.query?.search);

    const query = role === SUPERADMIN_ROLE ? {} : { visibleRoles: role };
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      query.$or = [{ title: regex }, { description: regex }, { driveFileName: regex }, { originalFileName: regex }];
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
      items: items.map((item) => serializeTutorial(item, { includeRoles: role === SUPERADMIN_ROLE })),
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
      return res.status(400).json({ success: false, error: "Invalid Demo - Tutorial ID." });
    }

    const tutorial = await DemoTutorial.findById(req.params.id).lean();
    if (!tutorial) return res.status(404).json({ success: false, error: "Demo - Tutorial file not found." });

    const role = roleOf(req);
    if (!canView(tutorial, role)) {
      return res.status(403).json({ success: false, error: "You are not allowed to view this Demo - Tutorial file." });
    }

    return res.status(200).json({
      success: true,
      item: serializeTutorial(tutorial, { includeRoles: role === SUPERADMIN_ROLE }),
    });
  } catch (error) {
    return sendError(res, error, "Unable to load Demo - Tutorial file.");
  }
};

export const createDemoTutorial = async (req, res) => {
  try {
    if (!isSuperadmin(req)) {
      return res.status(403).json({ success: false, error: "Only Superadmin can upload Demo - Tutorial files." });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: "PDF or video file is required." });
    }

    const fields = validateTextFields(req.body || {});
    const visibleRoles = normalizeVisibleRoles(req.body?.visibleRoles);
    const fileKind = await validateDemoTutorialFileSignature(req.file);

    const uploaded = await uploadDemoTutorialFileToDrive(req.file);
    let tutorial;
    try {
      tutorial = await DemoTutorial.create({
        ...fields,
        visibleRoles,
        fileKind,
        originalFileName: clean(req.file.originalname),
        ...uploaded,
        createdBy: req.user._id,
        updatedBy: req.user._id,
      });
    } catch (dbError) {
      try {
        await deleteDemoTutorialFileFromDrive(uploaded.driveFileId);
      } catch (cleanupError) {
        console.error("[demoTutorial] rollback Drive cleanup failed:", cleanupError?.message || cleanupError);
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
  } finally {
    await cleanupDemoTutorialTempFile(req.file);
  }
};

export const updateDemoTutorial = async (req, res) => {
  try {
    if (!isSuperadmin(req)) {
      return res.status(403).json({ success: false, error: "Only Superadmin can edit Demo - Tutorial files." });
    }
    if (!isObjectId(req.params?.id)) {
      return res.status(400).json({ success: false, error: "Invalid Demo - Tutorial ID." });
    }

    const tutorial = await DemoTutorial.findById(req.params.id);
    if (!tutorial) return res.status(404).json({ success: false, error: "Demo - Tutorial file not found." });

    const fields = validateTextFields(req.body || {});
    const visibleRoles = normalizeVisibleRoles(req.body?.visibleRoles);

    tutorial.title = fields.title;
    tutorial.description = fields.description;
    tutorial.visibleRoles = visibleRoles;
    tutorial.updatedBy = req.user._id;

    if (req.file) {
      const fileKind = await validateDemoTutorialFileSignature(req.file);
      const uploaded = await replaceDemoTutorialFileInDrive({
        fileId: tutorial.driveFileId,
        file: req.file,
      });

      tutorial.fileKind = fileKind;
      tutorial.originalFileName = clean(req.file.originalname);
      tutorial.driveFileName = uploaded.driveFileName;
      tutorial.mimeType = uploaded.mimeType;
      tutorial.fileSize = uploaded.fileSize;
      tutorial.driveFolderPath = uploaded.driveFolderPath;
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
  } finally {
    await cleanupDemoTutorialTempFile(req.file);
  }
};

export const deleteDemoTutorial = async (req, res) => {
  try {
    if (!isSuperadmin(req)) {
      return res.status(403).json({ success: false, error: "Only Superadmin can delete Demo - Tutorial files." });
    }
    if (!isObjectId(req.params?.id)) {
      return res.status(400).json({ success: false, error: "Invalid Demo - Tutorial ID." });
    }

    const tutorial = await DemoTutorial.findById(req.params.id);
    if (!tutorial) return res.status(404).json({ success: false, error: "Demo - Tutorial file not found." });

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

export const downloadDemoTutorial = async (req, res) => {
  try {
    if (!isObjectId(req.params?.id)) {
      return res.status(400).json({ success: false, error: "Invalid Demo - Tutorial ID." });
    }

    const tutorial = await DemoTutorial.findById(req.params.id).lean();
    if (!tutorial) return res.status(404).json({ success: false, error: "Demo - Tutorial file not found." });

    const role = roleOf(req);
    if (!canView(tutorial, role)) {
      return res.status(403).json({ success: false, error: "You are not allowed to download this Demo - Tutorial file." });
    }

    const stream = await getDemoTutorialDownloadStream(tutorial.driveFileId);
    const downloadName = clean(tutorial.driveFileName || tutorial.originalFileName || "tutorial-file");
    const asciiName = downloadName.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_");

    res.setHeader("Content-Type", tutorial.mimeType || "application/octet-stream");
    if (Number(tutorial.fileSize || 0) > 0) {
      res.setHeader("Content-Length", String(tutorial.fileSize));
    }
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
    );
    res.setHeader("Cache-Control", "private, no-store");

    stream.on("error", (error) => {
      console.error("[demoTutorial] download stream failed:", error?.message || error);
      if (!res.headersSent) res.status(502).json({ success: false, error: "Unable to download file from Google Drive." });
      else res.destroy(error);
    });
    stream.pipe(res);
  } catch (error) {
    if (res.headersSent) return res.end();
    return sendError(res, error, "Unable to download Demo - Tutorial file.");
  }
};
