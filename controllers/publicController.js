import Supervisor from "../models/Supervisor.js";
import School from "../models/School.js";
import Student from "../models/Student.js";

export const getPublicStats = async (req, res) => {
  try {
    const [supervisorsCount, schoolsCount, studentsCount] = await Promise.all([
      Supervisor.countDocuments({ active: "Active" }),
      School.countDocuments({ active: "Active" }),
      Student.countDocuments({ active: "Active" }),
    ]);

    const courseWiseByType = await Student.aggregate([
      { $match: { active: "Active", courses: { $exists: true, $ne: [] } } },
      { $unwind: "$courses" },
      { $group: { _id: "$courses", count: { $sum: 1 } } },
      {
        $lookup: {
          from: "courses",
          localField: "_id",
          foreignField: "_id",
          as: "course",
        },
      },
      { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { type: "$course.type" },
          total: { $sum: "$count" },
          courses: {
            $push: {
              courseId: "$course._id",
              courseName: "$course.name",
              count: "$count",
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          type: { $ifNull: ["$_id.type", "Others"] },
          total: 1,
          courses: 1,
        },
      },
      { $sort: { type: 1 } },
    ]);

    return res.status(200).json({
      success: true,
      stats: {
        supervisorsCount,
        schoolsCount,
        studentsCount,
        courseWiseByType,
      },
    });
  } catch (e) {
    console.log(e);
    return res.status(500).json({ success: false, error: "public stats server error" });
  }
};
