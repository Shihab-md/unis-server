import Grade from "../models/Grade.js";

const clean = (value) => (value === undefined || value === null ? "" : String(value).trim());

export const normalizeConduct = (value) => clean(value).toLowerCase().replace(/\s+/g, " ");

export const sortGradeRules = (rules = []) =>
  [...(Array.isArray(rules) ? rules : [])].sort((a, b) => {
    const orderDiff = Number(a?.displayOrder || 9999) - Number(b?.displayOrder || 9999);
    if (orderDiff !== 0) return orderDiff;

    const markDiff = Number(b?.minMarkPercentage || 0) - Number(a?.minMarkPercentage || 0);
    if (markDiff !== 0) return markDiff;

    const attendanceDiff = Number(b?.minAttendancePercentage || 0) - Number(a?.minAttendancePercentage || 0);
    if (attendanceDiff !== 0) return attendanceDiff;

    return clean(a?.grade).localeCompare(clean(b?.grade));
  });

export const getActiveGradeRules = async () =>
  Grade.find({ active: "Active" })
    .sort({ displayOrder: 1, minMarkPercentage: -1, minAttendancePercentage: -1, grade: 1 })
    .lean();

export const calculateGradeFromRules = ({
  markPercentage,
  attendancePercentage,
  result,
  conduct = "",
  rules = [],
}) => {
  if (result === "Fail") return "F";
  if (result !== "Pass") return "";

  const mark = Number(markPercentage);
  const attendance = Number(attendancePercentage);
  if (!Number.isFinite(mark) || !Number.isFinite(attendance)) return "";

  const normalizedConduct = normalizeConduct(conduct);
  const activeRules = sortGradeRules(rules).filter((rule) => String(rule?.active || "Active") === "Active");

  for (const rule of activeRules) {
    const minMark = Number(rule?.minMarkPercentage);
    const minAttendance = Number(rule?.minAttendancePercentage);
    if (!Number.isFinite(minMark) || !Number.isFinite(minAttendance)) continue;
    if (mark < minMark || attendance < minAttendance) continue;

    const requiredConduct = normalizeConduct(rule?.conduct);
    if (requiredConduct && requiredConduct !== normalizedConduct) continue;

    return clean(rule?.grade).toUpperCase();
  }

  return "";
};
