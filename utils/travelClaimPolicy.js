export class TaError extends Error {
  constructor(code, status = 400) { super(code); this.name = "TaError"; this.code = code; this.status = status; }
}
export const failTa = (code, status) => { throw new TaError(code, status); };
export const TA_SELF_ROLES = new Set(["supervisor", "hqadmin", "hquser", "hqstaff", "accountant"]);
export const TA_REVIEW_ROLES = new Set(["superadmin", "hqadmin", "accountant"]);
export const MAX_TA_PAISE = 1_000_000_000;
export const MAX_EVIDENCE_BYTES = 3 * 1024 * 1024;
export const rupees = (paise) => Number(paise || 0) / 100;
export const indiaDateKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export function moneyPaise(value, allowZero = false) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) failTa("TA_INVALID_AMOUNT");
  const [whole, decimal = ""] = text.split(".");
  const amount = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount > MAX_TA_PAISE || amount < (allowZero ? 0 : 1)) failTa("TA_INVALID_AMOUNT");
  return amount;
}
export const isDateKey = (value) => typeof value === "string" && /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const isMonthKey = (value) => typeof value === "string" && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);
const field = (value, max) => { if (typeof value !== "string" || !value.trim() || value.trim().length > max || Buffer.from(value, "utf8").toString("utf8") !== value || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) failTa("TA_INVALID_FIELDS"); return value.trim(); };
export function claimInput(body) {
  if (!isDateKey(body.fromDateKey) || !isDateKey(body.toDateKey) || body.fromDateKey > body.toDateKey) failTa("TA_INVALID_DATES");
  if (!Array.isArray(body.expenses) || !body.expenses.length || body.expenses.length > 20) failTa("TA_INVALID_FIELDS");
  const expenses = body.expenses.map((row) => ({ description: field(row?.description, 200), amountPaise: moneyPaise(row?.amount) }));
  const requestedAmountPaise = expenses.reduce((sum, row) => sum + row.amountPaise, 0);
  if (requestedAmountPaise > MAX_TA_PAISE) failTa("TA_INVALID_AMOUNT");
  return {
    fromDateKey: body.fromDateKey, toDateKey: body.toDateKey,
    fromPlace: field(body.fromPlace, 200), toPlace: field(body.toPlace, 200), purpose: field(body.purpose, 1000),
    transport: field(body.transport, 100), expenses, requestedAmountPaise,
  };
}
export function assertRevision(claim, value) {
  if (!Number.isSafeInteger(value) || value !== claim.revision) failTa("TA_STALE", 409);
}
export function assertEditable(claim) {
  if (!["Draft", "Returned"].includes(claim.status) || claim.payrollRunId) failTa("TA_LOCKED", 409);
}
export function evidenceType(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_EVIDENCE_BYTES) failTa("TA_INVALID_FILE");
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  failTa("TA_INVALID_FILE");
}
