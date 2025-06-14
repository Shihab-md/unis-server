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

        await redisClient.set('supervisors', JSON.stringify(await Supervisor.find().select('_id supervisorId')
            .populate({ path: 'userId', select: 'name' })));
        await redisClient.set('schools', JSON.stringify(await School.find().sort({ code: 1 }).select('_id code nameEnglish')));
        await redisClient.set('academicYears', JSON.stringify(await AcademicYear.find().select('_id acYear')));
        await redisClient.set('institutes', JSON.stringify(await Institute.find().select('_id name type')));
        await redisClient.set('courses', JSON.stringify(await Course.find().select('_id name type fees')));
        await redisClient.set('templates', JSON.stringify(await Template.find().select('_id')
            .populate({ path: 'courseId', select: 'name' })));

        console.log('Cache loaded into Redis!');
    } catch (error) {
        console.log(error)
    }
}

export default loadCache;