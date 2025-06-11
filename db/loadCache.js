import redisClient from "../db/redis.js"

import Employee from "../models/Employee.js"
import Supervisor from "../models/Supervisor.js"
import School from "../models/School.js"
import Institute from "../models/Institute.js"
import Course from "../models/Course.js"
import Student from "../models/Student.js"
import AcademicYear from "../models/AcademicYear.js"
import Template from "../models/Template.js"

const loadCache = async () => {
    try {

        await redisClient.set('totalEmployees', await Employee.countDocuments());
        await redisClient.set('totalSupervisors', await Supervisor.countDocuments());
        await redisClient.set('totalSchools', await School.countDocuments());
        await redisClient.set('totalStudents', await Student.countDocuments());

        await redisClient.set('totalInstitutes', await Institute.countDocuments());
        await redisClient.set('totalCourses', await Course.countDocuments());
        await redisClient.set('totalAcademicYears', await AcademicYear.countDocuments());
        await redisClient.set('totalTemplates', await Template.countDocuments());

        console.log('Cache loaded into Redis!');
    } catch (error) {
        console.log(error)
    }
}

export default loadCache;