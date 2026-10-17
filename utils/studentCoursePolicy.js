import { createHash } from "node:crypto";
export class StudentCourseError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export const failCourse = (code, status) => { throw new StudentCourseError(code, status); };
export const objectId = (value) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
export const requestKeyValid = (value) => typeof value === "string" && /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);
export const courseHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const idText = (value) => String(value?._id || value || "");
export function coursePaise(value) {
  const text = String(value ?? "0").trim();
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) failCourse("SC_INVALID_FEE");
  const [whole, decimals = ""] = text.split(".");
  const paise = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise) || paise > 1000000000) failCourse("SC_INVALID_FEE");
  return paise;
}
export const SLOT_TYPES = { 1: ["Deeniyath Education", "Teacher Training"], 2: ["School Education"], 3: ["College Education"], 4: ["Islamic Home Science"], 5: ["Vocational Courses"] };
export function courseYears(course) {
  for (const [level, values] of [[1,[0,1,2,3]],[2,[4,5,6]],[3,[7,8,9]],[4,[10,11,12]]]) if (String(course.name || "").includes(`Makthab_Level${level}`)) return values;
  const count = Math.min(20, Math.max(1, Number(course.years || 1)));
  return Array.from({ length: count }, (_, i) => i + 1);
}
export function academicSnapshot(academic) {
  const values = {};
  for (let i = 1; i <= 5; i++) for (const field of ["instituteId", "courseId", "refNumber", "year", "fees", "discount", "finalFees", "status", "grade"]) {
    const value = academic[`${field}${i}`]; values[`${field}${i}`] = ["courseId", "instituteId"].includes(field) ? idText(value) : value ?? null;
  }
  return values;
}
export function assertProfileCoursesUnchanged(academic, body) {
  if (!academic) failCourse("SC_USE_ACTION", 409);
  for (let i = 1; i <= 5; i++) {
    for (const field of ["courseId", "instituteId"]) {
      const key = `${field}${i}`;
      if (Object.hasOwn(body, key) && idText(body[key]) !== idText(academic[key])) failCourse("SC_USE_ACTION", 403);
    }
    for (const field of ["fees", "discount"]) {
      const key = `${field}${i}`;
      if (Object.hasOwn(body, key) && coursePaise(body[key] === "" || body[key] == null ? 0 : body[key]) !== coursePaise(academic[key] || 0)) failCourse("SC_USE_ACTION", 403);
    }
  }
}
