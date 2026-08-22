import getRedis from "../db/redis.js";
import Student from "../models/Student.js";
import Employee from "../models/Employee.js";
import School from "../models/School.js";
import Supervisor from "../models/Supervisor.js";
import Certificate from "../models/Certificate.js";
import Institute from "../models/Institute.js";
import Course from "../models/Course.js";
import AcademicYear from "../models/AcademicYear.js";
import Template from "../models/Template.js";
import DistrictState from "../models/DistrictState.js";

const SCHOOL_LINKED_ROLES = new Set([
  "admin",
  "employee",
  "teacher",
  "usthadh",
  "warden",
  "staff",
]);

const toCountString = (value) => String(Number(value || 0));

const buildEmptySummary = () => ({
  totalEmployees: "0",
  totalSupervisors: "0",
  totalSchools: "0",
  totalStudents: "0",
  totalCertificates: "0",
});

const getGlobalSummary = async () => {
  const redis = await getRedis();

  const keys = [
    "totalEmployees",
    "totalSupervisors",
    "totalSchools",
    "totalStudents",
    "totalCertificates",
  ];

  const vals = await redis.mGet(keys);

  let [
    totalEmployees,
    totalSupervisors,
    totalSchools,
    totalStudents,
    totalCertificates,
  ] = vals;

  if (
    [
      totalEmployees,
      totalSupervisors,
      totalSchools,
      totalStudents,
      totalCertificates,
    ].some((v) => v === null)
  ) {
    totalEmployees = String(await Employee.countDocuments({ active: "Active" }));
    totalSupervisors = String(
      await Supervisor.countDocuments({ active: "Active" })
    );

    totalSchools = String(
      await School.countDocuments({
        code: { $ne: "UN-00-00001" },
      })
    );

    totalStudents = String(await Student.countDocuments());
    totalCertificates = String(await Certificate.countDocuments());

    await redis.set("totalEmployees", totalEmployees, { EX: 60 });
    await redis.set("totalSupervisors", totalSupervisors, { EX: 60 });
    await redis.set("totalSchools", totalSchools, { EX: 60 });
    await redis.set("totalStudents", totalStudents, { EX: 60 });
    await redis.set("totalCertificates", totalCertificates, { EX: 60 });
  }

  return {
    totalEmployees,
    totalSupervisors,
    totalSchools,
    totalStudents,
    totalCertificates,
  };
};

const getSupervisorSummary = async (userId) => {
  const supervisor = await Supervisor.findOne({
    userId,
    active: "Active",
  })
    .select("_id")
    .lean();

  if (!supervisor?._id) {
    return buildEmptySummary();
  }

  const schools = await School.find({
    supervisorId: supervisor._id,
    code: { $ne: "UN-00-00001" },
  })
    .select("_id")
    .lean();

  const schoolIds = schools.map((school) => school._id);

  if (schoolIds.length === 0) {
    return {
      ...buildEmptySummary(),
      totalSupervisors: "1",
    };
  }

  const [totalEmployees, totalStudents] = await Promise.all([
    Employee.countDocuments({
      schoolId: { $in: schoolIds },
      active: "Active",
    }),

    Student.countDocuments({
      schoolId: { $in: schoolIds },
    }),
  ]);

  return {
    totalEmployees: toCountString(totalEmployees),
    totalSupervisors: "1",
    totalSchools: toCountString(schoolIds.length),
    totalStudents: toCountString(totalStudents),
    totalCertificates: "0",
  };
};

const getSchoolLinkedRoleSummary = async (userId) => {
  const employee = await Employee.findOne({
    userId,
    active: "Active",
  })
    .select("schoolId")
    .lean();

  if (!employee?.schoolId) {
    return buildEmptySummary();
  }

  const [totalEmployees, totalStudents] = await Promise.all([
    Employee.countDocuments({
      schoolId: employee.schoolId,
      active: "Active",
    }),

    Student.countDocuments({
      schoolId: employee.schoolId,
      active: "Active",
    }),
  ]);

  return {
    totalEmployees: toCountString(totalEmployees),
    totalSupervisors: "0",
    totalSchools: "1",
    totalStudents: toCountString(totalStudents),
    totalCertificates: "0",
  };
};

const getSummary = async (req, res) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    const userId = req.user?._id;

    let summary;

    if (role === "superadmin" || role === "hquser") {
      summary = await getGlobalSummary();
    } else if (role === "supervisor") {
      summary = await getSupervisorSummary(userId);
    } else if (SCHOOL_LINKED_ROLES.has(role)) {
      summary = await getSchoolLinkedRoleSummary(userId);
    } else {
      summary = buildEmptySummary();
    }

    return res.status(200).json({
      success: true,
      ...summary,
    });
  } catch (e) {
    console.log("[getSummary] error:", e?.message || e);
    return res.status(500).json({
      success: false,
      error: "Dashboard summary error",
    });
  }
};

const getMasterSummary = async (req, res) => {
  try {
    const redis = await getRedis();

    let totalInstitutes = await redis.get("totalInstitutes");
    let totalCourses = await redis.get("totalCourses");
    let totalAcademicYears = await redis.get("totalAcademicYears");
    let totalTemplates = await redis.get("totalTemplates");
    let totalDistrictStates = await redis.get("totalDistrictStates");

    if (
      totalInstitutes === null ||
      totalCourses === null ||
      totalAcademicYears === null ||
      totalTemplates === null ||
      totalDistrictStates === null
    ) {
      totalInstitutes = String(await Institute.countDocuments());
      totalCourses = String(await Course.countDocuments());
      totalAcademicYears = String(await AcademicYear.countDocuments());
      totalTemplates = String(await Template.countDocuments());
      totalDistrictStates = String(await DistrictState.countDocuments());

      await redis.set("totalInstitutes", totalInstitutes, { EX: 60 });
      await redis.set("totalCourses", totalCourses, { EX: 60 });
      await redis.set("totalAcademicYears", totalAcademicYears, { EX: 60 });
      await redis.set("totalTemplates", totalTemplates, { EX: 60 });
      await redis.set("totalDistrictStates", totalDistrictStates, { EX: 60 });
    }

    return res.status(200).json({
      success: true,
      totalInstitutes,
      totalCourses,
      totalAcademicYears,
      totalTemplates,
      totalDistrictStates,
    });
  } catch (error) {
    console.log(error.message);
    return res.status(500).json({
      success: false,
      error: "MASTER summary error",
    });
  }
};

export { getSummary, getMasterSummary };