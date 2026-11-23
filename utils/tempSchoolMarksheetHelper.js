import { randomUUID } from "node:crypto";

export const TEMP_SCHOOL_MARKSHEET_HEADERS = [
  "exam", "acYear", "regNumber", "name", "course", "niswanCode",
  "niswanName", "address",
  "subName1", "mark1", "result1", "subName2", "mark2", "result2",
  "subName3", "mark3", "result3", "subName4", "mark4", "result4",
  "subName5", "mark5", "result5", "subName6", "mark6", "result6",
  "day", "month", "year", "grade", "remarks",
];

// Printable values are text. Null/undefined become blank; numeric zero survives.
export const toUpperPrintable = (value) =>
  String(value ?? "").replace(/\r\n?/g, "\n").trim().toUpperCase();

const formatNumber = (value) => {
  if (!Number.isFinite(value)) return "";
  const fixed = value.toFixed(2);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
};

// Recognition for arithmetic only: every original mark still prints unchanged.
// Letters, blank marks and other nonnumeric text contribute zero, without errors.
const numericMarkForTotal = (value) => {
  let text = String(value ?? "").trim();
  if (text.includes(",")) {
    const groupedNumber = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d*)?(?:e[+-]?\d+)?$/i;
    if (!groupedNumber.test(text)) return 0;
    text = text.replace(/,/g, "");
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return 0;
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
};

// Combine the supplied date parts without parsing or checking the calendar.
export const buildIssueDateFromParts = ({ day, month, year } = {}) => {
  const parts = [day, month, year].map(toUpperPrintable);
  return {
    dateKey: parts.some(Boolean) ? [...parts].reverse().join("-") : "",
    displayText: parts.some(Boolean) ? parts.join("/") : "",
  };
};

const buildSafeFileName = (studentName) => {
  const safe = toUpperPrintable(studentName)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .replace(/_+/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return `${safe || `TEMP-SCHOOL-MARKSHEET-${randomUUID().toUpperCase()}`}.PDF`;
};

export const normalizeTempSchoolMarksheetRow = (row = {}, index = 0) => {
  const sourceRowNumber = Number(row?.sourceRowNumber) || index + 2;
  const studentName = toUpperPrintable(row?.name);
  const issueDate = buildIssueDateFromParts({ day: row?.day, month: row?.month, year: row?.year });

  // Always retain all six positions, including wholly/partially empty subjects.
  const subjects = Array.from({ length: 6 }, (_, index) => {
    const slot = index + 1;
    const markText = toUpperPrintable(row?.[`mark${slot}`]);
    return {
      slot,
      name: toUpperPrintable(row?.[`subName${slot}`]),
      mark: markText,
      markText,
      result: toUpperPrintable(row?.[`result${slot}`]),
    };
  });

  // Count populated slots, never the six placeholder rows or their highest slot.
  const populatedSubjects = subjects.filter((subject) =>
    Boolean(subject.name || subject.markText || subject.result)
  );
  const totalSubjects = populatedSubjects.length;
  const totalObtained = populatedSubjects.reduce(
    (sum, subject) => sum + numericMarkForTotal(subject.markText), 0
  );
  const totalMaximum = totalSubjects * 100;
  const percentage = totalMaximum > 0 ? (totalObtained / totalMaximum) * 100 : 0;

  return {
    sourceRowNumber,
    exam: toUpperPrintable(row?.exam),
    acYear: toUpperPrintable(row?.acYear),
    regNumber: toUpperPrintable(row?.regNumber),
    studentName,
    course: toUpperPrintable(row?.course),
    niswanCode: toUpperPrintable(row?.niswanCode),
    niswanName: toUpperPrintable(row?.niswanName),
    address: toUpperPrintable(row?.address),
    issueDateText: issueDate.displayText,
    issueDateKey: issueDate.dateKey,
    grade: toUpperPrintable(row?.grade),
    remarks: toUpperPrintable(row?.remarks),
    subjects,
    // No subject data means blank summary boxes; otherwise calculate as before.
    totalSubjects: totalSubjects || "",
    totalObtained,
    totalMaximum,
    totalMarksText: totalMaximum > 0 ? `${formatNumber(totalObtained)}/${totalMaximum}` : "",
    percentage,
    percentageText: totalMaximum > 0 ? `${formatNumber(percentage)}%` : "",
    fileName: buildSafeFileName(studentName),
  };
};
