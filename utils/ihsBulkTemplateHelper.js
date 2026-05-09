export const IHS_TEMPLATE_MAP = {
  "fundamentals of food": "69da390e124d7db702fd711b",
  "psychology and health": "69da3955124d7db702fd7127",
  "human resource": "69da3974124d7db702fd7133",
};

export const normalizeIhsType = (value = "") =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

export const getTemplateIdFromIhsType = (value = "") => {
  const key = normalizeIhsType(value);
  return IHS_TEMPLATE_MAP[key] || null;
};

export const buildIssueDateFromParts = ({ day, month, year }) => {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);

  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) {
    return null;
  }

  const date = new Date(y, m - 1, d);

  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    return null;
  }

  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");

  return {
    dateObj: date,
    issueDateText: `${dd}/${mm}/${y}`,
    isoDate: `${y}-${mm}-${dd}`,
  };
};

export const normalizeBulkIhsRow = (row = {}, index = 0) => {
  const rollNumber = String(row?.rollNumber || "").trim();
  const studentName = String(row?.name || "").trim();
  const guardianName = String(row?.fatherName || "").trim();
  const schoolName = String(row?.schoolName || "").trim();
  const ihsType = String(row?.ihs_type || "").trim();

  const templateId = getTemplateIdFromIhsType(ihsType);
  const issueMeta = buildIssueDateFromParts({
    day: row?.day,
    month: row?.month,
    year: row?.year,
  });

  const errors = [];

  if (!rollNumber) errors.push("rollNumber is required");
  if (!studentName) errors.push("name is required");
  if (!guardianName) errors.push("fatherName is required");
  if (!ihsType) errors.push("ihs_type is required");
  if (!templateId) errors.push(`Unknown ihs_type: ${ihsType}`);
  if (!issueMeta) errors.push("Invalid day / month / year");

  return {
    rowNumber: index + 1,
    rollNumber,
    studentName,
    guardianName,
    schoolName,
    ihsType,
    templateId,
    issueDateObj: issueMeta?.dateObj || null,
    issueDateText: issueMeta?.issueDateText || "",
    errors,
  };
};