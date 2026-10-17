import { courseChangeOptions, previewCourseChange, commitCourseChange } from "../services/studentCourseChangeService.js";
import { StudentCourseError } from "../utils/studentCoursePolicy.js";
const handle = (fn) => async (req, res) => {
  res.set("Cache-Control", "no-store");
  try { return res.json({ success: true, ...await fn(req) }); }
  catch (error) {
    const known = error instanceof StudentCourseError;
    if (!known) console.error("[student-course-change]", { name: error?.name, code: error?.code });
    return res.status(known ? error.status : 503).json({ success: false, code: known ? error.code : "SC_UNAVAILABLE", error: known ? error.code : "SC_UNAVAILABLE" });
  }
};
export const getStudentCourseChange = handle(courseChangeOptions);
export const previewStudentCourseChange = handle(previewCourseChange);
export const saveStudentCourseChange = handle(commitCourseChange);
