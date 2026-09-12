const DEFAULT_TIME_ZONE = "Asia/Kolkata";

export const getBusinessTimeZone = () =>
  String(process.env.UNIS_TIMEZONE || DEFAULT_TIME_ZONE).trim() || DEFAULT_TIME_ZONE;

const keyFromParts = (parts) => {
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
};

export const getBusinessTodayKey = (now = new Date()) =>
  keyFromParts(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: getBusinessTimeZone(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now)
  );

const MONTHS = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

export const toCalendarDateKey = (value) => {
  if (value === undefined || value === null || value === "") return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return value.toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  if (!text) return "";

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const jsDate = text.match(/^(?:[A-Za-z]{3}\s+)?([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\b/);
  if (jsDate && MONTHS[jsDate[1]]) {
    return `${jsDate[3]}-${MONTHS[jsDate[1]]}-${String(jsDate[2]).padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

export const validateActualDate = (value, label, { required = false } = {}) => {
  const empty = value === undefined || value === null || String(value).trim() === "";
  if (empty) {
    return required
      ? { ok: false, key: "", error: `${label} is required.` }
      : { ok: true, key: "", error: "" };
  }

  const key = toCalendarDateKey(value);
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return { ok: false, key: "", error: `${label} is invalid.` };
  }

  if (key > getBusinessTodayKey()) {
    return { ok: false, key, error: `${label} cannot be in the future.` };
  }
  return { ok: true, key, error: "" };
};

export const validateActualDateOrder = ({
  earlierValue,
  earlierLabel,
  laterValue,
  laterLabel,
}) => {
  const earlier = toCalendarDateKey(earlierValue);
  const later = toCalendarDateKey(laterValue);
  if (!earlier || !later) return { ok: true, error: "" };
  if (earlier > later) {
    return {
      ok: false,
      error: `${earlierLabel} cannot be after ${laterLabel}.`,
    };
  }
  return { ok: true, error: "" };
};

export const validateNotFutureDateKey = (dateKey, label = "Date") => {
  const key = String(dateKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return { ok: false, error: `${label} must use YYYY-MM-DD format.` };
  }
  if (key > getBusinessTodayKey()) {
    return { ok: false, error: `${label} cannot be in the future.` };
  }
  return { ok: true, error: "" };
};
