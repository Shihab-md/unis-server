import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import Student from "../models/Student.js";
import Academic from "../models/Academic.js";
import AcademicYear from "../models/AcademicYear.js";
import Course from "../models/Course.js";
import Institute from "../models/Institute.js";
import School from "../models/School.js";
import Employee from "../models/Employee.js";
import User from "../models/User.js";
import Notification from "../models/Notification.js";
import StudentCourseChange from "../models/StudentCourseChange.js";
import { getAccessContext } from "../middleware/authorizationMiddleware.js";
import { getRequestPermissions } from "./permissionService.js";
import { PERMISSIONS } from "../config/permissionCatalog.js";
import { getNiswanSchoolFilter } from "../config/organizationPolicy.js";
import { courseDifferenceNotification } from "./studentCourseNotificationService.js";
import { dispatchNotification } from "./notificationService.js";
import { StudentCourseError, failCourse, objectId, requestKeyValid, coursePaise, courseHash, idText, SLOT_TYPES, courseYears, academicSnapshot } from "../utils/studentCoursePolicy.js";

let initialized;
async function initialize() {
  if (!initialized) initialized = (async () => {
    await StudentCourseChange.createCollection(); await StudentCourseChange.createIndexes(); await Notification.createCollection();
  })().catch((error) => { initialized = null; throw error; });
  return initialized;
}
export async function assertCourseChangeAccess(req) {
  if (!["superadmin", "hquser"].includes(String(req.user?.role || "").toLowerCase())) failCourse("SC_FORBIDDEN", 403);
  const [scope, permissions] = await Promise.all([getAccessContext(req.user), getRequestPermissions(req)]);
  if (!scope.isHQ || !scope.isActive || !permissions.includes(PERMISSIONS.STUDENT_COURSE_CHANGE)) failCourse("SC_FORBIDDEN", 403);
}
async function context(studentId, academicId, session = null) {
  if (!objectId(studentId) || !objectId(academicId)) failCourse("SC_INVALID_FIELDS");
  const student = await Student.findById(studentId).populate("userId", "name").session(session).lean();
  const academic = await Academic.findOne({ _id: academicId, studentId }).session(session).lean();
  if (!student || !academic) failCourse("SC_NOT_FOUND", 404);
  const [school, year] = await Promise.all([
    School.findOne({ _id: student.schoolId, ...getNiswanSchoolFilter() }).select("code nameEnglish active").session(session).lean(),
    AcademicYear.findById(academic.acYear).select("acYear").session(session).lean(),
  ]);
  if (!school || !year || !student.userId) failCourse("SC_NOT_FOUND", 404);
  return { student, academic, school, year };
}
function summary(change) {
  const value = change.toObject ? change.toObject() : change;
  return { _id: value._id, academicId: value.academicId, acYear: value.acYear, slot: value.slot, oldSlot: value.oldSlot, newSlot: value.newSlot,
    differencePaise: value.differencePaise, reason: value.reason, actorName: value.actorName, createdAt: value.createdAt };
}
export async function courseChangeOptions(req) {
  await assertCourseChangeAccess(req);
  if (!objectId(req.params.id)) failCourse("SC_NOT_FOUND", 404);
  const student = await Student.findById(req.params.id).populate("userId", "name").populate("schoolId", "code nameEnglish active").lean();
  if (!student?.schoolId || !student.userId) failCourse("SC_NOT_FOUND", 404);
  const [academics, courses, institutes, changes] = await Promise.all([
    Academic.find({ studentId: student._id }).populate("acYear", "acYear active").sort({ createdAt: -1 }).lean(),
    Course.find({}).select("code name type years fees").sort({ code: 1 }).lean(),
    Institute.find({}).select("iCode name type").sort({ iCode: 1 }).lean(),
    StudentCourseChange.find({ studentId: student._id }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);
  academics.sort((a,b) => String(b.acYear?.acYear || "").localeCompare(String(a.acYear?.acYear || "")));
  return { student: { _id: student._id, name: student.userId.name, rollNumber: student.rollNumber, active: student.active, school: student.schoolId },
    academics: academics.map((a) => ({ _id: a._id, acYear: a.acYear, ...academicSnapshot(a) })),
    courses: courses.map((c) => ({ ...c, allowedYears: courseYears(c) })), institutes, history: changes.map(summary) };
}
function parseParameters(body) {
  const slot = Number(body.slot);
  const courseId = body.courseId === "" ? "" : body.courseId;
  if (!objectId(body.academicId) || !Number.isInteger(slot) || !SLOT_TYPES[slot] || !requestKeyValid(body.requestKey) || (courseId !== "" && !objectId(courseId))) failCourse("SC_INVALID_FIELDS");
  if (slot === 1 && !courseId) failCourse("SC_PRIMARY_REQUIRED");
  const reason = body.reason === undefined ? "" : body.reason;
  if (typeof reason !== "string" || reason.length > 500 || Buffer.from(reason, "utf8").toString("utf8") !== reason || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(reason)) failCourse("SC_INVALID_FIELDS");
  if (courseId && !objectId(body.instituteId)) failCourse("SC_INVALID_FIELDS");
  return { academicId: body.academicId, slot, courseId, instituteId: courseId ? body.instituteId : "", year: courseId ? Number(body.year) : null,
    discount: courseId ? (coursePaise(body.discount ?? 0) / 100).toFixed(2) : "0.00", requestKey: body.requestKey, reason: reason.trim() };
}
async function quoteFor(studentId, parameters, session = null) {
  const data = await context(studentId, parameters.academicId, session), { student, academic, school, year } = data, i = parameters.slot;
  if (["alumni", "graduated", "completed"].includes(String(student.active || "").toLowerCase()) || String(academic[`status${i}`] || "").toLowerCase() === "completed") failCourse("SC_COMPLETED", 409);
  const oldCourseId = idText(academic[`courseId${i}`]);
  const oldCourse = oldCourseId ? await Course.findById(oldCourseId).select("code name").session(session).lean() : null;
  let nextCourse = null, institute = null;
  if (parameters.courseId) {
    [nextCourse, institute] = await Promise.all([Course.findById(parameters.courseId).session(session).lean(), Institute.findById(parameters.instituteId).session(session).lean()]);
    if (!nextCourse || !institute) failCourse("SC_NOT_FOUND", 404);
    if (!SLOT_TYPES[i].includes(nextCourse.type) || institute.type !== (i === 1 ? "Deeniyath Education" : SLOT_TYPES[i][0])) failCourse("SC_WRONG_TYPE");
    if (!courseYears(nextCourse).includes(parameters.year)) failCourse("SC_INVALID_YEAR");
    if ([1,2,3,4,5].some((slot) => slot !== i && idText(academic[`courseId${slot}`]) === parameters.courseId)) failCourse("SC_DUPLICATE_COURSE");
  }
  const feesPaise = nextCourse ? coursePaise(nextCourse.fees) : 0, discountPaise = nextCourse ? coursePaise(parameters.discount) : 0;
  if (discountPaise > feesPaise) failCourse("SC_INVALID_FEE");
  const oldFees = coursePaise(academic[`fees${i}`] || 0), oldDiscount = coursePaise(academic[`discount${i}`] || 0);
  const oldNet = academic[`finalFees${i}`] == null ? Math.max(oldFees - oldDiscount, 0) : coursePaise(academic[`finalFees${i}`]);
  const oldSlot = { courseId: oldCourseId, courseCode: oldCourse?.code || "", courseName: oldCourse?.name || "", instituteId: idText(academic[`instituteId${i}`]),
    year: academic[`year${i}`] ?? null, feesPaise: oldFees, discountPaise: oldDiscount, netPaise: oldNet, status: academic[`status${i}`] || "", grade: academic[`grade${i}`] || "" };
  const newSlot = { courseId: parameters.courseId, courseCode: nextCourse?.code || "", courseName: nextCourse?.name || "", instituteId: parameters.instituteId,
    year: parameters.year, feesPaise, discountPaise, netPaise: feesPaise - discountPaise,
    status: parameters.courseId ? oldCourseId === parameters.courseId ? oldSlot.status || "Admission" : "Admission" : "", grade: oldCourseId === parameters.courseId ? oldSlot.grade : "" };
  if (courseHash(oldSlot) === courseHash(newSlot)) failCourse("SC_NO_CHANGE");
  const academicBefore = academicSnapshot(academic), academicAfter = { ...academicBefore,
    [`courseId${i}`]: newSlot.courseId, [`instituteId${i}`]: newSlot.instituteId, [`year${i}`]: newSlot.year,
    [`fees${i}`]: newSlot.courseId ? newSlot.feesPaise / 100 : null, [`discount${i}`]: newSlot.courseId ? newSlot.discountPaise / 100 : null,
    [`finalFees${i}`]: newSlot.courseId ? newSlot.netPaise / 100 : null, [`status${i}`]: newSlot.status || null, [`grade${i}`]: newSlot.grade || null,
  };
  const details = { studentId: idText(student._id), studentName: student.userId.name, rollNumber: student.rollNumber || "", schoolId: idText(school._id), schoolCode: school.code,
    academicId: idText(academic._id), acYear: year.acYear, slot: i, oldSlot, newSlot, differencePaise: newSlot.netPaise - oldSlot.netPaise,
    reason: parameters.reason, academicBefore, academicAfter, studentStatus: student.active };
  return { ...data, details, quoteHash: courseHash(details) };
}
const publicQuote = (quote) => { const { academicBefore, academicAfter, studentStatus, ...values } = quote.details; return values; };
const secret = () => { if (!process.env.JWT_SECRET) failCourse("SC_UNAVAILABLE", 503); return process.env.JWT_SECRET; };
export async function previewCourseChange(req) {
  await assertCourseChangeAccess(req);
  if (!objectId(req.params.id)) failCourse("SC_NOT_FOUND", 404);
  const parameters = parseParameters(req.body || {}), quote = await quoteFor(req.params.id, parameters);
  const token = jwt.sign({ studentId: req.params.id, parameters, quoteHash: quote.quoteHash }, secret(),
    { algorithm: "HS256", subject: idText(req.user._id), audience: "student-course-change", issuer: "unis", expiresIn: "15m" });
  return { quote: publicQuote(quote), confirmationToken: token };
}
export async function commitCourseChange(req) {
  await assertCourseChangeAccess(req); await initialize();
  if (!objectId(req.params.id) || typeof req.body.confirmationToken !== "string" || req.body.confirmationToken.length > 10000) failCourse("SC_CONFIRMATION");
  let token;
  try { token = jwt.verify(req.body.confirmationToken, secret(), { algorithms: ["HS256"], subject: idText(req.user._id), audience: "student-course-change", issuer: "unis" }); }
  catch (error) { if (error instanceof StudentCourseError) throw error; failCourse("SC_EXPIRED", 409); }
  if (token.studentId !== req.params.id) failCourse("SC_CONFIRMATION");
  const parameters = parseParameters(token.parameters);
  const session = await mongoose.startSession(); let result;
  try {
    await session.withTransaction(async () => {
      const prior = await StudentCourseChange.findOne({ userId: req.user._id, requestKey: parameters.requestKey }).session(session);
      if (prior) {
        if (prior.quoteHash !== token.quoteHash || idText(prior.studentId) !== req.params.id) failCourse("SC_STALE", 409);
        result = { change: summary(prior), notifications: [] }; return;
      }
      const quote = await quoteFor(req.params.id, parameters, session);
      if (quote.quoteHash !== token.quoteHash) failCourse("SC_STALE", 409);
      if (quote.details.differencePaise !== 0 && req.body.acknowledgeFeeDifference !== true) failCourse("SC_FEE_CONFIRMATION", 409);
      const { academic, student, details } = quote, i = parameters.slot;
      const updates = {};
      for (const field of ["courseId", "instituteId", "year", "fees", "discount", "finalFees", "status", "grade"]) {
        const value = details.academicAfter[`${field}${i}`]; updates[`${field}${i}`] = value === "" ? null : value;
      }
      await Academic.updateOne({ _id: academic._id }, { $set: { ...updates, updatedAt: new Date() }, $inc: { __v: 1 } }, { session, runValidators: true });
      // Rebuild the lookup index without removing course references from other years.
      const academics = await Academic.find({ studentId: student._id }).select("courseId1 courseId2 courseId3 courseId4 courseId5").session(session).lean();
      const courses = [...new Set(academics.flatMap((a) => [1,2,3,4,5].map((slot) => idText(a[`courseId${slot}`])).filter(Boolean)))];
      await Student.updateOne({ _id: student._id }, { $set: { courses, updatedAt: new Date() } }, { session });
      const actor = await User.findById(req.user._id).select("name").session(session).lean();
      const actorName = actor?.name || "", recipients = [];
      if (details.differencePaise !== 0) {
        const users = await User.find({ role: { $in: ["superadmin", "hquser"] } }).select("name role preferredLanguage").session(session).lean();
        const activeHq = await Employee.find({ organizationType: "HQ", active: "Active", userId: { $in: users.filter((u) => u.role === "hquser").map((u) => u._id) } }).select("userId").session(session).lean();
        const ids = new Set(activeHq.map((e) => idText(e.userId)));
        recipients.push(...users.filter((u) => u.role === "superadmin" || ids.has(idText(u._id))));
      }
      const [change] = await StudentCourseChange.create([{ userId: req.user._id, requestKey: parameters.requestKey, quoteHash: token.quoteHash,
        studentId: student._id, academicId: academic._id, schoolId: student.schoolId, slot: i, acYear: details.acYear, actorName, reason: parameters.reason,
        oldSlot: details.oldSlot, newSlot: details.newSlot, differencePaise: details.differencePaise, academicBefore: details.academicBefore, academicAfter: details.academicAfter,
        notificationUserIds: recipients.map((u) => u._id) }], { session });
      const notifications = recipients.length ? await Notification.insertMany(recipients.map((u) => ({ userId: u._id, type: "student.course.fee_difference",
        ...courseDifferenceNotification(u.preferredLanguage, { ...details, actorName }), resourceType: "StudentCourseChange", resourceId: String(change._id),
        webPath: `/dashboard/students/${student._id}`, mobilePath: `/(app)/students/${student._id}` })), { session }) : [];
      // No billing model, invoice helper, payment balance or feesPaid flag is changed.
      result = { change: summary(change), notifications };
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary", maxCommitTimeMS: 15000, timeoutMS: 55000 });
  } finally { await session.endSession(); }
  await Promise.allSettled(result.notifications.map(dispatchNotification));
  return { change: result.change, noInvoiceCreated: true };
}
