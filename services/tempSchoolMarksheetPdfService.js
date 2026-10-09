import { PDFDocument, StandardFonts, rgb, beginText, endText, setCharacterSpacing, setWordSpacing } from "pdf-lib";
import "regenerator-runtime/runtime.js";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";

const TEXT_COLOR = rgb(3 / 255, 2 / 255, 126 / 255);
//const TEXT_COLOR = rgb(0, 0, 0);
const GLOBAL_Y_OFFSET = -7.5;

const LAYOUT = {
  exam: { x: 245, yTop: 90, width: 261, height: 25, size: 10.5, minSize: 7.5, align: "center", maxLines: 1 },

  studentName: { x: 105, yTop: 116, width: 270, height: 28, size: 11, minSize: 7, align: "center", maxLines: 1 },
  regNumber: { x: 471, yTop: 116, width: 103, height: 28, size: 11, minSize: 7, align: "center", maxLines: 1 },

  course: { x: 105, yTop: 147, width: 270, height: 28, size: 11, minSize: 6.5, align: "center", maxLines: 1 },
  acYear: { x: 471, yTop: 147, width: 103, height: 28, size: 10.5, minSize: 7, align: "center", maxLines: 1 },

  niswanName: { x: 105, yTop: 178, width: 270, height: 28, size: 9, minSize: 6.2, align: "center", maxLines: 2 }, // 8.7
  niswanCode: { x: 471, yTop: 178, width: 103, height: 28, size: 10.5, minSize: 7, align: "center", maxLines: 1 },

  address: { x: 105, yTop: 209, width: 468, height: 27, size: 11, minSize: 6.2, align: "center", maxLines: 2 },

  subjectRows: [
    { yTop: 296, height: 34.5 },
    { yTop: 339.5, height: 34.5 },
    { yTop: 382.5, height: 35 },
    { yTop: 426, height: 34.5 },
    { yTop: 469.5, height: 34.5 },
    { yTop: 513, height: 34.5 },
  ],
  subjectName: { x: 22, width: 342, size: 11, minSize: 6.5, align: "center", maxLines: 2 },
  subjectMark: { x: 380, width: 120, size: 11, minSize: 8, align: "center", maxLines: 1 },
  subjectResult: { x: 516, width: 57, size: 11, minSize: 8, align: "center", maxLines: 1 },

  issueDate: { x: 20, yTop: 711, width: 99, height: 24, size: 11, minSize: 7, align: "center", maxLines: 1 },
  totalSubjects: { x: 123, yTop: 711, width: 111, height: 24, size: 11, minSize: 8, align: "center", maxLines: 1 },
  totalMarks: { x: 238, yTop: 711, width: 111, height: 24, size: 11, minSize: 7.5, align: "center", maxLines: 1 },
  percentage: { x: 353.5, yTop: 711, width: 111, height: 24, size: 11, minSize: 7.5, align: "center", maxLines: 1 },
  grade: { x: 468.5, yTop: 711, width: 105, height: 24, size: 11, minSize: 8, align: "center", maxLines: 1 },

  remarks: { x: 24, yTop: 760, width: 267, height: 55, size: 11, minSize: 6.2, align: "center", maxLines: 4 },
};

const FONT_FILES = [
  [new URL("../assets/fonts/NotoSans-Regular.ttf", import.meta.url), new URL("../assets/fonts/NotoSans-Bold.ttf", import.meta.url)],
  [new URL("../assets/fonts/NotoSansTamil-Regular.ttf", import.meta.url), new URL("../assets/fonts/NotoSansTamil-Bold.ttf", import.meta.url)],
  [new URL("../assets/fonts/NotoSansArabic-Regular.ttf", import.meta.url), new URL("../assets/fonts/NotoSansArabic-Bold.ttf", import.meta.url)],
];
let fallbackFontBytes;
const loadFallbackFontBytes = () => {
  if (!fallbackFontBytes) {
    fallbackFontBytes = Promise.all(FONT_FILES.map(
      (pair) => Promise.all(pair.map((url) => readFile(url)))
    )).catch((error) => { fallbackFontBytes = null; throw error; });
  }
  return fallbackFontBytes;
};

const makeFontChoice = (font) => ({ font, characters: new Set(font.getCharacterSet()) });
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const splitFontRuns = (value, choices) => {
  const runs = [];
  for (const { segment } of graphemes.segment(value)) {
    const choice = choices.find(({ characters }) =>
      Array.from(segment).every((character) => characters.has(character.codePointAt(0)))
    );
    if (!choice) {
      // This is a rendering/font failure, not a student/marks validation rule.
      throw new Error("The PDF fonts cannot render some supplied characters. Add a font supporting those characters.");
    }
    const previous = runs[runs.length - 1];
    if (previous?.font === choice.font) previous.text += segment;
    else runs.push({ font: choice.font, text: segment });
  }
  return runs;
};
const measureText = (text, choices, size) => splitFontRuns(text, choices).reduce(
  (width, run) => width + run.font.widthOfTextAtSize(run.text, size), 0
);

const wrapText = (choices, text, size, maxWidth) => {
  const lines = [];
  for (const paragraph of text.replace(/\t/g, " ").split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(""); continue; }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measureText(candidate, choices, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) { lines.push(current); current = ""; }
      // Split an unusually long word without dropping any of its characters.
      for (const { segment } of graphemes.segment(word)) {
        const next = current + segment;
        if (current && measureText(next, choices, size) > maxWidth) {
          lines.push(current);
          current = segment;
        } else current = next;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
};

const findTextLayout = ({ choices, text, width, height, size, maxLines }) => {
  for (let candidate = size; candidate >= 1; candidate -= 0.5) {
    const lines = wrapText(choices, text, candidate, width - 2);
    const lineHeight = candidate * 1.18;
    const totalHeight = lines.length * lineHeight;
    if (lines.length <= maxLines && totalHeight <= height - 2 &&
        lines.every((line) => measureText(line, choices, candidate) <= width - 2)) {
      return { lines, size: candidate, lineHeight, totalHeight };
    }
  }
  // Fit supplied text rather than rejecting a row or truncating its content.
  const oneLine = text.replace(/\s+/g, " ");
  const unitWidth = measureText(oneLine, choices, 1);
  const fittedSize = Math.min(size, (width - 2) / Math.max(unitWidth, 1), (height - 2) / 1.18);
  return { lines: [oneLine], size: fittedSize, lineHeight: fittedSize * 1.18, totalHeight: fittedSize * 1.18 };
};

const drawTextInBox = ({
  page, font, text, x, yTop, width, height, size,
  align = "left", maxLines = 1, color = TEXT_COLOR,
}) => {
  const value = String(text ?? "").trim();
  if (!value) return;
  const fitted = findTextLayout({ choices: font, text: value, width, height, size, maxLines });
  const topPadding = Math.max(0, (height - fitted.totalHeight) / 2);
  fitted.lines.forEach((line, index) => {
    const runs = splitFontRuns(line, font);
    const lineWidth = measureText(line, font, fitted.size);
    let drawX = x;
    if (align === "center") drawX += (width - lineWidth) / 2;
    if (align === "right") drawX += width - lineWidth;
    const baselineFromTop = yTop + GLOBAL_Y_OFFSET + topPadding + fitted.size + index * fitted.lineHeight;
    for (const run of runs) {
      page.drawText(run.text, {
        x: drawX, y: page.getHeight() - baselineFromTop,
        size: fitted.size, font: run.font, color,
      });
      drawX += run.font.widthOfTextAtSize(run.text, fitted.size);
    }
  });
};

export const buildTempSchoolMarksheetPdf = async ({ row, templatePdfBytes }) => {
  if (!Buffer.isBuffer(templatePdfBytes) || templatePdfBytes.length === 0) {
    throw new Error("Temp School Marksheet template PDF bytes are missing");
  }

  // Same method as the certificate generator: load uploaded template bytes,
  // copy its original PDF page, then overlay actual selectable PDF text.
  const sourcePdf = await PDFDocument.load(templatePdfBytes);
  if (sourcePdf.getPageCount() !== 1) {
    throw new Error(`Temp School Marksheet template must contain exactly 1 page`);
  }

  const outputPdf = await PDFDocument.create();
  const [page] = await outputPdf.copyPages(sourcePdf, [0]);
  outputPdf.addPage(page);
  // Uploaded PDF artwork can leave text spacing set in its content stream.
  // Reset it before drawing so fitting measurements match the printed text.
  page.pushOperators(beginText(), setCharacterSpacing(0), setWordSpacing(0), endText());

  const regular = await outputPdf.embedFont(StandardFonts.Helvetica);
  const bold = await outputPdf.embedFont(StandardFonts.HelveticaBold);
  const font = [makeFontChoice(regular)];
  const fontBold = [makeFontChoice(bold)];
  const texts = [
    row.exam, row.studentName, row.regNumber, row.course, row.acYear,
    row.niswanName, row.niswanCode, row.address, row.issueDateText,
    row.totalSubjects, row.totalMarksText, row.percentageText, row.grade, row.remarks,
    ...row.subjects.flatMap((subject) => [subject.name, subject.markText, subject.result]),
  ];
  const needsFallback = texts.some((text) => Array.from(String(text ?? "")).some(
    (character) => character !== "\n" && character !== "\t" &&
      !font[0].characters.has(character.codePointAt(0))
  ));
  if (needsFallback) {
    outputPdf.registerFontkit(fontkit);
    for (const [regularBytes, boldBytes] of await loadFallbackFontBytes()) {
      font.push(makeFontChoice(await outputPdf.embedFont(regularBytes, { subset: true })));
      fontBold.push(makeFontChoice(await outputPdf.embedFont(boldBytes, { subset: true })));
    }
  }

  drawTextInBox({ page, font: fontBold, text: row.exam, ...LAYOUT.exam, label: "Exam" });
  drawTextInBox({ page, font, text: row.studentName, ...LAYOUT.studentName, label: "Student name" });
  drawTextInBox({ page, font, text: row.regNumber, ...LAYOUT.regNumber, label: "Register number" });
  drawTextInBox({ page, font, text: row.course, ...LAYOUT.course, label: "Course" });
  drawTextInBox({ page, font, text: row.acYear, ...LAYOUT.acYear, label: "Academic year" });
  drawTextInBox({ page, font, text: row.niswanName, ...LAYOUT.niswanName, label: "Niswan name" });
  drawTextInBox({ page, font, text: row.niswanCode, ...LAYOUT.niswanCode, label: "Niswan code" });
  drawTextInBox({ page, font, text: row.address, ...LAYOUT.address, label: "Niswan address" });

  row.subjects.slice(0, 6).forEach((subject, index) => {
    const rowLayout = LAYOUT.subjectRows[index];
    drawTextInBox({
      page,
      font,
      text: subject.name,
      x: LAYOUT.subjectName.x,
      yTop: rowLayout.yTop,
      width: LAYOUT.subjectName.width,
      height: rowLayout.height,
      size: LAYOUT.subjectName.size,
      minSize: LAYOUT.subjectName.minSize,
      align: LAYOUT.subjectName.align,
      maxLines: LAYOUT.subjectName.maxLines,
      label: `Subject ${index + 1} name`,
    });
    drawTextInBox({
      page,
      font,
      text: subject.markText,
      x: LAYOUT.subjectMark.x,
      yTop: rowLayout.yTop,
      width: LAYOUT.subjectMark.width,
      height: rowLayout.height,
      size: LAYOUT.subjectMark.size,
      minSize: LAYOUT.subjectMark.minSize,
      align: LAYOUT.subjectMark.align,
      maxLines: LAYOUT.subjectMark.maxLines,
      label: `Subject ${index + 1} mark`,
    });
    drawTextInBox({
      page,
      font,
      text: subject.result,
      x: LAYOUT.subjectResult.x,
      yTop: rowLayout.yTop,
      width: LAYOUT.subjectResult.width,
      height: rowLayout.height,
      size: LAYOUT.subjectResult.size,
      minSize: LAYOUT.subjectResult.minSize,
      align: LAYOUT.subjectResult.align,
      maxLines: LAYOUT.subjectResult.maxLines,
      label: `Subject ${index + 1} result`,
      color:
        String(subject.result).toUpperCase() === "F"
          ? rgb(1, 0, 0)
          : TEXT_COLOR,
    });
  });

  drawTextInBox({ page, font, text: row.issueDateText, ...LAYOUT.issueDate, label: "Date of issue" });
  drawTextInBox({ page, font, text: row.totalSubjects, ...LAYOUT.totalSubjects, label: "Total subjects" });
  drawTextInBox({ page, font, text: row.totalMarksText, ...LAYOUT.totalMarks, label: "Total marks" });
  drawTextInBox({ page, font, text: row.percentageText, ...LAYOUT.percentage, label: "Percentage" });
  drawTextInBox({ page, font, text: row.grade, ...LAYOUT.grade, label: "Grade" });
  drawTextInBox({ page, font, text: row.remarks, ...LAYOUT.remarks, label: "Remarks" });

  return Buffer.from(await outputPdf.save());
};
