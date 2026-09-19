import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getBusinessTodayKey } from "../utils/dateRules.js";

const PAGE_WIDTH = 595.5;
const PAGE_HEIGHT = 842.25;
const PAGE_TOLERANCE = 4;
const TEMPLATE_ROWS = 13;

const COLOR_TEXT = rgb(0.05, 0.05, 0.05);
const COLOR_BLUE = rgb(3 / 255, 2 / 255, 126 / 255);
const COLOR_PEACH = rgb(1, 224 / 255, 177 / 255);

const clean = (value) => (value === undefined || value === null ? "" : String(value).trim());

const normalizeCourseName = (value) =>
  clean(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");

export const isMuballigaCourse = (course = {}) =>
  normalizeCourseName(course?.name) === "MUBALLIGA" || normalizeCourseName(course?.code) === "MUBALLIGA";

// Standard PDF fonts use WinAnsi. Normalize common punctuation/Latin diacritics,
// but never silently replace a student's official data with question marks.
// The supplied official template is English-only; if non-Latin data reaches this
// generator we stop and ask for the corresponding English value instead.
const toPdfLatinText = (value, fallback = "-") => {
  let text = clean(value);
  if (!text) return fallback;

  text = text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00A0/g, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (/[^\x20-\x7E]/.test(text)) {
    throw new Error(
      "Muballiga Individual marksheet contains non-Latin text that cannot be printed safely in the supplied English template. Please use the corresponding English value."
    );
  }

  return text || fallback;
};

const formatIssueDate = (dateKey = getBusinessTodayKey()) => {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
};

const formatPercentage = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  const text = number.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return `${text}%`;
};

const fitFontSize = (font, text, preferredSize, maxWidth, minSize = 5.8) => {
  let size = preferredSize;
  while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.2;
  return Math.max(minSize, size);
};

const baselineYForBox = (page, top, height, size) => {
  const baselineFromTop = top + (height + size * 0.72) / 2;
  return page.getHeight() - baselineFromTop;
};

const drawTextInBox = ({
  page,
  text,
  left,
  top,
  width,
  height,
  font,
  size = 8.5,
  minSize = 5.8,
  color = COLOR_TEXT,
  align = "center",
  padding = 4,
}) => {
  const value = toPdfLatinText(text);
  const availableWidth = Math.max(1, width - padding * 2);
  const finalSize = fitFontSize(font, value, size, availableWidth, minSize);
  const textWidth = font.widthOfTextAtSize(value, finalSize);

  let x = left + padding;
  if (align === "center") x = left + (width - textWidth) / 2;
  if (align === "right") x = left + width - padding - textWidth;

  page.drawText(value, {
    x: Math.max(left + 1, x),
    y: baselineYForBox(page, top, height, finalSize),
    size: finalSize,
    font,
    color,
  });
};

const splitTextToLines = (font, text, size, maxWidth, maxLines = 2) => {
  const words = toPdfLatinText(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["-"];

  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }

  if (lines.length < maxLines && current) lines.push(current);

  if (lines.length === maxLines) {
    const usedWords = lines.join(" ").split(/\s+/).length;
    if (usedWords < words.length) {
      let last = lines[maxLines - 1];
      const suffix = "...";
      while (last && font.widthOfTextAtSize(`${last}${suffix}`, size) > maxWidth) {
        last = last.slice(0, -1).trimEnd();
      }
      lines[maxLines - 1] = `${last}${suffix}`;
    }
  }

  return lines;
};

const drawWrappedTextInBox = ({
  page,
  text,
  left,
  top,
  width,
  height,
  font,
  size = 7.5,
  color = COLOR_TEXT,
  maxLines = 2,
  padding = 5,
}) => {
  const maxWidth = Math.max(1, width - padding * 2);
  let finalSize = size;
  let lines = splitTextToLines(font, text, finalSize, maxWidth, maxLines);

  while (finalSize > 5.8 && lines.some((line) => font.widthOfTextAtSize(line, finalSize) > maxWidth)) {
    finalSize -= 0.2;
    lines = splitTextToLines(font, text, finalSize, maxWidth, maxLines);
  }

  const lineHeight = finalSize + 1.5;
  const totalHeight = lines.length * lineHeight;
  let firstBaselineFromTop = top + (height - totalHeight) / 2 + finalSize;

  lines.forEach((line, index) => {
    const lineWidth = font.widthOfTextAtSize(line, finalSize);
    page.drawText(line, {
      x: left + Math.max(padding, (width - lineWidth) / 2),
      y: page.getHeight() - (firstBaselineFromTop + index * lineHeight),
      size: finalSize,
      font,
      color,
    });
  });
};

const fillTopRect = (page, { left, top, width, height, color = COLOR_PEACH }) => {
  page.drawRectangle({
    x: left,
    y: page.getHeight() - top - height,
    width,
    height,
    color,
    borderWidth: 0,
  });
};

const assertTemplatePage = (templatePdf) => {
  if (!templatePdf || templatePdf.getPageCount() < 1) {
    throw new Error("Muballiga Individual marksheet template has no page.");
  }

  const page = templatePdf.getPage(0);
  const width = page.getWidth();
  const height = page.getHeight();
  if (Math.abs(width - PAGE_WIDTH) > PAGE_TOLERANCE || Math.abs(height - PAGE_HEIGHT) > PAGE_TOLERANCE) {
    throw new Error(
      `Muballiga Individual template page size is invalid (${width.toFixed(1)} x ${height.toFixed(1)}). Expected A4 portrait.`
    );
  }
};

const ROW_BOXES = [
  { top: 290.0, height: 28.4 },
  { top: 320.2, height: 28.8 },
  { top: 350.5, height: 28.4 },
  { top: 380.7, height: 28.8 },
  { top: 411.0, height: 28.4 },
  { top: 441.2, height: 28.8 },
  { top: 471.5, height: 28.4 },
  { top: 501.7, height: 28.8 },
  { top: 531.8, height: 28.8 },
  { top: 562.1, height: 28.4 },
  { top: 592.1, height: 28.8 },
  { top: 622.5, height: 28.4 },
  { top: 652.5, height: 28.8 },
];

const drawMuballigaPage = ({ page, fonts, exam, record, issueDateKey }) => {
  const school = exam.schoolId || {};
  const student = record.studentId || {};
  const papers = Array.isArray(record.papers) ? record.papers : [];

  if (papers.length > TEMPLATE_ROWS) {
    throw new Error(`Muballiga Individual template supports at most ${TEMPLATE_ROWS} subject rows.`);
  }
  const nonHundredPaper = papers.find((paper) => Number(paper.maxMarks || 0) !== 100);
  if (nonHundredPaper) {
    throw new Error(
      `Muballiga Individual template says Marks Obtained For 100, but ${toPdfLatinText(nonHundredPaper.titleOfPaper || nonHundredPaper.subjectCode)} is configured for ${Number(nonHundredPaper.maxMarks || 0)} marks.`
    );
  }

  // The supplied PDF currently contains "HALF YEARLY" in the title artwork.
  // Cover only the title cell interior so the same official NORMAL template can
  // safely be used for Quarterly / Half Yearly / Annual without touching borders.
  fillTopRect(page, { left: 18.8, top: 91.7, width: 557.8, height: 22.6 });
  drawTextInBox({
    page,
    text: `STATEMENT OF MARKS - ${clean(exam.examType).toUpperCase()} EXAMINATION`,
    left: 20,
    top: 92.0,
    width: 555,
    height: 22,
    font: fonts.bold,
    size: 10.5,
    minSize: 8,
    color: COLOR_BLUE,
  });

  // Header data cells. Course name "MUBALLIGA" is already part of the official artwork.
  drawTextInBox({ page, text: student.userId?.name, left: 102.5, top: 115.0, width: 310.0, height: 30.3, font: fonts.bold, size: 9.0, minSize: 6.2 });
  drawTextInBox({ page, text: student.rollNumber, left: 469.0, top: 115.0, width: 107.5, height: 30.3, font: fonts.bold, size: 8.5, minSize: 6.0 });
  drawTextInBox({ page, text: Number(exam.studyingYear || 0) || "-", left: 269.5, top: 145.3, width: 33.5, height: 31.4, font: fonts.bold, size: 9.0, minSize: 7.0 });
  // No separate Batch field exists in the current UNIS marksheet/student schema.
  // Keep this official template cell blank rather than inventing a value.
  drawTextInBox({ page, text: formatIssueDate(issueDateKey), left: 468.9, top: 145.3, width: 107.6, height: 31.4, font: fonts.bold, size: 8.2, minSize: 6.0 });
  drawTextInBox({ page, text: school.nameEnglish, left: 102.5, top: 176.7, width: 310.2, height: 31.1, font: fonts.bold, size: 8.4, minSize: 5.8 });
  drawTextInBox({ page, text: school.code, left: 468.9, top: 176.7, width: 107.6, height: 31.1, font: fonts.bold, size: 8.1, minSize: 5.8 });
  drawWrappedTextInBox({ page, text: school.address, left: 102.5, top: 207.8, width: 474.0, height: 30.0, font: fonts.regular, size: 7.5, maxLines: 2 });

  papers.forEach((paper, index) => {
    const row = ROW_BOXES[index];
    if (!row) return;
    drawTextInBox({ page, text: paper.subjectCode, left: 18.0, top: row.top, width: 109.0, height: row.height, font: fonts.bold, size: 8.0, minSize: 5.8 });
    drawTextInBox({ page, text: paper.titleOfPaper, left: 136.0, top: row.top, width: 232.0, height: row.height, font: fonts.regular, size: 8.0, minSize: 5.8 });
    drawTextInBox({ page, text: paper.obtainedMarks ?? "-", left: 377.0, top: row.top, width: 128.0, height: row.height, font: fonts.bold, size: 8.6, minSize: 6.5 });
    drawTextInBox({ page, text: clean(paper.result) || "-", left: 514.0, top: row.top, width: 63.0, height: row.height, font: fonts.bold, size: 8.6, minSize: 6.5 });
  });

  // Replace the template placeholders only; preserve the official labels/artwork.
  fillTopRect(page, { left: 210.0, top: 700.0, width: 62.0, height: 23.0 });
  drawTextInBox({
    page,
    text: `${Number(record.totalObtainedMarks || 0)}/${Number(record.totalMaxMarks || 0)}`,
    left: 208.0,
    top: 699.5,
    width: 66.0,
    height: 23.5,
    font: fonts.bold,
    size: 9.0,
    minSize: 7.0,
  });

  fillTopRect(page, { left: 421.0, top: 709.5, width: 47.0, height: 20.5 });
  drawTextInBox({
    page,
    text: formatPercentage(record.percentage),
    left: 417.0,
    top: 708.5,
    width: 55.0,
    height: 22.0,
    font: fonts.bold,
    size: 8.5,
    minSize: 6.0,
  });

  fillTopRect(page, { left: 526.0, top: 709.5, width: 38.0, height: 20.5 });
  drawTextInBox({
    page,
    text: clean(record.result) === "Fail" ? "F" : record.grade,
    left: 522.0,
    top: 708.5,
    width: 46.0,
    height: 22.0,
    font: fonts.bold,
    size: 9.0,
    minSize: 7.0,
  });
};

export const fetchTemplatePdfBuffer = async (url) => {
  const response = await fetch(clean(url));
  if (!response.ok) {
    throw new Error(`Unable to load Muballiga Individual template PDF. Status: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.subarray(0, 5).toString("utf8").startsWith("%PDF-")) {
    throw new Error("Uploaded Muballiga Individual template is not a valid PDF.");
  }
  return buffer;
};

export const renderMuballigaIndividualExamPdfs = async ({ templateBuffer, exam, records, issueDateKey }) => {
  if (!isMuballigaCourse(exam?.courseId || {})) {
    throw new Error("Individual marksheet PDF layout is currently enabled only for Muballiga.");
  }

  const safeRecords = Array.isArray(records) ? records : [];
  if (safeRecords.length === 0) throw new Error("No finalized Muballiga marksheet records found.");

  const templatePdf = await PDFDocument.load(templateBuffer, { ignoreEncryption: false });
  assertTemplatePage(templatePdf);

  const combinedPdf = await PDFDocument.create();
  const fonts = {
    regular: await combinedPdf.embedFont(StandardFonts.Helvetica),
    bold: await combinedPdf.embedFont(StandardFonts.HelveticaBold),
  };

  for (const record of safeRecords) {
    const [page] = await combinedPdf.copyPages(templatePdf, [0]);
    combinedPdf.addPage(page);
    drawMuballigaPage({ page, fonts, exam, record, issueDateKey: issueDateKey || getBusinessTodayKey() });
  }

  const individual = [];
  for (let index = 0; index < safeRecords.length; index++) {
    const onePdf = await PDFDocument.create();
    const [page] = await onePdf.copyPages(combinedPdf, [index]);
    onePdf.addPage(page);
    const bytes = Buffer.from(await onePdf.save({ useObjectStreams: true }));
    individual.push({
      recordId: safeRecords[index]._id,
      studentId: safeRecords[index].studentId?._id || safeRecords[index].studentId || null,
      rollNumber: clean(safeRecords[index].studentId?.rollNumber),
      buffer: bytes,
    });
  }

  return {
    individual,
    combinedBuffer: Buffer.from(await combinedPdf.save({ useObjectStreams: true })),
  };
};
