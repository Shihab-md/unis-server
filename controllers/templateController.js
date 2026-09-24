import multer from "multer";
import { put } from "@vercel/blob";
import { getBlobReadWriteToken } from "../utils/runtimeEnvironment.js";
import Template from "../models/Template.js";
import getRedis from "../db/redis.js";
import { toCamelCase } from "./commonController.js";

const upload = multer({ storage: multer.memoryStorage() });

const DEFAULT_CERTIFICATE_FEES = 75;
const TEMPLATE_MODULES = ["CERTIFICATE", "MARKSHEET"];
const MARKSHEET_TYPES = ["NORMAL", "CONSOLIDATED"];

const cleanString = (value) => (value === undefined || value === null ? "" : String(value).trim());

const normalizeTemplateModule = (value) => {
  const module = cleanString(value).toUpperCase();
  return TEMPLATE_MODULES.includes(module) ? module : "CERTIFICATE";
};

const normalizeMarksheetType = (value, templateModule = "CERTIFICATE") => {
  if (templateModule !== "MARKSHEET") return "";
  const type = cleanString(value).toUpperCase().replace(/[\s-]+/g, "_");
  if (type === "CONSOLIDATED") return "CONSOLIDATED";
  if (type === "NORMAL") return "NORMAL";
  return "NORMAL";
};

const normalizeCertificateFees = (value, templateModule = "CERTIFICATE") => {
  if (templateModule !== "CERTIFICATE") return 0;
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

const getTemplateDuplicateQuery = ({ courseId, templateModule, marksheetType }) => ({
  courseId,
  templateModule,
  marksheetType: templateModule === "MARKSHEET" ? marksheetType : "",
});

const refreshTemplatesCache = async () => {
  const redis = await getRedis();

  await redis.set("totalTemplates", await Template.countDocuments());

  const templatesList = await Template.find()
    .select("_id courseId certificateFees templateModule marksheetType template details version")
    .populate({ path: "courseId", select: "code name" })
    .lean();

  await redis.set("templates", JSON.stringify(templatesList), { EX: 60 * 30 });
};

const addTemplate = async (req, res) => {
  let newTemplate;

  try {
    const { courseId, details } = req.body;
    const templateModule = normalizeTemplateModule(req.body?.templateModule);
    const marksheetType = normalizeMarksheetType(req.body?.marksheetType, templateModule);
    const certificateFees = normalizeCertificateFees(req.body?.certificateFees, templateModule);

    if (!courseId) {
      return res
        .status(400)
        .json({ success: false, error: "courseId is required" });
    }

    if (!details) {
      return res.status(400).json({ success: false, error: "Details is required." });
    }

    if (certificateFees === null) {
      return res.status(400).json({
        success: false,
        error: "Certificate fees must be 0 or greater.",
      });
    }

    if (templateModule === "MARKSHEET" && !req.file) {
      return res.status(400).json({
        success: false,
        error: "Marksheet PDF template is required.",
      });
    }

    if (templateModule === "MARKSHEET" && req.file?.mimetype !== "application/pdf") {
      return res.status(400).json({
        success: false,
        error: "Marksheet template must be a PDF file.",
      });
    }

    const duplicateQuery = getTemplateDuplicateQuery({ courseId, templateModule, marksheetType });

    const existingTemplate = await Template.findOne(duplicateQuery)
      .select("_id courseId templateModule marksheetType")
      .lean();

    if (existingTemplate) {
      const label = templateModule === "MARKSHEET"
        ? `${marksheetType === "CONSOLIDATED" ? "Consolidated marksheet" : "Normal marksheet"} template`
        : "Certificate template";
      return res.status(400).json({
        success: false,
        error: `${label} already found for this course.`,
      });
    }

    newTemplate = new Template({
      courseId,
      details: toCamelCase(details),
      templateModule,
      marksheetType,
      certificateFees,
      template: "-",
      version: 1,
    });

    newTemplate = await newTemplate.save();

    if (req.file) {
      const fileBuffer = req.file.buffer;
      const { ext, contentType } = getTemplateFileMeta(req.file);
      const moduleFolder = templateModule === "MARKSHEET" ? `marksheet-${marksheetType.toLowerCase()}` : "certificate";

      const blob = await put(`templates/${moduleFolder}/${newTemplate._id}.${ext}`, fileBuffer, {
        access: "public",
        contentType,
        token: getBlobReadWriteToken(),
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

    if (error?.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "Already record found for this course and template type.",
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
      .select("details certificateFees templateModule marksheetType template version")
      .populate({ path: "courseId", select: "code name", sort: "code" })
      .sort({ templateModule: 1, marksheetType: 1, updatedAt: -1 })
      .lean();

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
      .select("_id courseId certificateFees templateModule marksheetType template details version")
      .populate({ path: "courseId", select: "code name" })
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
      .populate({ path: "courseId", select: "code name" });

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
    const template = await Template.findById({ _id: id });

    if (!template) {
      return res
        .status(404)
        .json({ success: false, error: "Template not found." });
    }

    const templateModule = normalizeTemplateModule(req.body?.templateModule || template.templateModule);
    const marksheetType = normalizeMarksheetType(req.body?.marksheetType || template.marksheetType, templateModule);
    const certificateFees = normalizeCertificateFees(req.body?.certificateFees, templateModule);

    if (certificateFees === null) {
      return res.status(400).json({
        success: false,
        error: "Certificate fees must be 0 or greater.",
      });
    }

    if (templateModule === "MARKSHEET" && req.file && req.file.mimetype !== "application/pdf") {
      return res.status(400).json({
        success: false,
        error: "Marksheet template must be a PDF file.",
      });
    }

    const duplicateQuery = {
      ...getTemplateDuplicateQuery({ courseId: template.courseId, templateModule, marksheetType }),
      _id: { $ne: id },
    };

    const duplicate = await Template.findOne(duplicateQuery).select("_id").lean();
    if (duplicate) {
      return res.status(400).json({
        success: false,
        error: "Already record found for this course and template type.",
      });
    }

    const currentVersion = Number(template.version || 1);
    const updateData = {
      details: toCamelCase(details),
      templateModule,
      marksheetType,
      certificateFees,
      version: req.file && templateModule === "MARKSHEET" ? currentVersion + 1 : currentVersion,
      updatedAt: new Date(),
    };

    if (req.file) {
      const fileBuffer = req.file.buffer;
      const { ext, contentType } = getTemplateFileMeta(req.file);
      const moduleFolder = templateModule === "MARKSHEET" ? `marksheet-${marksheetType.toLowerCase()}` : "certificate";

      const blob = await put(`templates/${moduleFolder}/${id}.${ext}`, fileBuffer, {
        access: "public",
        contentType,
        token: getBlobReadWriteToken(),
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

    return res.status(200).json({ success: true, message: "Template details updated Successfully." });

  } catch (error) {
    console.log(error);
    if (error?.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "Already record found for this course and template type.",
      });
    }
    return res
      .status(500)
      .json({ success: false, error: "Update templates server error" });
  }
};

const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const deleteTemplate = await Template.findById({ _id: id });

    if (!deleteTemplate) {
      return res.status(404).json({ success: false, error: "Template not found" });
    }

    await deleteTemplate.deleteOne();
    await refreshTemplatesCache();

    return res.status(200).json({ success: true, updateTemplate: deleteTemplate });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Delete Template server error" });
  }
};

export { addTemplate, upload, getTemplates, getTemplate, updateTemplate, deleteTemplate, getTemplatesFromCache };
