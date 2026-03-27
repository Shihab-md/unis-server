import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import School from "../models/School.js";
import Supervisor from "../models/Supervisor.js";
import Student from "../models/Student.js";
import Course from "../models/Course.js";
import AcademicYear from "../models/AcademicYear.js";
import Academic from "../models/Academic.js";
import Account from "../models/Account.js";

import getRedis from "../db/redis.js";
import { sendCSV, sendXLSX, sendXLSXMulti } from "../utils/reportExport.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const isObjectIdLike = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const safeStr = (v) => (v === undefined || v === null ? "" : String(v).trim());
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function getAuthPayload(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return jwt.verify(token, process.env.JWT_SECRET);
}

async function getAccessibleSchoolIds({ role, schoolId, userId }) {
  const r = String(role || "").toLowerCase();

  if (r === "superadmin" || r === "hquser") return null;

  if (r === "admin") {
    return schoolId && isObjectIdLike(schoolId) ? [String(schoolId)] : [];
  }

  if (r === "supervisor") {
    const uid = safeStr(userId);
    if (!uid) return [];

    const sup = await Supervisor.findOne({ userId: uid }).select("_id userId").lean();

    const possibleSupervisorIds = [];
    if (sup?._id) possibleSupervisorIds.push(String(sup._id));
    possibleSupervisorIds.push(uid);

    const schools = await School.find({
      supervisorId: { $in: possibleSupervisorIds },
    })
      .select("_id")
      .lean();

    return schools.map((s) => String(s._id));
  }

  return schoolId && isObjectIdLike(schoolId) ? [String(schoolId)] : [];
}

async function resolveSchoolScope({ allowedSchoolIds, schoolIdFilter, schoolCode, q }) {
  if (schoolIdFilter && isObjectIdLike(schoolIdFilter)) {
    if (allowedSchoolIds === null) return [String(schoolIdFilter)];
    return allowedSchoolIds.includes(String(schoolIdFilter)) ? [String(schoolIdFilter)] : [];
  }

  const hasExtraSchoolFilter = Boolean(safeStr(schoolCode) || safeStr(q));
  if (!hasExtraSchoolFilter) return allowedSchoolIds;

  const schoolQuery = {};
  if (allowedSchoolIds !== null) {
    schoolQuery._id = { $in: allowedSchoolIds.map(oid) };
  }
  if (safeStr(schoolCode)) {
    schoolQuery.code = safeStr(schoolCode);
  }
  if (safeStr(q)) {
    const rx = new RegExp(escapeRegex(safeStr(q)), "i");
    schoolQuery.$or = [{ code: rx }, { nameEnglish: rx }];
  }

  const schools = await School.find(schoolQuery).select("_id").lean();
  return schools.map((s) => String(s._id));
}

function buildStudentScopeFromResolvedSchoolIds(resolvedSchoolIds) {
  if (resolvedSchoolIds === null) return {};
  if (!Array.isArray(resolvedSchoolIds) || resolvedSchoolIds.length === 0) {
    return { schoolId: { $in: [] } };
  }
  return { schoolId: { $in: resolvedSchoolIds.map(oid) } };
}

async function getStudentIdsByAcademicFilter({ acYear, courseId }) {
  const match = {};

  if (acYear && isObjectIdLike(acYear)) {
    match.acYear = oid(acYear);
  }

  if (courseId && isObjectIdLike(courseId)) {
    match.$or = [
      { courseId1: oid(courseId) },
      { courseId2: oid(courseId) },
      { courseId3: oid(courseId) },
      { courseId4: oid(courseId) },
      { courseId5: oid(courseId) },
    ];
  }

  if (Object.keys(match).length === 0) return null;

  return Academic.distinct("studentId", match);
}

function buildStudentMatch({
  resolvedSchoolIds,
  status,
  feesStatus,
  hostel,
  studentIdsByAcademic,
}) {
  const match = buildStudentScopeFromResolvedSchoolIds(resolvedSchoolIds);

  if (status) match.active = status;
  if (hostel === "Yes" || hostel === "No") match.hostel = hostel;
  if (feesStatus === "Paid") match.feesPaid = 1;
  if (feesStatus === "Unpaid") match.feesPaid = 0;

  if (Array.isArray(studentIdsByAcademic)) {
    match._id = { $in: studentIdsByAcademic.map((id) => oid(id)) };
  }

  return match;
}

function buildMonthKeys(months) {
  const total = Math.min(24, Math.max(3, Number(months || 12)));
  const now = new Date();
  const firstMonth = new Date(now.getFullYear(), now.getMonth() - (total - 1), 1);
  const keys = [];

  for (let i = 0; i < total; i += 1) {
    const d = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  return {
    keys,
    startDate: firstMonth,
    monthStart: new Date(now.getFullYear(), now.getMonth(), 1),
  };
}

function buildFilledMonthlySeries(monthKeys, rawRows, valueKey, aliasKey) {
  const map = new Map(
    (Array.isArray(rawRows) ? rawRows : []).map((row) => [String(row.month), Number(row[valueKey] || 0)])
  );

  return monthKeys.map((month) => ({
    month,
    [valueKey]: map.get(month) || 0,
    ...(aliasKey ? { [aliasKey]: map.get(month) || 0 } : {}),
  }));
}

function formatSchoolLabel(school) {
  const code = safeStr(school?.code);
  const name = safeStr(school?.nameEnglish);
  if (code && name) return `${code} : ${name}`;
  return code || name || "-";
}

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB");
}

function makePreviewRow(student, { hideRoll = false } = {}) {
  const firstCourse = Array.isArray(student?.courses) ? student.courses[0] : null;
  const paid = Number(student?.feesPaid) === 1 || student?.feesPaid === true;

  return {
    _id: student?._id,
    name: safeStr(student?.userId?.name) || "-",
    rollNumber: hideRoll ? null : safeStr(student?.rollNumber) || null,
    school: formatSchoolLabel(student?.schoolId),
    schoolCode: safeStr(student?.schoolId?.code) || "-",
    schoolName: safeStr(student?.schoolId?.nameEnglish) || "-",
    course: safeStr(firstCourse?.name) || "-",
    courseType: safeStr(firstCourse?.type) || "-",
    date: formatDate(student?.doa),
    status: safeStr(student?.active) || "-",
    hostel: safeStr(student?.hostel) || "No",
    feesStatus: paid ? "Paid" : "Unpaid",
  };
}

async function buildFeesCollectionSeries({
  startDate,
  monthStart,
  acYear,
  resolvedSchoolIds,
  status,
  hostel,
  feesStatus,
  studentIdsByAcademic,
}) {
  const pipeline = [
    { $addFields: { paidAmount: { $ifNull: ["$paid", "$fees"] } } },
    {
      $match: {
        type: "fees",
        paidDate: { $gte: startDate },
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
        pipeline: [{ $project: { _id: 1, schoolId: 1, active: 1, hostel: 1, feesPaid: 1 } }],
      },
    },
    { $unwind: "$student" },
  ];

  if (resolvedSchoolIds !== null) {
    pipeline.push({ $match: { "student.schoolId": { $in: resolvedSchoolIds.map(oid) } } });
  }

  if (status) {
    pipeline.push({ $match: { "student.active": status } });
  }

  if (hostel === "Yes" || hostel === "No") {
    pipeline.push({ $match: { "student.hostel": hostel } });
  }

  if (feesStatus === "Paid") {
    pipeline.push({ $match: { "student.feesPaid": 1 } });
  }

  if (feesStatus === "Unpaid") {
    pipeline.push({ $match: { "student.feesPaid": 0 } });
  }

  if (Array.isArray(studentIdsByAcademic)) {
    pipeline.push({ $match: { "student._id": { $in: studentIdsByAcademic.map((id) => oid(id)) } } });
  }

  const [monthlyRows, thisMonthRows] = await Promise.all([
    Account.aggregate([
      ...pipeline,
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$paidDate" } },
          amount: { $sum: "$paidAmount" },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, month: "$_id", amount: 1 } },
    ]),
    Account.aggregate([
      ...pipeline,
      { $match: { paidDate: { $gte: monthStart } } },
      {
        $group: {
          _id: null,
          amount: { $sum: "$paidAmount" },
        },
      },
    ]),
  ]);

  return {
    monthlyRows,
    thisMonthAmount: Number(thisMonthRows?.[0]?.amount || 0),
  };
}

function buildCacheKey(prefix, parts = []) {
  return [prefix, ...parts.map((part) => safeStr(part))].join(":");
}

async function getReportsHomeLogic(req, { useCache = false } = {}) {
  try {
    const payload = getAuthPayload(req);
    if (!payload) return { success: false, error: "Unauthorized" };

    const role = payload.role;
    const userId = payload.id || payload._id || payload.userId;
    const tokenSchoolId = payload.schoolId;

    const filters = {
      months: Math.min(24, Math.max(3, Number(req.query.months || 12))),
      schoolId: safeStr(req.query.schoolId),
      schoolCode: safeStr(req.query.schoolCode),
      q: safeStr(req.query.q),
      courseId: safeStr(req.query.courseId),
      acYear: safeStr(req.query.acYear),
      status: safeStr(req.query.status),
      feesStatus: safeStr(req.query.feesStatus),
      hostel: safeStr(req.query.hostel),
    };

    const allowedSchoolIds = await getAccessibleSchoolIds({ role, schoolId: tokenSchoolId, userId });
    const resolvedSchoolIds = await resolveSchoolScope({
      allowedSchoolIds,
      schoolIdFilter: filters.schoolId,
      schoolCode: filters.schoolCode,
      q: filters.q,
    });

    const studentIdsByAcademic = await getStudentIdsByAcademicFilter({
      acYear: filters.acYear,
      courseId: filters.courseId,
    });

    const studentMatch = buildStudentMatch({
      resolvedSchoolIds,
      status: filters.status,
      feesStatus: filters.feesStatus,
      hostel: filters.hostel,
      studentIdsByAcademic,
    });

    const cacheKey = buildCacheKey("rep:home", [
      role,
      userId,
      filters.months,
      filters.schoolId,
      filters.schoolCode,
      filters.q,
      filters.courseId,
      filters.acYear,
      filters.status,
      filters.feesStatus,
      filters.hostel,
    ]);

    const redis = useCache ? await getRedis().catch(() => null) : null;
    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    }

    const { keys: monthKeys, startDate, monthStart } = buildMonthKeys(filters.months);

    const [
      totalStudents,
      feesPaidCount,
      activeCount,
      graduatedCount,
      inactiveCount,
      transferredCount,
      discontinuedCount,
      hostelYesCount,
      hostelNoCount,
      thisMonthAdmissions,
      coveredSchoolIds,
      admissionsRaw,
      feeSeriesData,
      latestUnpaidRaw,
      latestAdmissionsRaw,
    ] = await Promise.all([
      Student.countDocuments(studentMatch),
      Student.countDocuments({ ...studentMatch, feesPaid: 1 }),
      Student.countDocuments({ ...studentMatch, active: "Active" }),
      Student.countDocuments({ ...studentMatch, active: "Graduated" }),
      Student.countDocuments({ ...studentMatch, active: "In-Active" }),
      Student.countDocuments({ ...studentMatch, active: "Transferred" }),
      Student.countDocuments({ ...studentMatch, active: "Discontinued" }),
      Student.countDocuments({ ...studentMatch, hostel: "Yes" }),
      Student.countDocuments({ ...studentMatch, hostel: "No" }),
      Student.countDocuments({ ...studentMatch, doa: { $gte: monthStart } }),
      Student.distinct("schoolId", studentMatch),
      Student.aggregate([
        { $match: { ...studentMatch, doa: { $gte: startDate } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m", date: "$doa" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, month: "$_id", count: 1 } },
      ]),
      buildFeesCollectionSeries({
        startDate,
        monthStart,
        acYear: filters.acYear,
        resolvedSchoolIds,
        status: filters.status,
        hostel: filters.hostel,
        feesStatus: filters.feesStatus,
        studentIdsByAcademic,
      }),
      Student.find({ ...studentMatch, feesPaid: 0 })
        .select("_id userId schoolId rollNumber feesPaid doa active hostel courses")
        .populate({ path: "userId", select: "name" })
        .populate({ path: "schoolId", select: "code nameEnglish" })
        .populate({ path: "courses", select: "name type" })
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean(),
      Student.find(studentMatch)
        .select("_id userId schoolId rollNumber feesPaid doa active hostel courses")
        .populate({ path: "userId", select: "name" })
        .populate({ path: "schoolId", select: "code nameEnglish" })
        .populate({ path: "courses", select: "name type" })
        .sort({ doa: -1 })
        .limit(10)
        .lean(),
    ]);

    const admissionsTrend = buildFilledMonthlySeries(monthKeys, admissionsRaw, "count", "admissions");
    const feesTrend = buildFilledMonthlySeries(
      monthKeys,
      feeSeriesData.monthlyRows,
      "amount",
      "collected"
    );

    const previewLatestUnpaid = latestUnpaidRaw.map((student) => makePreviewRow(student, { hideRoll: true }));
    const previewLatestAdmissions = latestAdmissionsRaw.map((student) => makePreviewRow(student));

    const result = {
      success: true,
      filters: {
        ...filters,
        schoolId: filters.schoolId || null,
        schoolCode: filters.schoolCode || null,
        q: filters.q || null,
        courseId: filters.courseId || null,
        acYear: filters.acYear || null,
        status: filters.status || null,
        feesStatus: filters.feesStatus || null,
        hostel: filters.hostel || null,
      },
      kpis: {
        totalStudents,
        feesPaid: feesPaidCount,
        feesUnpaid: Math.max(0, totalStudents - feesPaidCount),
        active: activeCount,
        graduated: graduatedCount,
        inactive: inactiveCount,
        transferred: transferredCount,
        discontinued: discontinuedCount,
        hostelYes: hostelYesCount,
        hostelNo: hostelNoCount,
        niswansCovered: Array.isArray(coveredSchoolIds) ? coveredSchoolIds.length : 0,
        thisMonthAdmissions,
        thisMonthFeesCollection: Number(feeSeriesData.thisMonthAmount || 0),
      },
      trends: {
        admissions: admissionsTrend,
        feesCollection: feesTrend,
      },
      admissionsTrend,
      feesTrend,
      previews: {
        latestUnpaid: previewLatestUnpaid,
        latestAdmissions: previewLatestAdmissions,
      },
      latestUnpaid: previewLatestUnpaid,
      latestAdmissions: previewLatestAdmissions,
    };

    if (redis) {
      await redis.set(cacheKey, JSON.stringify(result), { EX: 60 });
    }

    return result;
  } catch (e) {
    console.log(e);
    return { success: false, error: "Failed to build report" };
  }
}

export const getReportMeta = async (req, res) => {
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ success: false, error: "Unauthorized" });

    const role = payload.role;
    const userId = payload.id || payload._id || payload.userId;
    const tokenSchoolId = payload.schoolId;

    const allowedSchoolIds = await getAccessibleSchoolIds({ role, schoolId: tokenSchoolId, userId });
    const resolvedSchoolIds = await resolveSchoolScope({
      allowedSchoolIds,
      schoolIdFilter: safeStr(req.query.schoolId),
      schoolCode: safeStr(req.query.schoolCode),
      q: safeStr(req.query.q),
    });

    const schoolQuery =
      resolvedSchoolIds === null
        ? {}
        : { _id: { $in: resolvedSchoolIds.map(oid) } };

    const [schools, courses, academicYears] = await Promise.all([
      School.find(schoolQuery).select("_id code nameEnglish").sort({ code: 1 }).lean(),
      Course.find().select("_id name type code").sort({ type: 1, name: 1 }).lean(),
      AcademicYear.find().select("_id acYear").sort({ acYear: 1 }).lean(),
    ]);

    const courseTypes = [...new Set(courses.map((item) => safeStr(item.type)).filter(Boolean))];
    const statuses = ["Active", "In-Active", "Transferred", "Graduated", "Discontinued"];
    const feeStatuses = ["Paid", "Unpaid"];
    const hostels = ["Yes", "No"];

    return res.status(200).json({
      success: true,
      schools,
      courses,
      academicYears,
      years: academicYears,
      courseTypes,
      statuses,
      feeStatuses,
      hostels,
    });
  } catch (e) {
    console.log(e);
    return res.status(500).json({ success: false, error: "report meta error" });
  }
};

export const getReportsHome = async (req, res) => {
  const data = await getReportsHomeLogic(req, { useCache: true });
  if (!data?.success) {
    const status = data?.error === "Unauthorized" ? 401 : 500;
    return res.status(status).json({ success: false, error: data?.error || "reports home server error" });
  }
  return res.status(200).json(data);
};

export const exportReportsHome = async (req, res) => {
  try {
    const format = String(req.query.format || "xlsx").toLowerCase();
    const data = await getReportsHomeLogic(req, { useCache: false });

    if (!data?.success) {
      return res.status(400).json({ success: false, error: data?.error || "Failed to export" });
    }

    const filenameBase = `Reports_Home_${Date.now()}`;

    if (format === "csv") {
      const row = {
        totalStudents: data.kpis.totalStudents,
        feesPaid: data.kpis.feesPaid,
        feesUnpaid: data.kpis.feesUnpaid,
        active: data.kpis.active,
        graduated: data.kpis.graduated,
        inactive: data.kpis.inactive,
        transferred: data.kpis.transferred,
        discontinued: data.kpis.discontinued,
        hostelYes: data.kpis.hostelYes,
        hostelNo: data.kpis.hostelNo,
        niswansCovered: data.kpis.niswansCovered,
        thisMonthAdmissions: data.kpis.thisMonthAdmissions,
        thisMonthFeesCollection: data.kpis.thisMonthFeesCollection,
      };
      return sendCSV(res, filenameBase, [row], Object.keys(row));
    }

    const sheets = [
      { name: "KPIs", rows: [data.kpis] },
      { name: "AdmissionsTrend", rows: data.trends.admissions || [] },
      { name: "FeesTrend", rows: data.trends.feesCollection || [] },
      { name: "LatestUnpaid", rows: data.previews.latestUnpaid || [] },
      { name: "LatestAdmissions", rows: data.previews.latestAdmissions || [] },
    ];

    return sendXLSXMulti(res, filenameBase, sheets);
  } catch (e) {
    console.log(e);
    return res.status(500).json({ success: false, error: "Export server error" });
  }
};

async function getNiswanReportLogic(req, { useCache = false } = {}) {
  try {
    const payload = getAuthPayload(req);
    if (!payload) return { success: false, error: "Unauthorized" };

    const role = payload.role;
    const userId = payload.id || payload._id || payload.userId;
    const tokenSchoolId = payload.schoolId;

    const filters = {
      schoolId: safeStr(req.query.schoolId),
      schoolCode: safeStr(req.query.schoolCode),
      q: safeStr(req.query.q),
      courseId: safeStr(req.query.courseId),
      acYear: safeStr(req.query.acYear),
      status: safeStr(req.query.status),
      feesStatus: safeStr(req.query.feesStatus),
      hostel: safeStr(req.query.hostel),
    };

    const allowedSchoolIds = await getAccessibleSchoolIds({ role, schoolId: tokenSchoolId, userId });
    const resolvedSchoolIds = await resolveSchoolScope({
      allowedSchoolIds,
      schoolIdFilter: filters.schoolId,
      schoolCode: filters.schoolCode,
      q: filters.q,
    });

    const cacheKey = buildCacheKey("rep:niswan", [
      role,
      userId,
      filters.schoolId,
      filters.schoolCode,
      filters.q,
      filters.courseId,
      filters.acYear,
      filters.status,
      filters.feesStatus,
      filters.hostel,
    ]);

    const redis = useCache ? await getRedis().catch(() => null) : null;
    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    }

    const schoolQuery =
      resolvedSchoolIds === null
        ? {}
        : { _id: { $in: resolvedSchoolIds.map(oid) } };

    const schools = await School.find(schoolQuery)
      .select("_id code nameEnglish")
      .sort({ code: 1 })
      .lean();

    if (!schools || schools.length === 0) {
      const empty = {
        success: true,
        rows: [],
        summary: {
          totalNiswans: 0,
          totalStudents: 0,
          totalFeesPaid: 0,
          totalUnpaid: 0,
          totalActive: 0,
          totalGraduated: 0,
        },
      };
      if (redis) await redis.set(cacheKey, JSON.stringify(empty), { EX: 60 });
      return empty;
    }

    const schoolIds = schools.map((s) => s._id);
    const studentIdsByAcademic = await getStudentIdsByAcademicFilter({
      acYear: filters.acYear,
      courseId: filters.courseId,
    });

    const studentMatch = buildStudentMatch({
      resolvedSchoolIds: schoolIds.map((id) => String(id)),
      status: filters.status,
      feesStatus: filters.feesStatus,
      hostel: filters.hostel,
      studentIdsByAcademic,
    });

    const stats = await Student.aggregate([
      { $match: studentMatch },
      {
        $group: {
          _id: "$schoolId",
          totalStudents: { $sum: 1 },
          activeStudents: { $sum: { $cond: [{ $eq: ["$active", "Active"] }, 1, 0] } },
          graduatedStudents: { $sum: { $cond: [{ $eq: ["$active", "Graduated"] }, 1, 0] } },
          inactiveStudents: { $sum: { $cond: [{ $eq: ["$active", "In-Active"] }, 1, 0] } },
          transferredStudents: { $sum: { $cond: [{ $eq: ["$active", "Transferred"] }, 1, 0] } },
          discontinuedStudents: { $sum: { $cond: [{ $eq: ["$active", "Discontinued"] }, 1, 0] } },
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
          hostelYes: { $sum: { $cond: [{ $eq: ["$hostel", "Yes"] }, 1, 0] } },
          lastAdmissionDate: { $max: "$doa" },
        },
      },
    ]);

    const statsMap = new Map(stats.map((item) => [String(item._id), item]));

    const rows = schools.map((school) => {
      const st = statsMap.get(String(school._id)) || {};
      const totalStudents = Number(st.totalStudents || 0);
      const feesPaid = Number(st.feesPaid || 0);
      const unpaid = Number(st.unpaid || 0);
      const activeStudents = Number(st.activeStudents || 0);
      const graduatedStudents = Number(st.graduatedStudents || 0);

      return {
        _id: school._id,
        code: school.code || "",
        nameEnglish: school.nameEnglish || "",
        totalStudents,
        feesPaid,
        unpaid,
        activeStudents,
        graduatedStudents,
        inactiveStudents: Number(st.inactiveStudents || 0),
        transferredStudents: Number(st.transferredStudents || 0),
        discontinuedStudents: Number(st.discontinuedStudents || 0),
        hostelYes: Number(st.hostelYes || 0),
        paidPercent: totalStudents > 0 ? Number(((feesPaid / totalStudents) * 100).toFixed(1)) : 0,
        activePercent: totalStudents > 0 ? Number(((activeStudents / totalStudents) * 100).toFixed(1)) : 0,
        lastAdmissionDate: st.lastAdmissionDate || null,
      };
    });

    const summary = rows.reduce(
      (acc, row) => {
        acc.totalNiswans += 1;
        acc.totalStudents += Number(row.totalStudents || 0);
        acc.totalFeesPaid += Number(row.feesPaid || 0);
        acc.totalUnpaid += Number(row.unpaid || 0);
        acc.totalActive += Number(row.activeStudents || 0);
        acc.totalGraduated += Number(row.graduatedStudents || 0);
        return acc;
      },
      {
        totalNiswans: 0,
        totalStudents: 0,
        totalFeesPaid: 0,
        totalUnpaid: 0,
        totalActive: 0,
        totalGraduated: 0,
      }
    );

    const result = { success: true, rows, summary };

    if (redis) {
      await redis.set(cacheKey, JSON.stringify(result), { EX: 60 });
    }

    return result;
  } catch (e) {
    console.log(e);
    return { success: false, error: "Niswan report server error" };
  }
}

export const getNiswanReport = async (req, res) => {
  const data = await getNiswanReportLogic(req, { useCache: true });
  if (!data?.success) {
    const status = data?.error === "Unauthorized" ? 401 : 500;
    return res.status(status).json({ success: false, error: data?.error || "Niswan report server error" });
  }
  return res.status(200).json(data);
};

export const exportNiswanReport = async (req, res) => {
  try {
    const format = String(req.query.format || "csv").toLowerCase();
    const data = await getNiswanReportLogic(req, { useCache: false });

    if (!data?.success) {
      return res.status(400).json({ success: false, error: data?.error || "Failed" });
    }

    const rows = data.rows || [];
    const filenameBase = `Niswan_Report_${Date.now()}`;
    return exportByFormat(res, format, filenameBase, rows, Object.keys(rows[0] || {}), "Niswan");
  } catch (e) {
    console.log(e);
    return res.status(500).json({ success: false, error: "Export server error" });
  }
};

function exportByFormat(res, format, filenameBase, rows, columns, sheetName) {
  const f = String(format || "csv").toLowerCase();
  if (f === "xlsx") return sendXLSX(res, filenameBase, rows, sheetName || "Report");
  return sendCSV(res, filenameBase, rows, columns);
}