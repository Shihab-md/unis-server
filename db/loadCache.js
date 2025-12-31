import getRedis from "../db/redis.js"

import Employee from "../models/Employee.js"
import Supervisor from "../models/Supervisor.js"
import School from "../models/School.js"
import Institute from "../models/Institute.js"
import Course from "../models/Course.js"
import Student from "../models/Student.js"
import AcademicYear from "../models/AcademicYear.js"
import Template from "../models/Template.js"
import DistrictState from "../models/DistrictState.js"
import Certificate from "../models/Certificate.js"

const loadCache = async () => {
    try {
        const redisClient = await getRedis();

        // TTLs (seconds) - tune as you like
        const DASHBOARD_TTL = 60;         // 1 minute
        const LIST_TTL = 60 * 30;         // 30 minutes (combo lists change rarely)

        // ----------------------------
        // 1) Dashboard counts in parallel
        // ----------------------------
        const [
            totalSupervisors,
            totalSchoolsRaw,
            totalStudents,
            totalEmployees,
            totalCertificates,
            totalInstitutes,
            totalCourses,
            totalAcademicYears,
            totalTemplates,
            totalDistrictStates,
        ] = await Promise.all([
            Supervisor.countDocuments({ active: "Active" }),
            School.countDocuments(),
            Student.countDocuments(),
            Employee.countDocuments({ active: "Active" }),
            Certificate.countDocuments(),
            Institute.countDocuments(),
            Course.countDocuments(),
            AcademicYear.countDocuments(),
            Template.countDocuments(),
            DistrictState.countDocuments(),
        ]);

        const totalSchools = Math.max(Number(totalSchoolsRaw) - 1, 0); // minus HQ

        // Use multi-set + TTLs
        await Promise.all([
            redisClient.set("totalSupervisors", String(totalSupervisors), { EX: DASHBOARD_TTL }),
            redisClient.set("totalSchools", String(totalSchools), { EX: DASHBOARD_TTL }),
            redisClient.set("totalStudents", String(totalStudents), { EX: DASHBOARD_TTL }),
            redisClient.set("totalEmployees", String(totalEmployees), { EX: DASHBOARD_TTL }),
            redisClient.set("totalCertificates", String(totalCertificates), { EX: DASHBOARD_TTL }),

            redisClient.set("totalInstitutes", String(totalInstitutes), { EX: DASHBOARD_TTL }),
            redisClient.set("totalCourses", String(totalCourses), { EX: DASHBOARD_TTL }),
            redisClient.set("totalAcademicYears", String(totalAcademicYears), { EX: DASHBOARD_TTL }),
            redisClient.set("totalTemplates", String(totalTemplates), { EX: DASHBOARD_TTL }),
            redisClient.set("totalDistrictStates", String(totalDistrictStates), { EX: DASHBOARD_TTL }),
        ]);

        // ----------------------------
        // 2) Combo lists in parallel (lean + select minimal)
        // ----------------------------
        const [
            supervisorsList,
            schoolsList,
            academicYearsList,
            institutesList,
            coursesList,
            templatesList,
            districtStatesList,
        ] = await Promise.all([
            Supervisor.find()
                .sort({ supervisorId: 1 })
                .select("_id supervisorId userId")
                .populate({ path: "userId", select: "name" })
                .lean(),

            School.find()
                .sort({ code: 1 })
                .select("_id code nameEnglish districtStateId")
                .populate({ path: "districtStateId", select: "district state" })
                .lean(),

            AcademicYear.find()
                .sort({ acYear: 1 })
                .select("_id acYear")
                .lean(),

            Institute.find()
                .sort({ iCode: 1 })
                .select("_id name type iCode")
                .lean(),

            Course.find()
                .sort({ code: 1 })
                .select("_id name type fees years code")
                .lean(),

            Template.find()
                .select("_id courseId")
                .populate({ path: "courseId", select: "name" })
                .lean(),

            DistrictState.find()
                .sort({ state: 1, district: 1 })
                .select("_id district state")
                .lean(),
        ]);

        // Store lists (JSON) with longer TTL
        await Promise.all([
            redisClient.set("supervisors", JSON.stringify(supervisorsList), { EX: LIST_TTL }),
            redisClient.set("schools", JSON.stringify(schoolsList), { EX: LIST_TTL }),
            redisClient.set("academicYears", JSON.stringify(academicYearsList), { EX: LIST_TTL }),
            redisClient.set("institutes", JSON.stringify(institutesList), { EX: LIST_TTL }),
            redisClient.set("courses", JSON.stringify(coursesList), { EX: LIST_TTL }),
            redisClient.set("templates", JSON.stringify(templatesList), { EX: LIST_TTL }),
            redisClient.set("districtStates", JSON.stringify(districtStatesList), { EX: LIST_TTL }),
        ]);
 
        console.log("Cache loaded into Redis!");
    } catch (error) {
        console.log("[loadCache] error:", error);
    }
};

{/*
const loadCache = async () => {
    try {

        const redisClient = await getRedis();
        // Get record count for dashboard.
        await redisClient.set('totalSupervisors', await Supervisor.countDocuments({ active: 'Active' }));
        await redisClient.set('totalSchools', await School.countDocuments() - 1); // Minus HQ
        await redisClient.set('totalStudents', await Student.countDocuments());
        await redisClient.set('totalEmployees', await Employee.countDocuments({ active: 'Active' }));
        await redisClient.set('totalCertificates', await Certificate.countDocuments());

        await redisClient.set('totalInstitutes', await Institute.countDocuments());
        await redisClient.set('totalCourses', await Course.countDocuments());
        await redisClient.set('totalAcademicYears', await AcademicYear.countDocuments());
        await redisClient.set('totalTemplates', await Template.countDocuments());
        await redisClient.set('totalDistrictStates', await DistrictState.countDocuments());

        // Select records for combo list box.
        await redisClient.set('supervisors', JSON.stringify(await Supervisor.find().sort({ supervisorId: 1 })
            .select('_id supervisorId')
            .populate({ path: 'userId', select: 'name' })));

        await redisClient.set('schools', JSON.stringify(await School.find().sort({ code: 1 })
            .select('_id code nameEnglish')
            .populate({ path: 'districtStateId', select: 'district state' })));

        await redisClient.set('academicYears', JSON.stringify(await AcademicYear.find().sort({ acYear: 1 })
            .select('_id acYear')));

        await redisClient.set('institutes', JSON.stringify(await Institute.find().sort({ iCode: 1 })
            .select('_id name type')));

        await redisClient.set('courses', JSON.stringify(await Course.find().sort({ code: 1 })
            .select('_id name type fees years')));

        await redisClient.set('templates', JSON.stringify(await Template.find().select('_id')
            .populate({ path: 'courseId', select: 'name' })));

        await redisClient.set('districtStates', JSON.stringify(await DistrictState.find().sort({ state: 1, district: 1 })
            .select('_id district state')));

        console.log('Cache loaded into Redis!');
    } catch (error) {
        console.log(error)
    }
}
*/}

export default loadCache;