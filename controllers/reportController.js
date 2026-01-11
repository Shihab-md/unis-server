import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import School from "../models/School.js";
import Supervisor from "../models/Supervisor.js";
import Student from "../models/Student.js";
import Course from "../models/Course.js";
import AcademicYear from "../models/AcademicYear.js";
import Account from "../models/Account.js";

import getRedis from "../db/redis.js";
import { sendCSV, sendXLSX, sendXLSXMulti } from "../utils/reportExport.js";

// ------------------------------
// Helpers
// ------------------------------

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const isObjectIdLike = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const safeStr = (v) => (v === undefined || v === null ? "" : String(v).trim());

function getAuthPayload(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return jwt.verify(token, process.env.JWT_SECRET);
}

// Returns:
// - null => user can access all schools
// - [] => user has no schools
// - [ObjectIdStrings...] => restricted list
async function getAccessibleSchoolIds({ role, schoolId, userId }) {
  const r = String(role || "").toLowerCase();

  // all schools
  if (r === "superadmin" || r === "hquser") return null;

  // admin -> own school from token
  if (r === "admin") return schoolId && isObjectIdLike(schoolId) ? [String(schoolId)] : [];

  // supervisor -> schools under this supervisor
  if (r === "supervisor") {
    const uid = safeStr(userId);
    if (!uid) return [];

    // In your DB, School.supervisorId might store:
    // - Supervisor._id (most common)
    // - or Supervisor.userId
    // We'll support both.
    const sup = await Supervisor.findOne({ userId: uid }).select("_id userId").lean();
    const possibleSupervisorIds = [];
    if (sup?._id) possibleSupervisorIds.push(String(sup._id));
    possibleSupervisorIds.push(uid);

    const schools = await School.find({ supervisorId: { $in: possibleSupervisorIds } })
      .select("_id")
      .lean();

    return schools.map((s) => String(s._id));
  }

  // default: restrict to token school if present
  return schoolId && isObjectIdLike(schoolId) ? [String(schoolId)] : [];
}

function buildStudentScope({ allowedSchoolIds, schoolIdFilter }) {
  // All access
  if (allowedSchoolIds === null) {
    if (schoolIdFilter && isObjectIdLike(schoolIdFilter)) return { schoolId: oid(schoolIdFilter) };
    return {};
  }

  // Restricted but none
  if (!Array.isArray(allowedSchoolIds) || allowedSchoolIds.length === 0) {
    return { schoolId: { $in: [] } };
  }

  const allowedSet = new Set(allowedSchoolIds.map(String));
  if (schoolIdFilter && allowedSet.has(String(schoolIdFilter))) {
    return { schoolId: oid(schoolIdFilter) };
  }

  return { schoolId: { $in: allowedSchoolIds.map(oid) } };
}

function exportByFormat(res, format, filenameBase, rows, columns, sheetName) {
  const f = String(format || "csv").toLowerCase();
  if (f === "xlsx") return sendXLSX(res, filenameBase, rows, sheetName || "Report");
  return sendCSV(res, filenameBase, rows, columns);
}

// ------------------------------
// GET /api/report/meta
// Filters drawer meta (scoped by role)
// ------------------------------
export const getReportMeta = async (req, res) => {
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ success: false, error: "Unauthorized" });

    const role = payload.role;
    const userId = payload.id || payload._id || payload.userId;
    const tokenSchoolId = payload.schoolId;

    const allowedSchoolIds = await getAccessibleSchoolIds({ role, schoolId: tokenSchoolId, userId });

    const schoolQuery = allowedSchoolIds === null ? {} : { _id: { $in: allowedSchoolIds.map(oid) } };

    const [schools, courses, academicYears] = await Promise.all([
      School.find(schoolQuery).select("_id code nameEnglish").sort({ code: 1 }).lean(),
      Course.find().select("_id name type code").sort({ name: 1 }).lean(),
      AcademicYear.find().select("_id acYear").sort({ acYear: 1 }).lean(),
    ]);

    return res.status(200).json({ success: true, schools, courses, academicYears });
  } catch (e) {
    console.log(e);
    return res.status(500).json({ success: false, error: "report meta error" });
  }
};

// ------------------------------
// GET /api/report/home
// KPI + Trends + Preview tables (cached)
// ------------------------------
export const getReportsHome = async (req, res) => {
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ success: false, error: "Unauthorized" });

    const role = payload.role;
    const userId = payload.id || payload._id || payload.userId;
    const tokenSchoolId = payload.schoolId;

    const months = Math.min(24, Math.max(3, Number(req.query.months || 12)));
    const schoolIdFilter = req.query.schoolId;
    const courseId = req.query.courseId;
    const acYear = req.query.acYear;
    const status = req.query.status;
 
    const allowedSchoolIds = await getAccessibleSchoolIds({ role, schoolId: tokenSchoolId, userId });

    const cacheKey = `rep:home:${safeStr(role)}:${safeStr(userId)}:${safeStr(months)}:${safeStr(
      schoolIdFilter
    )}:${safeStr(courseId)}:${safeStr(acYear)}:${safeStr(status)}`;

    const redis = await getRedis().catch(() => null);
    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached) return res.status(200).json(JSON.parse(cached));
    }

    const studentScope = buildStudentScope({ allowedSchoolIds, schoolIdFilter });

    // optional student filters
    const studentMatch = { ...studentScope };
    if (status) studentMatch.active = status;
    if (courseId && isObjectIdLike(courseId)) studentMatch.courses = oid(courseId);

    // KPIs
    const [totalStudents, feesPaid, activeCount, graduatedCount] = await Promise.all([
      Student.countDocuments(studentMatch),
      Student.countDocuments({ ...studentMatch, feesPaid: 1 }),
      Student.countDocuments({ ...studentMatch, active: "Active" }),
      Student.countDocuments({ ...studentMatch, active: "Graduated" }),
    ]);

    const feesUnpaid = Math.max(0, totalStudents - feesPaid);

    // Trends range
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

    // Admissions per month
    const admissionsTrend = await Student.aggregate([
      { $match: { ...studentMatch, doa: { $gte: start } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$doa" } },
          admissions: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, month: "$_id", admissions: 1 } },
    ]);

    // Fees collection per month
    // NOTE: Account.userId is User._id. Student.userId is User._id.
    // We'll join Account -> Student (by userId) -> school scope.
    const feesPipeline = [
      // compute paidAmount = paid ?? fees
      { $addFields: { paidAmount: { $ifNull: ["$paid", "$fees"] } } },
      {
        $match: {
          type: "fees",
          paidDate: { $gte: start },
          paidAmount: { $gt: 0 },
          ...(acYear && isObjectIdLike(acYear) ? { acYear: oid(acYear) } : {}),
        },
      },
      {
        $lookup: {
          from: "students",
          localField: "userId",
          foreignField: "userId",
          as: "student",
          pipeline: [
            { $project: { _id: 1, schoolId: 1, courses: 1, active: 1 } },
          ],
        },
      },
      { $unwind: "$student" },
    ];

    // Apply school scope to the joined student
    if (studentScope?.schoolId?.$in) {
      feesPipeline.push({ $match: { "student.schoolId": { $in: studentScope.schoolId.$in } } });
    } else if (studentScope?.schoolId instanceof mongoose.Types.ObjectId) {
      feesPipeline.push({ $match: { "student.schoolId": studentScope.schoolId } });
    }
    // optional student filters
    if (courseId && isObjectIdLike(courseId)) {
      feesPipeline.push({ $match: { "student.courses": oid(courseId) } });
    }
    if (status) {
      feesPipeline.push({ $match: { "student.active": status } });
    }

    feesPipeline.push(
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$paidDate" } },
          amount: { $sum: "$paidAmount" },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, month: "$_id", amount: 1 } }
    );

    const feesCollectionTrend = await Account.aggregate(feesPipeline);

    // Previews
    const [latestUnpaidRaw, latestAdmissionsRaw] = await Promise.all([
      Student.find({ ...studentMatch, feesPaid: 0 })
        .select("_id name rollNumber feesPaid doa active schoolId")
        .populate({ path: "schoolId", select: "code nameEnglish" })
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean(),

      Student.find({ ...studentMatch })
        .select("_id name rollNumber feesPaid doa active schoolId")
        .populate({ path: "schoolId", select: "code nameEnglish" })
        .sort({ doa: -1 })
        .limit(10)
        .lean(),
    ]);

    const maskRoll = (s) => {
      const isPaid = Number(s?.feesPaid) === 1 || s?.feesPaid === true;
      return { ...s, rollNumber: isPaid ? s.rollNumber : null };
    };

    const result = {
      success: true,
      filters: {
        months,
        schoolId: schoolIdFilter || null,
        courseId: courseId || null,
        acYear: acYear || null,
        status: status || null,
      },
      kpis: {
        totalStudents,
        feesPaid,
        feesUnpaid,
        active: activeCount,
        graduated: graduatedCount,
      },
      trends: {
        admissions: admissionsTrend,
        feesCollection: feesCollectionTrend,
      },
      previews: {
        latestUnpaid: latestUnpaidRaw.map((s) => ({ ...s, rollNumber: null })),
        latestAdmissions: latestAdmissionsRaw.map(maskRoll),
      },
    };

    if (redis) {
      await redis.set(cacheKey, JSON.stringify(result), { EX: 60 });
    }

    return res.status(200).json(result);
  } catch (e) {
    console.log(e);
    return res.status(500).json({ success: false, error: "reports home server error" });
  }
};

// ------------------------------
// GET /api/report/home/export?format=csv|xlsx
// Exports KPI + trends + previews
// ------------------------------
export const exportReportsHome = async (req, res) => {
  const format = String(req.query.format || "xlsx").toLowerCase();

  // Reuse the same computation (without redis writes) by calling getReportsHomeLogic
  const data = await getReportsHomeLogic(req);
  if (!data?.success) {
    return res.status(400).json({ success: false, error: data?.error || "Failed to export" });
  }

  const filenameBase = `Reports_Home_${Date.now()}`;

  if (format === "csv") {
    // CSV: only KPIs as one row
    const row = {
      totalStudents: data.kpis.totalStudents,
      feesPaid: data.kpis.feesPaid,
      feesUnpaid: data.kpis.feesUnpaid,
      active: data.kpis.active,
      graduated: data.kpis.graduated,
    };
    return sendCSV(res, filenameBase, [row], Object.keys(row));
  }

  // XLSX: multi sheet
  const sheets = [
    { name: "KPIs", rows: [data.kpis] },
    { name: "AdmissionsTrend", rows: data.trends.admissions || [] },
    { name: "FeesTrend", rows: data.trends.feesCollection || [] },
    { name: "LatestUnpaid", rows: data.previews.latestUnpaid || [] },
    { name: "LatestAdmissions", rows: data.previews.latestAdmissions || [] },
  ];

  return sendXLSXMulti(res, filenameBase, sheets);
};

async function getReportsHomeLogic(req) {
  try {
    const payload = getAuthPayload(req);
    if (!payload) return { success: false, error: "Unauthorized" };

    const role = payload.role;
    const userId = payload.id || payload._id || payload.userId;
    const tokenSchoolId = payload.schoolId;

    const months = Math.min(24, Math.max(3, Number(req.query.months || 12)));
    const schoolIdFilter = req.query.schoolId;
    const courseId = req.query.courseId;
    const acYear = req.query.acYear;
    const status = req.query.status;

    const allowedSchoolIds = await getAccessibleSchoolIds({ role, schoolId: tokenSchoolId, userId });
    const studentScope = buildStudentScope({ allowedSchoolIds, schoolIdFilter });

    const studentMatch = { ...studentScope };
    if (status) studentMatch.active = status;
    if (courseId && isObjectIdLike(courseId)) studentMatch.courses = oid(courseId);

    const [totalStudents, feesPaid, activeCount, graduatedCount] = await Promise.all([
      Student.countDocuments(studentMatch),
      Student.countDocuments({ ...studentMatch, feesPaid: 1 }),
      Student.countDocuments({ ...studentMatch, active: "Active" }),
      Student.countDocuments({ ...studentMatch, active: "Graduated" }),
    ]);

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

    const admissionsTrend = await Student.aggregate([
      { $match: { ...studentMatch, doa: { $gte: start } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$doa" } }, admissions: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, month: "$_id", admissions: 1 } },
    ]);

    const feesPipeline = [
      { $addFields: { paidAmount: { $ifNull: ["$paid", "$fees"] } } },
      {
        $match: {
          type: "fees",
          paidDate: { $gte: start },
          paidAmount: { $gt: 0 },
          ...(acYear && isObjectIdLike(acYear) ? { acYear: oid(acYear) } : {}),
        },
      },
      {
        $lookup: {
          from: "students",
          localField: "userId",
          foreignField: "userId",
          as: "student",
          pipeline: [{ $project: { _id: 1, schoolId: 1, courses: 1, active: 1 } }],
        },
      },
      { $unwind: "$student" },
    ];

    if (studentScope?.schoolId?.$in) feesPipeline.push({ $match: { "student.schoolId": { $in: studentScope.schoolId.$in } } });
    if (studentScope?.schoolId && studentScope.schoolId instanceof mongoose.Types.ObjectId) feesPipeline.push({ $match: { "student.schoolId": studentScope.schoolId } });
    if (courseId && isObjectIdLike(courseId)) feesPipeline.push({ $match: { "student.courses": oid(courseId) } });
    if (status) feesPipeline.push({ $match: { "student.active": status } });

    feesPipeline.push(
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$paidDate" } }, amount: { $sum: "$paidAmount" } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, month: "$_id", amount: 1 } }
    );

    const feesCollectionTrend = await Account.aggregate(feesPipeline);

    const [latestUnpaidRaw, latestAdmissionsRaw] = await Promise.all([
      Student.find({ ...studentMatch, feesPaid: 0 })
        .select("_id name rollNumber feesPaid doa active schoolId")
        .populate({ path: "schoolId", select: "code nameEnglish" })
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean(),
      Student.find({ ...studentMatch })
        .select("_id name rollNumber feesPaid doa active schoolId")
        .populate({ path: "schoolId", select: "code nameEnglish" })
        .sort({ doa: -1 })
        .limit(10)
        .lean(),
    ]);

    const maskRoll = (s) => {
      const isPaid = Number(s?.feesPaid) === 1 || s?.feesPaid === true;
      return { ...s, rollNumber: isPaid ? s.rollNumber : null };
    };

    return {
      success: true,
      kpis: {
        totalStudents,
        feesPaid,
        feesUnpaid: Math.max(0, totalStudents - feesPaid),
        active: activeCount,
        graduated: graduatedCount,
      },
      trends: { admissions: admissionsTrend, feesCollection: feesCollectionTrend },
      previews: {
        latestUnpaid: latestUnpaidRaw.map((s) => ({ ...s, rollNumber: null })),
        latestAdmissions: latestAdmissionsRaw.map(maskRoll),
      },
    };
  } catch (e) {
    console.log(e);
    return { success: false, error: "Failed to build report" };
  }
}

// ------------------------------
// Niswan Report (School-wise summary)
// GET /api/report/niswan
// GET /api/report/niswan/export?format=csv|xlsx
// ------------------------------
export const getNiswanReport = async (req, res) => {
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ success: false, error: "Unauthorized" });

    const role = payload.role;
    const userId = payload.id || payload._id || payload.userId;
    const tokenSchoolId = payload.schoolId;

    const allowedSchoolIds = await getAccessibleSchoolIds({ role, schoolId: tokenSchoolId, userId });
    const schoolCode = safeStr(req.query.schoolCode);
    const q = safeStr(req.query.q);

    const cacheKey = `rep:niswan:${safeStr(role)}:${safeStr(userId)}:${safeStr(schoolCode)}:${safeStr(q)}`;
    const redis = await getRedis().catch(() => null);
    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached) return res.status(200).json(JSON.parse(cached));
    }

    // 1) Find scoped schools first (fast, and allows filtering by code/name)
    const schoolQuery = {};
    if (allowedSchoolIds !== null) schoolQuery._id = { $in: allowedSchoolIds.map(oid) };
    if (schoolCode) schoolQuery.code = schoolCode;
    if (q) {
      const rx = new RegExp(q, "i");
      schoolQuery.$or = [{ code: rx }, { nameEnglish: rx }];
    }

    const schools = await School.find(schoolQuery)
      .select("_id code nameEnglish")
      .sort({ code: 1 })
      .lean();

    if (!schools || schools.length === 0) {
      const empty = { success: true, rows: [] };
      if (redis) await redis.set(cacheKey, JSON.stringify(empty), { EX: 60 });
      return res.status(200).json(empty);
    }

    const schoolIds = schools.map((s) => s._id);

    // 2) Aggregate student stats grouped by schoolId
    const stats = await Student.aggregate([
      { $match: { schoolId: { $in: schoolIds } } },
      {
        $group: {
          _id: "$schoolId",
          totalStudents: { $sum: 1 },
          activeStudents: { $sum: { $cond: [{ $eq: ["$active", "Active"] }, 1, 0] } },
          graduatedStudents: { $sum: { $cond: [{ $eq: ["$active", "Graduated"] }, 1, 0] } },
          feesPaid: { $sum: { $cond: [{ $eq: ["$feesPaid", 1] }, 1, 0] } },
          unpaid: {
            $sum: {
              $cond: [
                { $or: [{ $eq: ["$feesPaid", 0] }, { $eq: ["$feesPaid", null] }] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const statsMap = new Map(stats.map((s) => [String(s._id), s]));

    const rows = schools.map((sch) => {
      const st = statsMap.get(String(sch._id)) || {};
      return {
        _id: sch._id,
        code: sch.code || "",
        nameEnglish: sch.nameEnglish || "",
        totalStudents: Number(st.totalStudents || 0),
        feesPaid: Number(st.feesPaid || 0),
        unpaid: Number(st.unpaid || 0),
        activeStudents: Number(st.activeStudents || 0),
        graduatedStudents: Number(st.graduatedStudents || 0),
      };
    });

    const out = { success: true, rows };
    if (redis) await redis.set(cacheKey, JSON.stringify(out), { EX: 60 });
    return res.status(200).json(out);
  } catch (e) {
    console.log(e);
    return res.status(500).json({ success: false, error: "Niswan report server error" });
  }
};

export const exportNiswanReport = async (req, res) => {
  try {
    const format = String(req.query.format || "csv").toLowerCase();
    // build same data (no redis writes necessary)
    const fakeRes = null;
    // reuse handler logic by calling getNiswanReportLogic
    const data = await getNiswanReportLogic(req);
    if (!data?.success) return res.status(400).json({ success: false, error: data?.error || "Failed" });

    const rows = data.rows || [];
    const filenameBase = `Niswan_Report_${Date.now()}`;
    return exportByFormat(res, format, filenameBase, rows, Object.keys(rows[0] || {}), "Niswan");
  } catch (e) {
    console.log(e);
    return res.status(500).json({ success: false, error: "Export server error" });
  }
};

async function getNiswanReportLogic(req) {
  const payload = getAuthPayload(req);
  if (!payload) return { success: false, error: "Unauthorized" };

  const role = payload.role;
  const userId = payload.id || payload._id || payload.userId;
  const tokenSchoolId = payload.schoolId;

  const allowedSchoolIds = await getAccessibleSchoolIds({ role, schoolId: tokenSchoolId, userId });
  const schoolCode = safeStr(req.query.schoolCode);
  const q = safeStr(req.query.q);

  const schoolQuery = {};
  if (allowedSchoolIds !== null) schoolQuery._id = { $in: allowedSchoolIds.map(oid) };
  if (schoolCode) schoolQuery.code = schoolCode;
  if (q) {
    const rx = new RegExp(q, "i");
    schoolQuery.$or = [{ code: rx }, { nameEnglish: rx }];
  }

  const schools = await School.find(schoolQuery).select("_id code nameEnglish").sort({ code: 1 }).lean();
  if (!schools || schools.length === 0) return { success: true, rows: [] };

  const schoolIds = schools.map((s) => s._id);
  const stats = await Student.aggregate([
    { $match: { schoolId: { $in: schoolIds } } },
    {
      $group: {
        _id: "$schoolId",
        totalStudents: { $sum: 1 },
        activeStudents: { $sum: { $cond: [{ $eq: ["$active", "Active"] }, 1, 0] } },
        graduatedStudents: { $sum: { $cond: [{ $eq: ["$active", "Graduated"] }, 1, 0] } },
        feesPaid: { $sum: { $cond: [{ $eq: ["$feesPaid", 1] }, 1, 0] } },
        unpaid: { $sum: { $cond: [{ $or: [{ $eq: ["$feesPaid", 0] }, { $eq: ["$feesPaid", null] }] }, 1, 0] } },
      },
    },
  ]);

  const statsMap = new Map(stats.map((s) => [String(s._id), s]));
  const rows = schools.map((sch) => {
    const st = statsMap.get(String(sch._id)) || {};
    return {
      _id: sch._id,
      code: sch.code || "",
      nameEnglish: sch.nameEnglish || "",
      totalStudents: Number(st.totalStudents || 0),
      feesPaid: Number(st.feesPaid || 0),
      unpaid: Number(st.unpaid || 0),
      activeStudents: Number(st.activeStudents || 0),
      graduatedStudents: Number(st.graduatedStudents || 0),
    };
  });

  return { success: true, rows };
}
