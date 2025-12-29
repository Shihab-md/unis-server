import getRedis from "../db/redis.js";
import Student from "../models/Student.js";
import Employee from "../models/Employee.js";
import School from "../models/School.js";
import Supervisor from "../models/Supervisor.js";
import Certificate from "../models/Certificate.js";

const getSummary = async (req, res) => {
  try {
    const redis = await getRedis();

    // cache-aside + fallback (prevents blank counts if cache not loaded)
    const keys = [
      "totalEmployees",
      "totalSupervisors",
      "totalSchools",
      "totalStudents",
      "totalCertificates",
    ];

    const vals = await redis.mGet(keys);
    let [totalEmployees, totalSupervisors, totalSchools, totalStudents, totalCertificates] = vals;

    // If any missing, compute from DB and refresh cache
    if ([totalEmployees, totalSupervisors, totalSchools, totalStudents, totalCertificates].some(v => v === null)) {
      totalEmployees = String(await Employee.countDocuments({ active: "Active" }));
      totalSupervisors = String(await Supervisor.countDocuments({ active: "Active" }));
      totalSchools = String((await School.countDocuments()) - 1);
      totalStudents = String(await Student.countDocuments());
      totalCertificates = String(await Certificate.countDocuments());

      // set with TTL so cache self-heals
      await redis.set("totalEmployees", totalEmployees, { EX: 60 });
      await redis.set("totalSupervisors", totalSupervisors, { EX: 60 });
      await redis.set("totalSchools", totalSchools, { EX: 60 });
      await redis.set("totalStudents", totalStudents, { EX: 60 });
      await redis.set("totalCertificates", totalCertificates, { EX: 60 });
    }

    return res.status(200).json({
      success: true,
      totalEmployees,
      totalSupervisors,
      totalSchools,
      totalStudents,
      totalCertificates,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Dashboard summary error" });
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

    // If any missing, compute from DB and refresh cache (self-healing)
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

      // Cache for 60 seconds (adjust as you like)
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
    return res.status(500).json({ success: false, error: "MASTER summary error" });
  }
};

export { getSummary, getMasterSummary }