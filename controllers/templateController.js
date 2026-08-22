import multer from "multer";
import { put } from "@vercel/blob";
import Template from "../models/Template.js";
import getRedis from "../db/redis.js"
import { toCamelCase } from "./commonController.js";

const upload = multer({ storage: multer.memoryStorage() });

const DEFAULT_CERTIFICATE_FEES = 75;

const normalizeCertificateFees = (value) => {
  if (value === undefined || value === null || value === "") return DEFAULT_CERTIFICATE_FEES;

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) return null;

  return numberValue;
};

const getTemplateFileMeta = (file) => {
  if (file?.mimetype === "application/pdf") {
    return { ext: "pdf", contentType: "application/pdf" };
  }

  if (file?.mimetype === "image/jpeg") {
    return { ext: "jpg", contentType: "image/jpeg" };
  }

  return { ext: "png", contentType: "image/png" };
};

const refreshTemplatesCache = async () => {
  const redis = await getRedis();

  await redis.set("totalTemplates", await Template.countDocuments());

  const templatesList = await Template.find()
    .select("_id courseId certificateFees")
    .populate({ path: "courseId", select: "name" })
    .lean();

  await redis.set("templates", JSON.stringify(templatesList), { EX: 60 * 30 });
};

const addTemplate = async (req, res) => {
  let newTemplate;

  try {
    const { courseId, details } = req.body;
    const certificateFees = normalizeCertificateFees(req.body?.certificateFees);

    if (!courseId) {
      return res
        .status(400)
        .json({ success: false, error: "courseId is required" });
    }

    if (certificateFees === null) {
      return res.status(400).json({
        success: false,
        error: "Certificate fees must be 0 or greater.",
      });
    }

    // ✅ Check duplicate before create
    const existingTemplate = await Template.findOne({ courseId })
      .select("_id courseId")
      .lean();

    if (existingTemplate) {
      return res.status(400).json({
        success: false,
        error: "Already record found for this course.",
      });
    }

    newTemplate = new Template({
      courseId,
      details: toCamelCase(details),
      certificateFees,
      template: "-",
    });

    newTemplate = await newTemplate.save();

    if (req.file) {
      const fileBuffer = req.file.buffer;
      const { ext, contentType } = getTemplateFileMeta(req.file);

      const blob = await put(`templates/${newTemplate._id}.${ext}`, fileBuffer, {
        access: "public",
        contentType,
        token: process.env.BLOB_READ_WRITE_TOKEN,
        allowOverwrite: true,
      });

      const template = await Template.findByIdAndUpdate(
        newTemplate._id,
        { template: blob.downloadUrl, updatedAt: new Date() },
        { new: true }
      );

      if (!template) {
        return res
          .status(404)
          .json({ success: false, error: "Template not found." });
      }
    }

    await refreshTemplatesCache();

    return res.status(200).json({
      success: true,
      message: "Template Created Successfully.",
    });
  } catch (error) {
    if (newTemplate) {
      await Template.deleteOne({ _id: newTemplate._id });
      await refreshTemplatesCache().catch(() => null);
    }

    console.log(error);

    // ✅ In case duplicate happens from race condition / unique index
    if (error?.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "Already record found for this course.",
      });
    }

    return res
      .status(500)
      .json({ success: false, error: "server error in adding template" });
  }
};

const getTemplates = async (req, res) => {
  try {
    const templates = await Template.find()
      .select("details certificateFees")
      .populate({ path: "courseId", select: "code name", sort: "code" });

    return res.status(200).json({ success: true, templates });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get templates server error" });
  }
};

const getTemplatesFromCache = async (req, res) => {
  try {
    const redis = await getRedis();
    const cachedTemplates = JSON.parse(await redis.get("templates"));

    if (Array.isArray(cachedTemplates)) {
      return res.status(200).json({ success: true, templates: cachedTemplates });
    }

    const templates = await Template.find()
      .select("_id courseId certificateFees")
      .populate({ path: "courseId", select: "name" })
      .lean();

    await redis.set("templates", JSON.stringify(templates), { EX: 60 * 30 });

    return res.status(200).json({ success: true, templates });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get templates server error" });
  }
};

const getTemplate = async (req, res) => {
  const { id } = req.params;
  try {
    let template = await Template.findById({ _id: id })
      .populate({ path: "courseId", select: "name" });

    return res.status(200).json({ success: true, template });

  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "Get template server error" });
  }
};

const updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { details } = req.body;
    const certificateFees = normalizeCertificateFees(req.body?.certificateFees);

    if (certificateFees === null) {
      return res.status(400).json({
        success: false,
        error: "Certificate fees must be 0 or greater.",
      });
    }

    const template = await Template.findById({ _id: id });
    if (!template) {
      return res
        .status(404)
        .json({ success: false, error: "Template not found." });
    }

    const updateData = {
      details: toCamelCase(details),
      certificateFees,
      updatedAt: new Date(),
    };

    if (req.file) {
      const fileBuffer = req.file.buffer;
      const { ext, contentType } = getTemplateFileMeta(req.file);

      const blob = await put(`templates/${id}.${ext}`, fileBuffer, {
        access: "public",
        contentType,
        token: process.env.BLOB_READ_WRITE_TOKEN,
        allowOverwrite: true,
      });

      updateData.template = blob.downloadUrl;
    }

    const updateTemplate = await Template.findByIdAndUpdate(
      { _id: id },
      updateData,
      { new: true }
    );

    if (!updateTemplate) {
      return res
        .status(404)
        .json({ success: false, error: "Document not Updated" });
    }

    await refreshTemplatesCache();

    return res.status(200).json({ success: true, message: "Template details updated Successfully." })

  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "Update templates server error" });
  }
};

const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const deleteTemplate = await Template.findById({ _id: id })

    if (!deleteTemplate) {
      return res.status(404).json({ success: false, error: "Template not found" });
    }

    await deleteTemplate.deleteOne();
    await refreshTemplatesCache();

    return res.status(200).json({ success: true, updateTemplate: deleteTemplate })
  } catch (error) {
    return res.status(500).json({ success: false, error: "Delete Template server error" })
  }
}

export { addTemplate, upload, getTemplates, getTemplate, updateTemplate, deleteTemplate, getTemplatesFromCache };
