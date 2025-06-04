import Department from "../models/Department.js";
import Employee from "../models/Employee.js"
import Supervisor from "../models/Supervisor.js"
import School from "../models/School.js"
import Institute from "../models/Institute.js"
import Course from "../models/Course.js"
import Student from "../models/Student.js"
import AcademicYear from "../models/AcademicYear.js"
import Template from "../models/Template.js"
import Leave from "../models/Leave.js";

const getSummary = async (req, res) => {
    try {
        const totalEmployees = await Employee.countDocuments();
        const totalSupervisors = await Supervisor.countDocuments();
        const totalSchools = await School.countDocuments();
        const totalStudents = await Student.countDocuments();

        const totalSalaries = await Employee.aggregate([
            { $group: { _id: null, totalSalary: { $sum: "$salary" } } }
        ])

        const employeeAppliedForLeave = await Leave.distinct('employeeId')

        const leaveStatus = await Leave.aggregate([
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 }
                }
            }
        ])

        const leaveSummary = {
            appliedFor: employeeAppliedForLeave.length,
            approved: leaveStatus.find(item => item._id === "Approved")?.count || 0,
            rejected: leaveStatus.find(item => item._id === "Rejected")?.count || 0,
            pending: leaveStatus.find(item => item._id === "Pending")?.count || 0,
        }

        return res.status(200).json({
            success: true,
            totalSupervisors,
            totalSchools,
            totalEmployees,
            totalStudents,
        })
    } catch (error) {
        console.log(error.message)
        return res.status(500).json({ success: false, error: "Dashboard summary error" })
    }
}

const getMasterSummary = async (req, res) => {
    try {
        const totalInstitutes = await Institute.countDocuments();
        const totalCourses = await Course.countDocuments();
        const totalAcademicYears = await AcademicYear.countDocuments();
        const totalTemplates = await Template.countDocuments();

        return res.status(200).json({
            success: true,
            totalInstitutes,
            totalCourses,
            totalAcademicYears,
            totalTemplates,
        })
    } catch (error) {
        console.log(error.message)
        return res.status(500).json({ success: false, error: "MASTER summary error" })
    }
}

export { getSummary, getMasterSummary }