import mongoose from "mongoose";
import AcademicYear from "../models/AcademicYear.js";
import Course from "../models/Course.js";
import Employee from "../models/Employee.js";
import ExamQuestionDownload from "../models/ExamQuestionDownload.js";
import ExamQuestionPaper from "../models/ExamQuestionPaper.js";
import School from "../models/School.js";
import {
  deleteQuestionPaperFromDrive,
  downloadQuestionPaperFromDrive,
  uploadQuestionPaperToDrive,
} from "../services/examQuestionDriveService.js";

const EXAM_TYPES = ["Quarterly", "Half Yearly", "Annual"];
const MANAGER_ROLES = new Set(["superadmin", "hquser"]);
const VIEWER_ROLES = new Set(["superadmin", "hquser", "admin"]);
const IST_OFFSET_MINUTES = 330;

const clean = (value) => (value === undefined || value === null ? "" : String(value).trim());
const roleOf = (req) => clean(req.user?.role).toLowerCase();
const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const isManager = (req) => MANAGER_ROLES.has(roleOf(req));
const hasPdfSignature = (file) => Boolean(file?.buffer?.length >= 5 && file.buffer.subarray(0, 5).toString("ascii") === "%PDF-");
const deny = (res, message = "You are not authorized to access Exam Questions.") =>
  res.status(403).json({ success: false, error: message });

const normalizeExamType = (value) => {
  const v = clean(value).toLowerCase().replace(/[-_\s]+/g, "");
  if (v === "quarterly") return "Quarterly";
  if (v === "halfyearly") return "Half Yearly";
  if (v === "annual") return "Annual";
  return "";
};

const parseArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return String(value).split(",").map((item) => item.trim()).filter(Boolean);
  }
};

const parseIstDateTime = (dateText, timeText) => {
  const date = clean(dateText);
  const time = clean(timeText);
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return null;
  const year = Number(dm[1]);
  const month = Number(dm[2]);
  const day = Number(dm[3]);
  const hour = Number(tm[1]);
  const minute = Number(tm[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, 0) - IST_OFFSET_MINUTES * 60 * 1000;
  const out = new Date(utcMs);
  if (Number.isNaN(out.getTime())) return null;
  const shifted = new Date(out.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  if (
    shifted.getUTCFullYear() !== year ||
    shifted.getUTCMonth() + 1 !== month ||
    shifted.getUTCDate() !== day ||
    shifted.getUTCHours() !== hour ||
    shifted.getUTCMinutes() !== minute
  ) return null;
  return out;
};

const formatIstParts = (dateValue) => {
  if (!dateValue) return { date: "", time: "" };
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const shifted = new Date(d.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return {
    date: `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}`,
    time: `${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}`,
  };
};

const getCourseSubjects = (course = {}) => {
  const subjects = [];
  const courseCode = clean(course.code) || "SUB";
  for (let i = 1; i <= 10; i++) {
    const subjectName = clean(course[`subject${i}`]);
    if (!subjectName) continue;
    subjects.push({
      subjectNo: i,
      subjectCode: clean(course[`subject${i}Code`]) || `${courseCode}-${String(i).padStart(2, "0")}`,
      subjectName,
    });
  }
  return subjects;
};

const getAdminSchool = async (userId) => {
  const employee = await Employee.findOne({ userId }).select("schoolId active").lean();
  if (!employee?.schoolId || clean(employee.active).toLowerCase() !== "active") return null;
  const school = await School.findOne({ _id: employee.schoolId, active: "Active" })
    .select("_id code nameEnglish")
    .lean();
  return school || null;
};

const getAccess = async (req) => {
  const role = roleOf(req);
  if (!VIEWER_ROLES.has(role)) return { role, canUse: false, isManager: false, school: null };
  if (MANAGER_ROLES.has(role)) return { role, canUse: true, isManager: true, school: null };
  const school = await getAdminSchool(req.user?._id);
  return { role, canUse: Boolean(school), isManager: false, school };
};

const effectiveStatus = (paper, now = new Date()) => {
  if (paper.publicationStatus === "Draft") return "Draft";
  if (paper.publicationStatus === "Closed") return "Closed";
  const from = paper.availableFrom ? new Date(paper.availableFrom) : null;
  const until = paper.availableUntil ? new Date(paper.availableUntil) : null;
  if (from && now < from) return "Scheduled";
  if (until && now > until) return "Closed";
  return "Released";
};

const isTargetedToSchool = (paper, schoolId) => {
  if (!schoolId) return false;
  if (paper.targetType === "ALL") return true;
  return (paper.targetSchoolIds || []).some((id) => String(id?._id || id) === String(schoolId));
};

const serializePaper = (paper, { downloadStats = null, targetCount = null, includeTargets = false } = {}) => {
  const obj = typeof paper.toObject === "function" ? paper.toObject() : { ...paper };
  const release = formatIstParts(obj.availableFrom);
  const close = formatIstParts(obj.availableUntil);
  const computedTargetCount = targetCount ?? (obj.targetType === "SELECTED" ? (obj.targetSchoolIds || []).length : null);
  const safe = { ...obj };
  delete safe.driveFileId;
  delete safe.driveFolderPath;
  if (!includeTargets) safe.targetSchoolIds = [];
  return {
    ...safe,
    effectiveStatus: effectiveStatus(obj),
    releaseDate: release.date,
    releaseTime: release.time,
    closeDate: close.date,
    closeTime: close.time,
    targetCount: computedTargetCount,
    downloadedSchoolCount: downloadStats?.downloadedSchoolCount ?? 0,
    totalDownloads: downloadStats?.totalDownloads ?? 0,
  };
};

const validateAndResolvePayload = async (body, { requireFile = false, file, existing = null } = {}) => {
  if (requireFile && !file) throw new Error("Question Paper PDF is required.");
  if (file && !hasPdfSignature(file)) throw new Error("The uploaded file is not a valid PDF Question Paper.");

  const academicYearId = clean(body.academicYearId);
  const courseId = clean(body.courseId);
  const studyingYear = Number(body.studyingYear || 0);
  const examType = normalizeExamType(body.examType);
  const subjectNo = Number(body.subjectNo || 0);
  const examDate = clean(body.examDate);
  const examStartTime = clean(body.examStartTime);
  const releaseDate = clean(body.releaseDate);
  const releaseTime = clean(body.releaseTime);
  const closeDate = clean(body.closeDate);
  const closeTime = clean(body.closeTime);
  const targetType = clean(body.targetType).toUpperCase() === "SELECTED" ? "SELECTED" : "ALL";
  const publicationStatus = ["Draft", "Published", "Closed"].includes(clean(body.publicationStatus))
    ? clean(body.publicationStatus)
    : "Draft";

  if (!isObjectId(academicYearId)) throw new Error("Please select a valid Academic Year.");
  if (!isObjectId(courseId)) throw new Error("Please select a valid Course.");
  if (!Number.isInteger(studyingYear) || studyingYear < 1) throw new Error("Please select a valid Year of Study.");
  if (!examType) throw new Error("Please select a valid Exam Type.");
  if (!Number.isInteger(subjectNo) || subjectNo < 1 || subjectNo > 10) throw new Error("Please select a valid Subject.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate)) throw new Error("Exam Date is required.");
  if (!/^\d{2}:\d{2}$/.test(examStartTime)) throw new Error("Exam Start Time is required.");

  const examStartsAt = parseIstDateTime(examDate, examStartTime);
  if (!examStartsAt) throw new Error("Exam Date/Time is invalid.");
  const availableFrom = parseIstDateTime(releaseDate, releaseTime);
  if (!availableFrom) throw new Error("Release Date and Time are required.");
  if (availableFrom > examStartsAt) throw new Error("Question Paper release time cannot be later than the Exam Start Time.");
  let availableUntil = null;
  if (closeDate || closeTime) {
    if (!closeDate || !closeTime) throw new Error("Both Close Date and Close Time are required when setting a close time.");
    availableUntil = parseIstDateTime(closeDate, closeTime);
    if (!availableUntil) throw new Error("Close Date/Time is invalid.");
    if (availableUntil <= availableFrom) throw new Error("Close time must be later than the release time.");
    if (availableUntil <= examStartsAt) throw new Error("Close time must be later than the Exam Start Time.");
  }

  const [academicYear, course] = await Promise.all([
    AcademicYear.findById(academicYearId).select("_id acYear").lean(),
    Course.findById(courseId).lean(),
  ]);
  if (!academicYear) throw new Error("Academic Year not found.");
  if (!course) throw new Error("Course not found.");
  if (studyingYear > Number(course.years || 0)) {
    const sameHistoricalSlot = existing && String(existing.courseId) === String(courseId) && Number(existing.studyingYear) === studyingYear;
    if (!sameHistoricalSlot) throw new Error(`Year of Study cannot exceed ${course.years} year(s) for this Course.`);
  }

  let subject = getCourseSubjects(course).find((item) => Number(item.subjectNo) === subjectNo);
  if (!subject && existing && String(existing.courseId) === String(courseId) && Number(existing.subjectNo) === subjectNo) {
    subject = { subjectNo, subjectCode: clean(existing.subjectCode), subjectName: clean(existing.subjectName) };
  }
  if (!subject) throw new Error("Selected Subject is not configured in the Course Master.");

  let targetSchoolIds = [];
  if (targetType === "SELECTED") {
    targetSchoolIds = [...new Set(parseArray(body.targetSchoolIds).map(String).filter(isObjectId))];
    if (!targetSchoolIds.length) throw new Error("Please select at least one target Niswan.");
    const existingTargetsUnchanged = Boolean(
      existing &&
      existing.targetType === "SELECTED" &&
      sameIdSet(existing.targetSchoolIds, targetSchoolIds)
    );
    if (!existingTargetsUnchanged) {
      const activeSchools = await School.find({ _id: { $in: targetSchoolIds }, active: "Active" }).select("_id").lean();
      if (activeSchools.length !== targetSchoolIds.length) throw new Error("One or more selected Niswans are invalid or inactive.");
    }
  }

  return {
    academicYearId,
    acYear: academicYear.acYear,
    courseId,
    courseCode: clean(course.code),
    courseName: clean(course.name),
    studyingYear,
    examType,
    subjectNo,
    subjectCode: subject.subjectCode,
    subjectName: subject.subjectName,
    title: clean(body.title),
    examDate,
    examStartTime,
    availableFrom,
    availableUntil,
    timeZone: "Asia/Kolkata",
    targetType,
    targetSchoolIds,
    instructions: clean(body.instructions),
    publicationStatus,
  };
};

const sortedIds = (values = []) => [...new Set((values || []).map((id) => String(id?._id || id)))].sort();
const sameIdSet = (a = [], b = []) => JSON.stringify(sortedIds(a)) === JSON.stringify(sortedIds(b));
const sameInstant = (a, b) => {
  const ta = a ? new Date(a).getTime() : null;
  const tb = b ? new Date(b).getTime() : null;
  return ta === tb;
};

export const getExamQuestionOptions = async (req, res) => {
  try {
    const access = await getAccess(req);
    if (!access.canUse) return deny(res);
    const [academicYears, courses, schools] = await Promise.all([
      AcademicYear.find({}).select("_id acYear active").sort({ acYear: -1 }).lean(),
      Course.find({}).sort({ promotionOrder: 1, code: 1 }).lean(),
      access.isManager
        ? School.find({ active: "Active" }).select("_id code nameEnglish").sort({ code: 1 }).lean()
        : Promise.resolve(access.school ? [access.school] : []),
    ]);

    return res.json({
      success: true,
      access: { role: access.role, canManage: access.isManager, schoolId: access.school?._id || null },
      examTypes: EXAM_TYPES,
      academicYears,
      courses: courses.map((course) => ({
        _id: course._id,
        code: course.code,
        name: course.name,
        years: Number(course.years || 0),
        subjects: getCourseSubjects(course),
      })),
      schools,
      timeZone: "Asia/Kolkata",
      timeZoneLabel: "IST",
    });
  } catch (error) {
    console.error("getExamQuestionOptions:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to load Exam Question options." });
  }
};

export const listExamQuestions = async (req, res) => {
  try {
    const access = await getAccess(req);
    if (!access.canUse) return deny(res);

    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
    const filter = {};

    if (isObjectId(req.query.academicYearId)) filter.academicYearId = req.query.academicYearId;
    if (isObjectId(req.query.courseId)) filter.courseId = req.query.courseId;
    if (Number(req.query.studyingYear || 0) > 0) filter.studyingYear = Number(req.query.studyingYear);
    const examType = normalizeExamType(req.query.examType);
    if (examType) filter.examType = examType;
    const status = clean(req.query.status);
    if (["Draft", "Published", "Closed"].includes(status)) filter.publicationStatus = status;

    const search = clean(req.query.search);
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = ["subjectCode", "subjectName", "courseCode", "courseName", "title"].map((field) => ({
        [field]: { $regex: escaped, $options: "i" },
      }));
    }

    if (!access.isManager) {
      filter.publicationStatus = { $in: ["Published", "Closed"] };
      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [
            { targetType: "ALL" },
            { targetType: "SELECTED", targetSchoolIds: access.school._id },
          ],
        },
      ];
    }

    const [papers, total, activeSchools] = await Promise.all([
      ExamQuestionPaper.find(filter)
        .sort({ examDate: -1, examStartTime: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("targetSchoolIds", "code nameEnglish")
        .lean(),
      ExamQuestionPaper.countDocuments(filter),
      access.isManager ? School.find({ active: "Active" }).select("_id").lean() : Promise.resolve([]),
    ]);

    let statsMap = new Map();
    if (access.isManager && papers.length) {
      const stats = await ExamQuestionDownload.aggregate([
        { $match: { questionPaperId: { $in: papers.map((p) => p._id) } } },
        {
          $group: {
            _id: "$questionPaperId",
            totalDownloads: { $sum: 1 },
            schools: { $addToSet: "$schoolId" },
          },
        },
      ]);
      statsMap = new Map(stats.map((s) => [String(s._id), { totalDownloads: s.totalDownloads, schoolIds: (s.schools || []).map(String) }]));
    }

    const activeSchoolIds = new Set((activeSchools || []).map((school) => String(school._id)));
    const serialized = papers.map((paper) => {
      const rawStats = statsMap.get(String(paper._id)) || { totalDownloads: 0, schoolIds: [] };
      const targetIds = paper.targetType === "ALL"
        ? activeSchoolIds
        : new Set((paper.targetSchoolIds || []).map((school) => String(school?._id || school)));
      const downloadedSchoolCount = rawStats.schoolIds.filter((schoolId) => targetIds.has(String(schoolId))).length;
      return serializePaper(paper, {
        downloadStats: { totalDownloads: rawStats.totalDownloads, downloadedSchoolCount },
        targetCount: paper.targetType === "ALL" ? activeSchoolIds.size : (paper.targetSchoolIds || []).length,
        includeTargets: access.isManager,
      });
    });

    return res.json({ success: true, papers: serialized, page, limit, total });
  } catch (error) {
    console.error("listExamQuestions:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to load Question Papers." });
  }
};

export const getExamQuestion = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(400).json({ success: false, error: "Invalid Question Paper ID." });
    const access = await getAccess(req);
    if (!access.canUse) return deny(res);
    const paper = await ExamQuestionPaper.findById(req.params.id).populate("targetSchoolIds", "code nameEnglish").lean();
    if (!paper) return res.status(404).json({ success: false, error: "Question Paper not found." });
    if (!access.isManager) {
      if (paper.publicationStatus === "Draft" || !isTargetedToSchool(paper, access.school._id)) return deny(res);
    }
    return res.json({ success: true, paper: serializePaper(paper, { includeTargets: access.isManager }) });
  } catch (error) {
    console.error("getExamQuestion:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to load Question Paper." });
  }
};

export const createExamQuestion = async (req, res) => {
  let uploaded = null;
  try {
    if (!isManager(req)) return deny(res, "Only Superadmin and HQ User can create Question Papers.");
    const payload = await validateAndResolvePayload(req.body || {}, { requireFile: true, file: req.file });
    uploaded = await uploadQuestionPaperToDrive({
      file: req.file,
      academicYear: payload.acYear,
      courseCode: payload.courseCode,
      studyingYear: payload.studyingYear,
      examType: payload.examType,
      subjectCode: payload.subjectCode,
      examDate: payload.examDate,
    });

    const paper = await ExamQuestionPaper.create({
      ...payload,
      driveFileId: uploaded.fileId,
      driveFileName: uploaded.fileName,
      originalFileName: clean(req.file.originalname) || uploaded.fileName,
      fileSize: uploaded.fileSize,
      mimeType: uploaded.mimeType,
      driveFolderPath: uploaded.folderPath,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    return res.status(201).json({ success: true, message: "Question Paper saved successfully.", resourceId: paper._id, paper: serializePaper(paper, { includeTargets: true }) });
  } catch (error) {
    if (uploaded?.fileId) await deleteQuestionPaperFromDrive(uploaded.fileId).catch(() => null);
    console.error("createExamQuestion:", error?.message || error);
    const message = clean(error?.message) || "Unable to save Question Paper.";
    const status = /Google Drive/i.test(message) ? 503 : /required|valid|select|cannot|must|not found|inactive/i.test(message) ? 400 : 500;
    return res.status(status).json({ success: false, error: message });
  }
};

export const updateExamQuestion = async (req, res) => {
  let newUpload = null;
  try {
    if (!isManager(req)) return deny(res, "Only Superadmin and HQ User can edit Question Papers.");
    if (!isObjectId(req.params.id)) return res.status(400).json({ success: false, error: "Invalid Question Paper ID." });
    const existing = await ExamQuestionPaper.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: "Question Paper not found." });

    const payload = await validateAndResolvePayload(req.body || {}, { requireFile: false, file: req.file, existing });
    const downloadCount = await ExamQuestionDownload.countDocuments({ questionPaperId: existing._id });
    if (downloadCount > 0) {
      const lockedFieldChanged =
        String(existing.academicYearId) !== String(payload.academicYearId) ||
        String(existing.courseId) !== String(payload.courseId) ||
        Number(existing.studyingYear) !== Number(payload.studyingYear) ||
        existing.examType !== payload.examType ||
        Number(existing.subjectNo) !== Number(payload.subjectNo) ||
        clean(existing.examDate) !== clean(payload.examDate) ||
        clean(existing.examStartTime) !== clean(payload.examStartTime) ||
        !sameInstant(existing.availableFrom, payload.availableFrom) ||
        existing.targetType !== payload.targetType ||
        !sameIdSet(existing.targetSchoolIds, payload.targetSchoolIds);

      if (req.file || lockedFieldChanged) {
        return res.status(409).json({
          success: false,
          error: "This Question Paper has already been downloaded by a Niswan. PDF, exam details, release time and targets are locked. You may only update title/instructions, close time or close the paper.",
        });
      }
      if (payload.publicationStatus === "Draft") {
        return res.status(409).json({
          success: false,
          error: "A downloaded Question Paper cannot be moved back to Draft. Close it instead.",
        });
      }
      if (existing.publicationStatus === "Closed" && payload.publicationStatus !== "Closed") {
        return res.status(409).json({
          success: false,
          error: "A downloaded Question Paper that has been Closed cannot be reopened.",
        });
      }
    }
    if (req.file) {
      newUpload = await uploadQuestionPaperToDrive({
        file: req.file,
        academicYear: payload.acYear,
        courseCode: payload.courseCode,
        studyingYear: payload.studyingYear,
        examType: payload.examType,
        subjectCode: payload.subjectCode,
        examDate: payload.examDate,
      });
    }

    const oldFileId = existing.driveFileId;
    Object.assign(existing, payload, {
      ...(newUpload
        ? {
            driveFileId: newUpload.fileId,
            driveFileName: newUpload.fileName,
            originalFileName: clean(req.file.originalname) || newUpload.fileName,
            fileSize: newUpload.fileSize,
            mimeType: newUpload.mimeType,
            driveFolderPath: newUpload.folderPath,
          }
        : {}),
      updatedBy: req.user._id,
    });
    await existing.save();

    if (newUpload?.fileId && oldFileId && oldFileId !== newUpload.fileId) {
      await deleteQuestionPaperFromDrive(oldFileId).catch((e) => console.warn("Unable to delete replaced Drive question paper:", e?.message || e));
    }

    return res.json({ success: true, message: "Question Paper updated successfully.", resourceId: existing._id, paper: serializePaper(existing, { includeTargets: true }) });
  } catch (error) {
    if (newUpload?.fileId) await deleteQuestionPaperFromDrive(newUpload.fileId).catch(() => null);
    console.error("updateExamQuestion:", error?.message || error);
    const message = clean(error?.message) || "Unable to update Question Paper.";
    const status = /Google Drive/i.test(message) ? 503 : /required|valid|select|cannot|must|not found|inactive/i.test(message) ? 400 : 500;
    return res.status(status).json({ success: false, error: message });
  }
};

export const deleteExamQuestion = async (req, res) => {
  try {
    if (!isManager(req)) return deny(res, "Only Superadmin and HQ User can delete Question Papers.");
    if (!isObjectId(req.params.id)) return res.status(400).json({ success: false, error: "Invalid Question Paper ID." });
    const paper = await ExamQuestionPaper.findById(req.params.id);
    if (!paper) return res.status(404).json({ success: false, error: "Question Paper not found." });
    const downloadCount = await ExamQuestionDownload.countDocuments({ questionPaperId: paper._id });
    if (downloadCount > 0) {
      return res.status(409).json({ success: false, error: "This Question Paper has already been downloaded. It cannot be deleted; set it to Closed instead." });
    }
    if (paper.publicationStatus !== "Draft") {
      return res.status(409).json({ success: false, error: "Only Draft Question Papers can be deleted. Move it to Draft first if it has never been downloaded." });
    }

    await Promise.all([
      ExamQuestionDownload.deleteMany({ questionPaperId: paper._id }),
      ExamQuestionPaper.deleteOne({ _id: paper._id }),
    ]);
    await deleteQuestionPaperFromDrive(paper.driveFileId).catch((e) => console.warn("Unable to delete Drive question paper:", e?.message || e));

    return res.json({ success: true, message: "Question Paper deleted successfully.", resourceId: paper._id });
  } catch (error) {
    console.error("deleteExamQuestion:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to delete Question Paper." });
  }
};

export const getExamQuestionFile = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(400).json({ success: false, error: "Invalid Question Paper ID." });
    const access = await getAccess(req);
    if (!access.canUse) return deny(res);
    const paper = await ExamQuestionPaper.findById(req.params.id).lean();
    if (!paper) return res.status(404).json({ success: false, error: "Question Paper not found." });

    if (!access.isManager) {
      if (!isTargetedToSchool(paper, access.school._id)) return deny(res, "This Question Paper is not assigned to your Niswan.");
      if (paper.publicationStatus !== "Published") return deny(res, "This Question Paper is not released.");
      const status = effectiveStatus(paper);
      if (status === "Scheduled") return res.status(403).json({ success: false, error: `Question Paper will be available from ${formatIstParts(paper.availableFrom).date} ${formatIstParts(paper.availableFrom).time} IST.` });
      if (status === "Closed") return res.status(403).json({ success: false, error: "Question Paper download is closed." });
    }

    const buffer = await downloadQuestionPaperFromDrive(paper.driveFileId);
    const mode = clean(req.query.mode).toLowerCase() === "inline" ? "inline" : "attachment";
    const safeName = clean(paper.originalFileName || paper.driveFileName || "question-paper.pdf").replace(/[\r\n"\\]/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Content-Disposition", `${mode}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`);

    if (!access.isManager) {
      await ExamQuestionDownload.create({
        questionPaperId: paper._id,
        schoolId: access.school._id,
        userId: req.user._id,
        downloadedAt: new Date(),
        userAgent: clean(req.headers["user-agent"]).slice(0, 500),
      }).catch((e) => console.warn("Exam Question access audit failed:", e?.message || e));
    }

    return res.status(200).send(buffer);
  } catch (error) {
    console.error("getExamQuestionFile:", error?.message || error);
    const message = clean(error?.message);
    if (/Google Drive not connected|invalid_grant|reconnect Google Drive/i.test(message)) {
      return res.status(503).json({ success: false, error: "Google Drive is not available. Please ask HQ to reconnect Google Drive." });
    }
    return res.status(500).json({ success: false, error: "Unable to download Question Paper." });
  }
};

export const getExamQuestionDownloads = async (req, res) => {
  try {
    if (!isManager(req)) return deny(res, "Download tracking is available only to HQ users.");
    if (!isObjectId(req.params.id)) return res.status(400).json({ success: false, error: "Invalid Question Paper ID." });
    const paper = await ExamQuestionPaper.findById(req.params.id).lean();
    if (!paper) return res.status(404).json({ success: false, error: "Question Paper not found." });

    const targetSchools = paper.targetType === "ALL"
      ? await School.find({ active: "Active" }).select("_id code nameEnglish").sort({ code: 1 }).lean()
      : await School.find({ _id: { $in: paper.targetSchoolIds || [] } }).select("_id code nameEnglish active").sort({ code: 1 }).lean();

    const rows = await ExamQuestionDownload.find({ questionPaperId: paper._id })
      .select("schoolId userId downloadedAt")
      .populate("schoolId", "code nameEnglish")
      .populate("userId", "name role")
      .sort({ downloadedAt: -1 })
      .lean();

    const firstBySchool = new Map();
    for (const row of [...rows].reverse()) {
      const sid = String(row.schoolId?._id || "");
      if (sid && !firstBySchool.has(sid)) firstBySchool.set(sid, row);
    }
    const targetIdSet = new Set(targetSchools.map((school) => String(school._id)));
    const downloadedIds = new Set(
      rows
        .map((row) => String(row.schoolId?._id || ""))
        .filter((sid) => sid && targetIdSet.has(sid))
    );
    const pendingSchools = targetSchools.filter((school) => !downloadedIds.has(String(school._id)));

    return res.json({
      success: true,
      summary: {
        targetCount: targetSchools.length,
        downloadedSchoolCount: downloadedIds.size,
        pendingCount: pendingSchools.length,
        totalDownloads: rows.length,
      },
      downloads: rows,
      firstDownloadBySchool: [...firstBySchool.entries()]
        .filter(([schoolId]) => targetIdSet.has(schoolId))
        .map(([, row]) => row),
      pendingSchools,
    });
  } catch (error) {
    console.error("getExamQuestionDownloads:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to load download tracking." });
  }
};
