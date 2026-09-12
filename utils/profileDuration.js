const toDateOnly = (value) => {
  if (!value) return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();

const addYearsClamped = (date, years) => {
  const year = date.getFullYear() + years;
  const month = date.getMonth();
  const day = Math.min(date.getDate(), daysInMonth(year, month));
  return new Date(year, month, day);
};

const addMonthsClamped = (date, months) => {
  const totalMonths = date.getFullYear() * 12 + date.getMonth() + months;
  const year = Math.floor(totalMonths / 12);
  const month = ((totalMonths % 12) + 12) % 12;
  const day = Math.min(date.getDate(), daysInMonth(year, month));
  return new Date(year, month, day);
};

const calendarDayDifference = (from, to) => {
  const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.max(0, Math.round((toUtc - fromUtc) / 86400000));
};

export const calculateCalendarDuration = (startDate, asOf = new Date()) => {
  const start = toDateOnly(startDate);
  const end = toDateOnly(asOf);
  if (!start || !end || start > end) return null;

  let years = end.getFullYear() - start.getFullYear();
  let yearAnchor = addYearsClamped(start, years);
  if (yearAnchor > end) {
    years -= 1;
    yearAnchor = addYearsClamped(start, years);
  }

  let months = 0;
  while (months < 11 && addMonthsClamped(yearAnchor, months + 1) <= end) months += 1;

  const monthAnchor = addMonthsClamped(yearAnchor, months);
  const days = calendarDayDifference(monthAnchor, end);
  return { years, months, days };
};

export const formatCompactDuration = (startDate, asOf = new Date()) => {
  const duration = calculateCalendarDuration(startDate, asOf);
  if (!duration) return "-";
  return `${duration.years} Y, ${duration.months} M, ${duration.days} D`;
};
