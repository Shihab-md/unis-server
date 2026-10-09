import { randomUUID } from "node:crypto";

export const TEMP_SCHOOL_MARKSHEET_HEADERS = [
  "exam", "acYear", "regNumber", "name", "course", "niswanCode",
  "niswanName", "address",
  "subName1", "mark1", "result1", "subName2", "mark2", "result2",
  "subName3", "mark3", "result3", "subName4", "mark4", "result4",
  "subName5", "mark5", "result5", "subName6", "mark6", "result6",
  "day", "month", "year", "grade", "remarks",
  "totalSubjects", "totalMarks", "percentage",
];

// Printable values are text. Null/undefined become blank; numeric zero survives.
export const toUpperPrintable = (value) =>
  String(value ?? "").replace(/\r\n?/g, "\n").trim().toUpperCase();

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
    // Summary boxes also print supplied Excel text; no marks assumptions/calculation.
    totalSubjects: toUpperPrintable(row?.totalSubjects),
    totalMarksText: toUpperPrintable(row?.totalMarks),
    percentageText: toUpperPrintable(row?.percentage),
    fileName: buildSafeFileName(studentName),
  };
};
