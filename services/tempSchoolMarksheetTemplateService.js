import { PDFDocument } from "pdf-lib";

import Course from "../models/Course.js";
import Template from "../models/Template.js";

export const TEMP_SCHOOL_TEMPLATE_CONFIG = Object.freeze({
  courseCode: "SE-02",
  courseName: "7TH STANDARD",
  templateModule: "MARKSHEET",
  marksheetType: "NORMAL",
});

const normalizeUpper = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

const createTemplateError = (message, code = "TEMP_SCHOOL_TEMPLATE_ERROR", status = 409) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

// Intentionally follows the same uploaded-template pattern used by the
// existing certificate generator: fetch the PDF bytes from Template.template,
// then let pdf-lib copy the original PDF page and overlay vector text.
const fetchTemplatePdfBytes = async (templateUrl) => {
  const url = String(templateUrl || "").trim().replace("?download=1", "");
  if (!url) {
    throw createTemplateError(
      "SE-02 Normal Marksheet template PDF URL is missing. Please re-upload the template in Templates.",
      "TEMP_SCHOOL_TEMPLATE_URL_MISSING"
    );
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw createTemplateError(
      `Unable to download SE-02 Normal Marksheet template PDF (HTTP ${response.status}).`,
      "TEMP_SCHOOL_TEMPLATE_DOWNLOAD_FAILED"
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || !bytes.subarray(0, 5).toString("utf8").startsWith("%PDF-")) {
    throw createTemplateError(
      "SE-02 Normal Marksheet template is not a valid PDF file.",
      "TEMP_SCHOOL_TEMPLATE_INVALID_PDF"
    );
  }

  try {
    const pdf = await PDFDocument.load(bytes);
    if (pdf.getPageCount() !== 1) {
      throw createTemplateError(
        `SE-02 Normal Marksheet template must contain exactly 1 page. Found ${pdf.getPageCount()} pages.`,
        "TEMP_SCHOOL_TEMPLATE_PAGE_COUNT"
      );
    }
  } catch (error) {
    if (error?.code?.startsWith?.("TEMP_SCHOOL_TEMPLATE_")) throw error;
    throw createTemplateError(
      `SE-02 Normal Marksheet template PDF cannot be opened: ${error?.message || "invalid PDF"}`,
      "TEMP_SCHOOL_TEMPLATE_INVALID_PDF"
    );
  }

  return bytes;
};

const findConfiguredCourse = async () => {
  let course = await Course.findOne({ code: TEMP_SCHOOL_TEMPLATE_CONFIG.courseCode })
    .select("_id code name type")
    .lean();

  if (!course) {
    course = await Course.findOne({
      code: { $regex: `^${TEMP_SCHOOL_TEMPLATE_CONFIG.courseCode}$`, $options: "i" },
    })
      .select("_id code name type")
      .lean();
  }

  if (!course) {
    throw createTemplateError(
      `Course ${TEMP_SCHOOL_TEMPLATE_CONFIG.courseCode} was not found.`,
      "TEMP_SCHOOL_COURSE_NOT_FOUND"
    );
  }

  if (normalizeUpper(course.code) !== TEMP_SCHOOL_TEMPLATE_CONFIG.courseCode) {
    throw createTemplateError(
      `Configured course code mismatch. Expected ${TEMP_SCHOOL_TEMPLATE_CONFIG.courseCode}.`,
      "TEMP_SCHOOL_COURSE_MISMATCH"
    );
  }

  if (normalizeUpper(course.name) !== TEMP_SCHOOL_TEMPLATE_CONFIG.courseName) {
    throw createTemplateError(
      `Course ${TEMP_SCHOOL_TEMPLATE_CONFIG.courseCode} must be named ${TEMP_SCHOOL_TEMPLATE_CONFIG.courseName}. Current name: ${course.name || "(blank)"}.`,
      "TEMP_SCHOOL_COURSE_MISMATCH"
    );
  }

  return course;
};

export const resolveTempSchoolMarksheetTemplate = async ({
  expectedVersion = null,
  includePdfBytes = true,
} = {}) => {
  const course = await findConfiguredCourse();

  const templates = await Template.find({
    courseId: course._id,
    templateModule: TEMP_SCHOOL_TEMPLATE_CONFIG.templateModule,
    marksheetType: TEMP_SCHOOL_TEMPLATE_CONFIG.marksheetType,
  })
    .select("_id courseId template details version templateModule marksheetType")
    .lean();

  if (templates.length === 0) {
    throw createTemplateError(
      `Normal Marksheet template is not uploaded for ${TEMP_SCHOOL_TEMPLATE_CONFIG.courseCode} - ${TEMP_SCHOOL_TEMPLATE_CONFIG.courseName}.`,
      "TEMP_SCHOOL_TEMPLATE_NOT_FOUND"
    );
  }

  if (templates.length > 1) {
    throw createTemplateError(
      `Multiple Normal Marksheet templates were found for ${TEMP_SCHOOL_TEMPLATE_CONFIG.courseCode}. Please fix the Templates collection before printing.`,
      "TEMP_SCHOOL_TEMPLATE_DUPLICATE"
    );
  }

  const template = templates[0];
  const version = Number(template.version || 1);

  const requestedVersion =
    expectedVersion === null || expectedVersion === undefined || expectedVersion === ""
      ? null
      : Number(expectedVersion);

  if (requestedVersion !== null) {
    if (!Number.isInteger(requestedVersion) || requestedVersion < 1) {
      throw createTemplateError(
        "Invalid template version supplied by the client.",
        "TEMP_SCHOOL_TEMPLATE_VERSION_INVALID",
        400
      );
    }

    if (requestedVersion !== version) {
      throw createTemplateError(
        `The SE-02 Normal Marksheet template changed during processing (expected version ${requestedVersion}, current version ${version}). Please restart the import so every PDF uses one template version.`,
        "TEMP_SCHOOL_TEMPLATE_VERSION_CHANGED",
        409
      );
    }
  }

  const info = {
    templateId: String(template._id),
    version,
    courseId: String(course._id),
    courseCode: normalizeUpper(course.code),
    courseName: normalizeUpper(course.name),
    templateModule: template.templateModule,
    marksheetType: template.marksheetType,
    details: String(template.details || "").trim(),
  };

  const templatePdfBytes = includePdfBytes
    ? await fetchTemplatePdfBytes(template.template)
    : null;

  return {
    course,
    template,
    info,
    templatePdfBytes,
  };
};
