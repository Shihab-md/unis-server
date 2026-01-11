import * as XLSX from "xlsx";

const escapeCsv = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // wrap if contains comma/quote/newline
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

export const sendCSV = (res, filename, rows, columns) => {
  const cols = columns || (rows?.[0] ? Object.keys(rows[0]) : []);
  const header = cols.join(",");
  const body = (rows || [])
    .map((r) => cols.map((c) => escapeCsv(r?.[c])).join(","))
    .join("\r\n");

  const csv = header + "\r\n" + body;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
  return res.status(200).send(csv);
};

export const sendXLSX = (res, filename, rows, sheetName = "Report") => {
  const ws = XLSX.utils.json_to_sheet(rows || []);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
  return res.status(200).send(buffer);
};

// Multiple sheets export
// sheets = [{ name: "KPIs", rows: [...] }, ...]
export const sendXLSXMulti = (res, filename, sheets = []) => {
  const wb = XLSX.utils.book_new();

  const safeSheets = Array.isArray(sheets) ? sheets : [];
  if (safeSheets.length === 0) {
    // at least one empty sheet
    const ws = XLSX.utils.json_to_sheet([]);
    XLSX.utils.book_append_sheet(wb, ws, "Report");
  } else {
    for (const s of safeSheets) {
      const name = (s?.name ? String(s.name) : "Report").slice(0, 31); // Excel limit
      const rows = Array.isArray(s?.rows) ? s.rows : [];
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, name || "Report");
    }
  }

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
  return res.status(200).send(buffer);
};

export function writeCsv(rows = []) {
  const headers = [
    "code",
    "nameEnglish",
    "district",
    "state",
    "totalStudents",
    "activeStudents",
    "graduatedStudents",
    "feesPaid",
    "unpaid",
  ];

  const escape = (v) => {
    const s = v === undefined || v === null ? "" : String(v);
    // wrap in quotes and escape quotes
    return `"${s.replace(/"/g, '""')}"`;
  };

  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r?.[h])).join(",")),
  ];

  return lines.join("\r\n");
}

export function writeXlsx(rows = [], sheetName = "Report") {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}