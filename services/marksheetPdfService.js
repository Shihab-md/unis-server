import Template from "../models/Template.js";

export const MARKSHEET_PDF_STATUSES = ["Pending", "Generating", "Generated", "Failed"];

const clean = (value) => (value === undefined || value === null ? "" : String(value).trim());

export const buildPendingMarksheetPdfState = ({ requestedBy = null, requestedAt = new Date() } = {}) => ({
  status: "Pending",
  templateVersion: null,
  combinedDriveFileId: "",
  combinedFileName: "",
  combinedFileSize: 0,
  folderPath: "",
  individualGeneratedCount: 0,
  requestedBy: requestedBy || null,
  requestedAt,
  generatedAt: null,
  lastError: "",
});

export const getNormalMarksheetTemplateMap = async (courseIds = []) => {
  const ids = [...new Set((Array.isArray(courseIds) ? courseIds : []).map((id) => String(id || "")).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const templates = await Template.find({
    courseId: { $in: ids },
    templateModule: "MARKSHEET",
    marksheetType: "NORMAL",
  })
    .select("_id courseId template version updatedAt")
    .lean();

  return new Map(
    templates.map((template) => {
      const url = clean(template.template);
      const ready = Boolean(url && url !== "-" && /\.pdf(?:$|\?)/i.test(url));
      return [
        String(template.courseId),
        {
          ready,
          version: ready ? Number(template.version || 1) : null,
          updatedAt: template.updatedAt || null,
        },
      ];
    })
  );
};

export const getNormalMarksheetTemplateInfo = async (courseId) => {
  const map = await getNormalMarksheetTemplateMap([courseId]);
  return map.get(String(courseId || "")) || { ready: false, version: null, updatedAt: null };
};

const normalizeStoredPdfStatus = (exam = {}) => {
  if (clean(exam.status) !== "Finalized") return "";
  const stored = clean(exam?.marksheetPdf?.status);
  return MARKSHEET_PDF_STATUSES.includes(stored) ? stored : "Pending";
};

export const getMarksheetPdfSummary = (exam = {}, templateInfo = {}) => {
  if (clean(exam.status) !== "Finalized") return null;

  const stored = exam.marksheetPdf || {};
  const status = normalizeStoredPdfStatus(exam);
  const templateReady = Boolean(templateInfo?.ready);

  return {
    status,
    templateReady,
    templateVersion: stored.templateVersion ?? null,
    availableTemplateVersion: templateReady ? Number(templateInfo?.version || 1) : null,
    requestedAt: stored.requestedAt || exam.finalizedAt || null,
    generatedAt: stored.generatedAt || null,
    combinedFileName: clean(stored.combinedFileName),
    combinedFileSize: Number(stored.combinedFileSize || 0),
    individualGeneratedCount: Number(stored.individualGeneratedCount || 0),
    totalStudents: Number(exam.totalStudents || 0),
    lastError: status === "Failed" ? clean(stored.lastError) : "",
  };
};

export const getStudentMarksheetPdfSummary = (record = {}) => {
  const stored = record.marksheetPdf || {};
  const generated = Boolean(clean(stored.fileName) && stored.generatedAt);
  return {
    generated,
    fileName: generated ? clean(stored.fileName) : "",
    fileSize: generated ? Number(stored.fileSize || 0) : 0,
    templateVersion: generated ? stored.templateVersion ?? null : null,
    generatedAt: generated ? stored.generatedAt : null,
  };
};

export const sanitizeMarksheetExam = (exam = {}, templateInfo = {}) => {
  const response = { ...exam };
  response.marksheetPdf = getMarksheetPdfSummary(response, templateInfo);
  return response;
};

export const sanitizeMarksheetStudent = (record = {}) => {
  const response = { ...record };
  response.marksheetPdf = getStudentMarksheetPdfSummary(response);
  return response;
};
