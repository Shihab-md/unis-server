import redisClient from "../db/redis.js"

const getSummary = async (req, res) => {
    try {
        const totalEmployees = await redisClient.get('totalEmployees');
        const totalSupervisors = await redisClient.get('totalSupervisors');
        const totalSchools = await redisClient.get('totalSchools');
        const totalStudents = await redisClient.get('totalStudents');
        const totalCertificates = await redisClient.get('totalCertificates');

        {/*   
            
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
*/}
        return res.status(200).json({
            success: true,
            totalSupervisors,
            totalSchools,
            totalEmployees,
            totalStudents,
            totalCertificates,
        })
    } catch (error) {
        console.log(error.message)
        return res.status(500).json({ success: false, error: "Dashboard summary error" })
    }
}

const getMasterSummary = async (req, res) => {
    try {
        const totalInstitutes = await redisClient.get('totalInstitutes');
        const totalCourses = await redisClient.get('totalCourses');
        const totalAcademicYears = await redisClient.get('totalAcademicYears');
        const totalTemplates = await redisClient.get('totalTemplates');
        const totalDistrictStates = await redisClient.get('totalDistrictStates');

        return res.status(200).json({
            success: true,
            totalInstitutes,
            totalCourses,
            totalAcademicYears,
            totalTemplates,
            totalDistrictStates,
        })
    } catch (error) {
        console.log(error.message)
        return res.status(500).json({ success: false, error: "MASTER summary error" })
    }
}

export { getSummary, getMasterSummary }