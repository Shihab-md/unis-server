import { getBusinessTodayKey } from "./dateRules.js";

export const TEMP_SCHOOL_MARKSHEET_HEADERS = [
  "exam",
  "acYear",
  "regNumber",
  "name",
  "course",
  "niswanCode",
  "niswanName",
  "address",
  "subName1",
  "mark1",
  "result1",
  "subName2",
  "mark2",
  "result2",
  "subName3",
  "mark3",
  "result3",
  "subName4",
  "mark4",
  "result4",
  "subName5",
  "mark5",
  "result5",
  "subName6",
  "mark6",
  "result6",
  "day",
  "month",
  "year",
  "grade",
  "remarks",
];

const asText = (value) => String(value ?? "").trim();

const normalizePrintableText = (value) =>
  asText(value)
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const toUpperPrintable = (value) => normalizePrintableText(value).toUpperCase();

const hasUnsupportedCharacters = (value) => /[^\x20-\x7E]/.test(String(value || ""));

const validatePrintableField = (value, label, errors, { required = false } = {}) => {
  const text = normalizePrintableText(value);
  if (!text) {
    if (required) errors.push(`${label} is required`);
    return "";
  }
  if (hasUnsupportedCharacters(text)) {
    errors.push(`${label} contains unsupported non-English characters`);
  }
  return text.toUpperCase();
};

const parseInteger = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
};

export const buildIssueDateFromParts = ({ day, month, year }) => {
  const d = parseInteger(day);
  const m = parseInteger(month);
  const y = parseInteger(year);

  if (d === null || m === null || y === null) return null;

  const utc = new Date(Date.UTC(y, m - 1, d));
  if (
    utc.getUTCFullYear() !== y ||
    utc.getUTCMonth() !== m - 1 ||
    utc.getUTCDate() !== d
  ) {
    return null;
  }

  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const yyyy = String(y).padStart(4, "0");
  const dateKey = `${yyyy}-${mm}-${dd}`;

  return {
    dateKey,
    displayText: `${dd}/${mm}/${yyyy}`,
  };
};

const formatNumber = (value, maxDecimals = 2) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const fixed = n.toFixed(maxDecimals);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
};

const normalizeResult = (value) => {
  const text = toUpperPrintable(value);
  if (text === "P" || text === "PASS") return "P";
  if (text === "F" || text === "FAIL") return "F";
  return "";
};

const buildSafeFileName = ({ regNumber, studentName }) => {
  const safe = `${toUpperPrintable(regNumber)}-${toUpperPrintable(studentName)}`
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .replace(/_+/g, "_")
    .trim()
    .replace(/[. ]+$/g, "");

  return `${safe || "TEMP-SCHOOL-MARKSHEET"}.PDF`;
};

export const normalizeTempSchoolMarksheetRow = (row = {}, index = 0) => {
  const errors = [];
  const sourceRowNumber = Number(row?.sourceRowNumber) || index + 2;

  const exam = validatePrintableField(row?.exam, "exam", errors, { required: true });
  const acYear = validatePrintableField(row?.acYear, "acYear", errors, { required: true });
  const regNumber = validatePrintableField(row?.regNumber, "regNumber", errors, { required: true });
  const studentName = validatePrintableField(row?.name, "name", errors, { required: true });
  const course = validatePrintableField(row?.course, "course", errors, { required: true });
  const niswanCode = validatePrintableField(row?.niswanCode, "niswanCode", errors, { required: true });
  const niswanName = validatePrintableField(row?.niswanName, "niswanName", errors, { required: true });
  const address = validatePrintableField(row?.address, "address", errors, { required: true });
  const grade = validatePrintableField(row?.grade, "grade", errors);
  const remarks = validatePrintableField(row?.remarks, "remarks", errors);

  const issueDate = buildIssueDateFromParts({
    day: row?.day,
    month: row?.month,
    year: row?.year,
  });

  if (!issueDate) {
    errors.push("Invalid day / month / year");
  } else if (issueDate.dateKey > getBusinessTodayKey()) {
    errors.push("Date of issue cannot be in the future");
  }

  const subjects = [];
  let foundGap = false;
  let anySubjectInput = false;

  for (let i = 1; i <= 6; i += 1) {
    const rawName = normalizePrintableText(row?.[`subName${i}`]);
    const rawMark = row?.[`mark${i}`];
    const rawResult = normalizePrintableText(row?.[`result${i}`]);
    const anyValue = Boolean(rawName || String(rawMark ?? "").trim() || rawResult);
    if (anyValue) anySubjectInput = true;

    if (!anyValue) {
      foundGap = true;
      continue;
    }

    if (foundGap) {
      errors.push(`Subject ${i} cannot be filled after a blank subject row`);
    }

    if (!rawName) errors.push(`subName${i} is required`);
    if (rawName && hasUnsupportedCharacters(rawName)) {
      errors.push(`subName${i} contains unsupported non-English characters`);
    }

    const mark = Number(rawMark);
    if (String(rawMark ?? "").trim() === "" || !Number.isFinite(mark)) {
      errors.push(`mark${i} must be a number`);
    } else if (mark < 0 || mark > 100) {
      errors.push(`mark${i} must be between 0 and 100`);
    }

    const result = normalizeResult(rawResult);
    if (!result) errors.push(`result${i} must be P, PASS, F or FAIL`);

    if (rawName && Number.isFinite(mark) && mark >= 0 && mark <= 100 && result) {
      subjects.push({
        name: rawName.toUpperCase(),
        mark,
        markText: formatNumber(mark),
        result,
      });
    }
  }

  if (!anySubjectInput) errors.push("At least one subject is required");

  const totalSubjects = subjects.length;
  const totalObtained = subjects.reduce((sum, subject) => sum + Number(subject.mark || 0), 0);
  const totalMaximum = totalSubjects * 100;
  const percentage = totalMaximum > 0 ? (totalObtained / totalMaximum) * 100 : 0;
  const totalMarksText = totalMaximum > 0
    ? `${formatNumber(totalObtained)}/${totalMaximum}`
    : "";
  const percentageText = totalMaximum > 0 ? `${formatNumber(percentage)}%` : "";

  return {
    sourceRowNumber,
    exam,
    acYear,
    regNumber,
    studentName,
    course,
    niswanCode,
    niswanName,
    address,
    issueDateText: issueDate?.displayText || "",
    issueDateKey: issueDate?.dateKey || "",
    grade,
    remarks,
    subjects,
    totalSubjects,
    totalObtained,
    totalMaximum,
    totalMarksText,
    percentage,
    percentageText,
    fileName: buildSafeFileName({ regNumber, studentName }),
    errors,
  };
};
