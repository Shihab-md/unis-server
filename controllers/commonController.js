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
