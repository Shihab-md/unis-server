import Numbering from "../models/Numbering.js";
import FeeStructure from "../models/FeeStructure.js";
import FeeInvoice from "../models/FeeInvoice.js";

export function toCamelCase(inputString) {
  if (!inputString) return null;

  const original = inputString.trim().replace(/\s+/g, " ");

  // Helper: title-case a single token, but keep all-caps acronyms as-is
  const titleCaseToken = (token) => {
    // Keep acronyms like UNIS, API, HR (2+ letters, all caps)
    if (/^[A-Z]{2,}$/.test(token)) return token;

    // ✅ Treat codes like "Un020006772" as code => "UN020006772"
    // (2+ letters followed by 1+ digits; no spaces)
    if (/^[A-Za-z]{2,}\d+$/.test(token)) return token.toUpperCase();

    // Otherwise normal Title Case
    const lower = token.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };

  // 1) Normalize spaces around dots (initials)
  let s = original.replace(/\s*\.\s*/g, ".");

  // 2) Fix initials blocks while preserving original letters:
  // "R. M." -> "R.M.", "r.m." -> "R.M.", "A.r.nasar" -> "A.R.Nasar"
  s = s.toLowerCase();

  // Uppercase sequences like "r.m." "a.r." etc.
  s = s.replace(/\b(?:[a-z]\.)+(?=[a-z])/g, (m) => m.toUpperCase());

  // Add a space if initials got glued to next word: "R.M.Salman" -> "R.M. Salman"
  s = s.replace(/(\b(?:[A-Z]\.)+)(?=[a-z])/g, "$1 ");

  // 3) Now rebuild word-by-word, preserving acronyms from the ORIGINAL input
  const originalTokens = original.split(" ");
  const processedTokens = s.split(" ");

  const out = processedTokens.map((tok, i) => {
    const origTok = originalTokens[i] ?? "";

    // Keep acronyms exactly as user typed if that original token was all-caps
    if (/^[A-Z]{2,}$/.test(origTok)) return origTok;

    // Also keep initials like "R.M." as-is
    if (/^(?:[A-Z]\.)+$/.test(tok)) return tok;

    // Title/case (includes code rule now)
    return titleCaseToken(tok);
  });

  return out.join(" ");
}

export const getNextNumber = async ({ name, prefix, pad } = {}) => {
  // Uses Numbering collection (same atomic pattern as Roll)
  const numbering = await Numbering.findOneAndUpdate(
    { name: name },
    { $inc: { currentNumber: 1 } },
    { new: true, upsert: true }
  );

  const n = Number(numbering?.currentNumber || 0);
  return `${prefix}${String(n).padStart(pad, "0")}`;
};

export const createInvoiceFromStructure = async ({
  schoolId,
  studentId,
  userId,
  acYear,
  academicId,
  courseId,
  source = "ADMISSION",
  dueDate,
  createdBy,
  session,
}) => {
  const structure =
    (await FeeStructure.findOne({ schoolId, acYear, courseId, active: "Active" }).session(session).lean()) ||
    (await FeeStructure.findOne({ schoolId: null, acYear, courseId, active: "Active" }).session(session).lean());

  if (!structure) {
    const err = new Error("FeeStructure not configured for this course/year");
    err.status = 400;
    throw err;
  }

  const items = structure.heads.map((h) => {
    const netAmount = Number(h.amount || 0);
    return {
      headCode: h.headCode,
      headName: h.headName,
      amount: netAmount,
      discount: 0,
      fine: 0,
      netAmount,
      paidAmount: 0,
    };
  });

  const total = items.reduce((s, x) => s + Number(x.netAmount || 0), 0);

  const invoiceNo = await getNextNumber({
    name: "Invoice",
    prefix: "INV",
    pad: 9,
    session,
  });

  const invoice = await FeeInvoice.create(
    [
      {
        invoiceNo,
        schoolId,
        studentId,
        userId,
        acYear,
        academicId,
        courseId,
        source,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        items,
        total,
        paidTotal: 0,
        balance: total,
        status: "ISSUED",
        createdBy,
      },
    ],
    { session }
  );

  return invoice[0];
};

export function parseDate(rawDate) {
  const fallback = new Date(2000, 0, 1);

  const monthMap = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };

  const isAlpha = (x) => /^[A-Za-z]+$/.test(String(x || ""));

  const toInt = (x) => {
    const n = Number(String(x));
    return Number.isInteger(n) ? n : NaN;
  };

  // ✅ Excel serial date -> JS Date (UTC)
  // Windows Excel: day 0 = 1899-12-30
  const excelSerialToDateUTC = (serial) => {
    const n = Number(serial);
    if (!Number.isFinite(n)) return null;

    // common DOB range sanity
    if (n < 1 || n > 80000) return null;

    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + Math.round(n) * 24 * 60 * 60 * 1000;
    const dt = new Date(ms);

    const y = dt.getUTCFullYear();
    if (y < 1900 || y > 2100) return null;

    return dt;
  };

  const parse = (input) => {
    if (input === null || input === undefined) {
      return { ok: false, reason: "empty" };
    }

    const inputStr = String(input).trim();

    // ✅ Pure numeric like 37258 => Excel serial
    const numeric = Number(inputStr);
    if (
      inputStr !== "" &&
      Number.isFinite(numeric) &&
      /^[0-9]+(\.0+)?$/.test(inputStr)
    ) {
      const dt = excelSerialToDateUTC(numeric);
      if (dt) return { ok: true, date: dt, reason: "excel_serial" };
      // fall through if not valid serial
    }

    let s = inputStr
      .replace(/\r/g, "")
      .replace(/\s+/g, "");

    if (!s) return { ok: false, reason: "empty" };

    // normalize separators to "-"
    s = s.replace(/[./]/g, "-");

    const parts = s.split("-").filter(Boolean);
    if (parts.length !== 3) {
      return { ok: false, reason: "expected 3 parts" };
    }

    const yearRaw = parts[2];
    let y = toInt(yearRaw);
    if (!Number.isInteger(y)) {
      return { ok: false, reason: "invalid year" };
    }

    // support 2-digit year
    if (String(yearRaw).length === 2) {
      y = y <= 49 ? 2000 + y : 1900 + y;
    }

    if (y < 1000 || y > 9999) {
      return { ok: false, reason: "invalid year" };
    }

    let d, m;

    // ✅ Handle month name formats
    if (isAlpha(parts[0])) {
      // MMM-DD-YYYY
      m = monthMap[parts[0].toLowerCase()];
      if (!m) return { ok: false, reason: "invalid month name" };

      d = toInt(parts[1]);
      if (!Number.isInteger(d) || d < 1 || d > 31) {
        return { ok: false, reason: "invalid day" };
      }
    } else if (isAlpha(parts[1])) {
      // DD-MMM-YYYY
      d = toInt(parts[0]);
      m = monthMap[parts[1].toLowerCase()];

      if (!Number.isInteger(d) || d < 1 || d > 31) {
        return { ok: false, reason: "invalid day" };
      }
      if (!m) return { ok: false, reason: "invalid month name" };
    } else {
      // ✅ Numeric date parsing with smart day/month swap
      const n1 = toInt(parts[0]);
      const n2 = toInt(parts[1]);

      if (!Number.isInteger(n1) || !Number.isInteger(n2)) {
        return { ok: false, reason: "invalid numeric date parts" };
      }

      // Rule:
      // - if first > 12 => DD-MM-YYYY
      // - else if second > 12 => MM-DD-YYYY
      // - else ambiguous => default DD-MM-YYYY
      if (n1 > 12) {
        d = n1;
        m = n2;
      } else if (n2 > 12) {
        d = n2;
        m = n1;
      } else {
        d = n1;
        m = n2;
      }
    }

    if (!Number.isInteger(d) || d < 1 || d > 31) {
      return { ok: false, reason: "invalid day" };
    }

    if (!Number.isInteger(m) || m < 1 || m > 12) {
      return { ok: false, reason: "invalid month" };
    }

    // validate actual calendar date
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== m - 1 ||
      dt.getUTCDate() !== d
    ) {
      return { ok: false, reason: "invalid calendar date" };
    }

    return { ok: true, date: dt, reason: "string_date" };
  };

  try {
    const r = parse(rawDate);
    return r.ok ? r.date : fallback;
  } catch {
    return fallback;
  }
}

{/*
export function parseDate(rawDate) {
  const fallback = new Date(2000, 0, 1);

  const monthMap = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };

  const isAlpha = (x) => /^[A-Za-z]+$/.test(x);

  const toInt = (x) => {
    const n = Number(String(x));
    return Number.isInteger(n) ? n : NaN;
  };

  // ✅ Excel serial date -> JS Date (UTC)
  // Windows Excel: day 0 = 1899-12-30 (accounts for Excel's 1900 leap-year bug)
  const excelSerialToDateUTC = (serial) => {
    const n = Number(serial);
    if (!Number.isFinite(n)) return null;

    // common DOB range sanity: roughly 1900..2100
    // Excel serial for 1900-01-01 ~ 2, for 2100-01-01 ~ 73049
    if (n < 1 || n > 80000) return null;

    const epoch = Date.UTC(1899, 11, 30); // 1899-12-30
    const ms = epoch + Math.round(n) * 24 * 60 * 60 * 1000;
    const dt = new Date(ms);

    // extra sanity
    const y = dt.getUTCFullYear();
    if (y < 1900 || y > 2100) return null;

    return dt;
  };

  const parse = (input) => {
    if (input === null || input === undefined) return { ok: false, reason: "empty" };

    // ✅ If it's a pure number (or numeric string) like "37258", treat as Excel serial
    const numeric = Number(String(input).trim());
    if (String(input).trim() !== "" && Number.isFinite(numeric) && /^[0-9]+(\.0+)?$/.test(String(input).trim())) {
      const dt = excelSerialToDateUTC(numeric);
      if (dt) return { ok: true, date: dt, reason: "excel_serial" };
      // fall through if not in range
    }

    let s = String(input)
      .trim()
      .replace(/\r/g, "")
      .replace(/\s+/g, "");

    if (!s) return { ok: false, reason: "empty" };

    // normalize separators to "-"
    s = s.replace(/[./]/g, "-");

    const parts = s.split("-").filter(Boolean);
    if (parts.length !== 3) return { ok: false, reason: "expected 3 parts" };

    // year: allow 2 or 4 digits
    const yearRaw = parts[2];
    let y = toInt(yearRaw);
    if (!Number.isInteger(y)) return { ok: false, reason: "invalid year" };

    if (String(yearRaw).length === 2) {
      y = y <= 49 ? 2000 + y : 1900 + y;
    }
    if (y < 1000 || y > 9999) return { ok: false, reason: "invalid year" };

    // DMY always for numeric. Also accept month-name-first.
    let d, m;

    if (isAlpha(parts[0])) {
      // MMM-DD-YYYY => treat as DD-MMM-YYYY
      m = monthMap[parts[0].toLowerCase()];
      if (!m) return { ok: false, reason: "invalid month name" };
      d = toInt(parts[1]);
    } else {
      d = toInt(parts[0]);

      if (isAlpha(parts[1])) {
        m = monthMap[parts[1].toLowerCase()];
        if (!m) return { ok: false, reason: "invalid month name" };
      } else {
        m = toInt(parts[1]);
      }
    }

    if (!Number.isInteger(d) || d < 1 || d > 31) return { ok: false, reason: "invalid day" };
    if (!Number.isInteger(m) || m < 1 || m > 12) return { ok: false, reason: "invalid month" };

    // validate actual calendar date
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      return { ok: false, reason: "invalid calendar date" };
    }

    return { ok: true, date: dt, reason: "string_date" };
  };

  try {
    const r = parse(rawDate);
    return r.ok ? r.date : fallback;
  } catch {
    return fallback;
  }
}
*/}