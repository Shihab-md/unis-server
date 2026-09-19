import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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

const wrapText = (font, text, size, maxWidth) => {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines = [];
  let current = "";

  for (const word of words) {
    if (font.widthOfTextAtSize(word, size) > maxWidth) return null;
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
};

const findTextLayout = ({ font, text, width, height, size, minSize, maxLines }) => {
  const value = String(text || "").trim();
  if (!value) return { lines: [], size };

  for (let candidate = size; candidate >= minSize - 0.001; candidate -= 0.5) {
    const lines = wrapText(font, value, candidate, width);
    if (!lines || lines.length > maxLines) continue;
    const lineHeight = candidate * 1.18;
    const totalHeight = lines.length * lineHeight;
    if (totalHeight <= height - 2) {
      return { lines, size: candidate, lineHeight, totalHeight };
    }
  }

  return null;
};

const drawTextInBox = ({
  page,
  font,
  text,
  x,
  yTop,
  width,
  height,
  size,
  minSize,
  align = "left",
  maxLines = 1,
  label = "Text",
  color = TEXT_COLOR,
}) => {
  const value = String(text || "").trim();
  if (!value) return;

  const fitted = findTextLayout({
    font,
    text: value,
    width,
    height,
    size,
    minSize,
    maxLines,
  });

  if (!fitted) {
    throw new Error(`${label} is too long for the PDF template`);
  }

  const { lines, size: finalSize, lineHeight, totalHeight } = fitted;
  const topPadding = Math.max(0, (height - totalHeight) / 2);

  lines.forEach((line, index) => {
    const lineWidth = font.widthOfTextAtSize(line, finalSize);
    let drawX = x;
    if (align === "center") drawX = x + (width - lineWidth) / 2;
    if (align === "right") drawX = x + width - lineWidth;

    const baselineFromTop = yTop + GLOBAL_Y_OFFSET + topPadding + finalSize + index * lineHeight;
    const drawY = page.getHeight() - baselineFromTop;

    // pdf-lib drawText creates vector/text PDF content. The source template
    // remains a PDF page; no page rasterization/image conversion is performed.
    page.drawText(line, {
      x: drawX,
      y: drawY,
      size: finalSize,
      font,
      color,
    });
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

  const font = await outputPdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await outputPdf.embedFont(StandardFonts.HelveticaBold);

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
  drawTextInBox({ page, font, text: String(row.totalSubjects), ...LAYOUT.totalSubjects, label: "Total subjects" });
  drawTextInBox({ page, font, text: row.totalMarksText, ...LAYOUT.totalMarks, label: "Total marks" });
  drawTextInBox({ page, font, text: row.percentageText, ...LAYOUT.percentage, label: "Percentage" });
  drawTextInBox({ page, font, text: row.grade, ...LAYOUT.grade, label: "Grade" });
  drawTextInBox({ page, font, text: row.remarks, ...LAYOUT.remarks, label: "Remarks" });

  return Buffer.from(await outputPdf.save());
};
