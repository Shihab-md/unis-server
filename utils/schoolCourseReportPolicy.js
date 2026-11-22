// Read-only reporting inference. No Course master or promotion writer changes.
const id = (value) => String(value?._id ?? value ?? "");
const decision = (value) => String(value || "").toLowerCase().replace(/[\s_-]+/g, "");

export function schoolCourseFamily(course) {
  const name = String(course?.name || "").normalize("NFKC").toUpperCase().trim();
  const marker = /\b(?:\d{1,2}(?:ST|ND|RD|TH)?\s*(?:STANDARD|STD\.?|CLASS|GRADE)|(?:STANDARD|STD\.?|CLASS|GRADE)\s*\d{1,2}(?:ST|ND|RD|TH)?)\b/g;
  const matches = [...name.matchAll(marker)];
  if (matches.length !== 1) return null;
  const match = matches[0];
  // Keep all remaining family tokens; DPS, CBSE and language variants stay separate.
  return (name.slice(0, match.index) + " " + name.slice(match.index + match[0].length))
    .replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim() || "GENERAL STANDARDS";
}

export function schoolCourseInstitutes(academics) {
  const result = new Map();
  for (const academic of academics) for (let slot = 1; slot <= 5; slot++) {
    const course = id(academic[`courseId${slot}`]), institute = id(academic[`instituteId${slot}`]);
    if (!course || !institute) continue;
    if (!result.has(course)) result.set(course, new Set());
    result.get(course).add(institute);
  }
  return result;
}

export const sameSchoolInstitute = (source, target) => !source?.instituteId || !target?.instituteId || source.instituteId === target.instituteId;

export function schoolCourseProgression(course, courses, { source = {}, targetSlots = [], courseInstitutes = new Map() } = {}) {
  const order = Number(course.promotionOrder || 0);
  if (!Number.isInteger(order) || order <= 0) return { error: "COURSE_ORDER_INVALID", isFinalYear: null };
  const base = { sourceYear: order, nextYear: order + 1, isFinalYear: null };
  const family = schoolCourseFamily(course);
  const scoped = courses.filter((candidate) => {
    if (candidate.type !== "School Education") return false;
    const institutes = courseInstitutes.get(id(candidate._id));
    if (source.instituteId && institutes?.size && !institutes.has(source.instituteId)) return false;
    return family === null || schoolCourseFamily(candidate) === family;
  });
  // Old unnamed paths remain supported only when the configured sequence is unique.
  if (family === null && (scoped.some((candidate) => schoolCourseFamily(candidate) !== null) ||
    new Set(scoped.map((candidate) => Number(candidate.promotionOrder))).size !== scoped.length))
    return { ...base, error: "SCHOOL_PATH_UNDEFINED" };
  if (scoped.some((candidate) => !Number.isInteger(Number(candidate.promotionOrder)) || Number(candidate.promotionOrder) <= 0))
    return { ...base, error: "COURSE_ORDER_INVALID" };
  let next = scoped.filter((candidate) => Number(candidate.promotionOrder) === order + 1);
  const nextCandidateIds = next.map((candidate) => id(candidate._id));
  if (next.length > 1) {
    const savedIds = new Set(targetSlots.filter((target) => decision(target.status) === "promoted" &&
      target.year === order + 1 && sameSchoolInstitute(source, target)).map((target) => target.courseId));
    const saved = next.filter((candidate) => savedIds.has(id(candidate._id)));
    if (saved.length === 1) next = saved;
  }
  if (next.length > 1) return { ...base, nextCandidateIds, error: "SCHOOL_NEXT_AMBIGUOUS" };
  if (!next.length && scoped.some((candidate) => Number(candidate.promotionOrder) > order))
    return { ...base, error: "COURSE_ORDER_GAP" };
  return { ...base, nextCandidateIds, nextCourseId: id(next[0]?._id), isFinalYear: !next.length };
}
