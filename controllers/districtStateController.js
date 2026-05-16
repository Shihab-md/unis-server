import DistrictState from "../models/DistrictState.js";
import Student from "../models/Student.js";
import School from "../models/School.js";
import Employee from "../models/Employee.js";
import getRedis from "../db/redis.js"
import { toCamelCase } from "./commonController.js";
import mongoose from "mongoose";
import { getActiveAcademicYearIdFromCache } from "./academicYearController.js";

const addDistrictState = async (req, res) => {
  try {
    const {
      district,
      state,
    } = req.body;

    const districtStateByCode = await DistrictState.findOne({ district: district, state: state });
    if (districtStateByCode != null) {
      return res
        .status(400)
        .json({ success: false, error: "District and State already exists" });
    }

    const newDistrictState = new DistrictState({
      district: toCamelCase(district),
      state: toCamelCase(state),
    });

    await newDistrictState.save();

    const redis = await getRedis();
    await redis.set('totalDistrictStates', await DistrictState.countDocuments());

    const districtStatesList = await DistrictState.find()
      .sort({ state: 1, district: 1 })
      .select("_id district state")
      .lean();
    redis.set("districtStates", JSON.stringify(districtStatesList), { EX: 60 * 30 });

    return res.status(200).json({ success: true, message: "District and State Created Successfully." });

  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "server error in adding district and State" });
  }
};

const getDistrictNiswanCountMap = async (districtStateIds = []) => {
  if (!Array.isArray(districtStateIds) || districtStateIds.length === 0) {
    return new Map();
  }

  const niswanCounts = await School.aggregate([
    {
      $match: {
        districtStateId: { $in: districtStateIds },
      },
    },
    {
      $group: {
        _id: "$districtStateId",

        niswanActiveCount: {
          $sum: {
            $cond: [{ $eq: ["$active", "Active"] }, 1, 0],
          },
        },

        niswanInactiveCount: {
          $sum: {
            $cond: [{ $eq: ["$active", "In-Active"] }, 1, 0],
          },
        },
      },
    },
    {
      $addFields: {
        niswanCount: {
          $add: ["$niswanActiveCount", "$niswanInactiveCount"],
        },
      },
    },
  ]);

  return new Map(niswanCounts.map((x) => [String(x._id), x]));
};

const getDistrictEmployeeCountMap = async (districtStateIds = []) => {
  if (!Array.isArray(districtStateIds) || districtStateIds.length === 0) {
    return new Map();
  }

  const employeeCounts = await School.aggregate([
    {
      $match: {
        districtStateId: { $in: districtStateIds },
      },
    },

    {
      $lookup: {
        from: "employees",
        let: { sid: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$schoolId", "$$sid"] },
              active: { $in: ["Active", "In-Active"] },
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "userId",
              foreignField: "_id",
              as: "user",
            },
          },
          {
            $unwind: {
              path: "$user",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $project: {
              role: "$user.role",
              active: 1,
            },
          },
        ],
        as: "employeesTmp",
      },
    },

    {
      $unwind: {
        path: "$employeesTmp",
        preserveNullAndEmptyArrays: false,
      },
    },

    {
      $group: {
        _id: {
          districtStateId: "$districtStateId",
          role: "$employeesTmp.role",
        },

        activeCount: {
          $sum: {
            $cond: [{ $eq: ["$employeesTmp.active", "Active"] }, 1, 0],
          },
        },

        inactiveCount: {
          $sum: {
            $cond: [{ $eq: ["$employeesTmp.active", "In-Active"] }, 1, 0],
          },
        },
      },
    },

    {
      $addFields: {
        totalCount: {
          $add: ["$activeCount", "$inactiveCount"],
        },
      },
    },

    {
      $sort: {
        "_id.role": 1,
      },
    },

    {
      $group: {
        _id: "$_id.districtStateId",

        employeeCountsByRole: {
          $push: {
            role: "$_id.role",
            activeCount: "$activeCount",
            inactiveCount: "$inactiveCount",
            totalCount: "$totalCount",
          },
        },

        employeeActiveCount: { $sum: "$activeCount" },
        employeeInactiveCount: { $sum: "$inactiveCount" },
        employeeCount: { $sum: "$totalCount" },
      },
    },
  ]);

  return new Map(
    employeeCounts.map((x) => [
      String(x._id),
      {
        ...x,
        employeeCountsByRole: Array.isArray(x.employeeCountsByRole)
          ? x.employeeCountsByRole.map((item) => ({
            ...item,
            role: item?.role ? toCamelCase(item.role) : "",
          }))
          : [],
      },
    ])
  );
};

const getActiveAcYearObjectIdForPipeline = async () => {
  const activeAcYearId = await getActiveAcademicYearIdFromCache();

  if (!activeAcYearId) return null;

  return typeof activeAcYearId === "string" &&
    mongoose.Types.ObjectId.isValid(activeAcYearId)
    ? new mongoose.Types.ObjectId(activeAcYearId)
    : activeAcYearId;
};

// const getDistrictStudentCountMap = async (districtStateIds = []) => {
//   if (!Array.isArray(districtStateIds) || districtStateIds.length === 0) {
//     return new Map();
//   }

//   const studentCounts = await Student.aggregate([
//     {
//       $match: {
//         districtStateId: { $in: districtStateIds },
//         active: { $in: ["Active", "In-Active", "Alumni"] },
//         courses: { $exists: true, $ne: [] },
//       },
//     },

//     // ✅ Important: all courses, not only first course
//     {
//       $unwind: {
//         path: "$courses",
//         preserveNullAndEmptyArrays: false,
//       },
//     },

//     {
//       $group: {
//         _id: {
//           districtStateId: "$districtStateId",
//           courseId: "$courses",
//         },

//         activeCount: {
//           $sum: {
//             $cond: [{ $eq: ["$active", "Active"] }, 1, 0],
//           },
//         },

//         inactiveCount: {
//           $sum: {
//             $cond: [{ $eq: ["$active", "In-Active"] }, 1, 0],
//           },
//         },

//         alumniCount: {
//           $sum: {
//             $cond: [{ $eq: ["$active", "Alumni"] }, 1, 0],
//           },
//         },
//       },
//     },

//     {
//       $addFields: {
//         totalCount: {
//           $add: ["$activeCount", "$inactiveCount", "$alumniCount"],
//         },
//       },
//     },

//     {
//       $lookup: {
//         from: "courses",
//         localField: "_id.courseId",
//         foreignField: "_id",
//         as: "course",
//       },
//     },

//     {
//       $unwind: {
//         path: "$course",
//         preserveNullAndEmptyArrays: true,
//       },
//     },

//     {
//       $sort: {
//         "course.name": 1,
//       },
//     },

//     {
//       $group: {
//         _id: "$_id.districtStateId",

//         studentCountsByCourse: {
//           $push: {
//             courseId: "$_id.courseId",
//             courseName: "$course.name",
//             activeCount: "$activeCount",
//             inactiveCount: "$inactiveCount",
//             alumniCount: "$alumniCount",
//             totalCount: "$totalCount",
//           },
//         },

//         studentActiveCount: { $sum: "$activeCount" },
//         studentInactiveCount: { $sum: "$inactiveCount" },
//         studentAlumniCount: { $sum: "$alumniCount" },
//         studentCount: { $sum: "$totalCount" },
//       },
//     },
//   ]);

//   return new Map(studentCounts.map((x) => [String(x._id), x]));
// };
const getDistrictStudentCountMap = async (districtStateIds = []) => {
  if (!Array.isArray(districtStateIds) || districtStateIds.length === 0) {
    return new Map();
  }

  const activeAcYearObjectId = await getActiveAcYearObjectIdForPipeline();

  if (!activeAcYearObjectId) {
    return new Map();
  }

  const studentCounts = await Student.aggregate([
    {
      $match: {
        districtStateId: { $in: districtStateIds },
        active: { $in: ["Active", "In-Active", "Alumni"] },
      },
    },

    {
      $lookup: {
        from: "academics",
        let: {
          sid: "$_id",
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$studentId", "$$sid"] },
                  { $eq: ["$acYear", activeAcYearObjectId] },
                ],
              },
            },
          },

          {
            $project: {
              studentId: 1,
              courseIds: [
                "$courseId1",
                "$courseId2",
                "$courseId3",
                "$courseId4",
                "$courseId5",
              ],
            },
          },

          {
            $project: {
              studentId: 1,
              courseIds: {
                $filter: {
                  input: "$courseIds",
                  as: "cid",
                  cond: { $ne: ["$$cid", null] },
                },
              },
            },
          },

          {
            $unwind: {
              path: "$courseIds",
              preserveNullAndEmptyArrays: false,
            },
          },

          // ✅ avoid duplicate same student + same course
          {
            $group: {
              _id: {
                studentId: "$studentId",
                courseId: "$courseIds",
              },
            },
          },

          {
            $project: {
              _id: 0,
              courseId: "$_id.courseId",
            },
          },
        ],
        as: "academicCoursesTmp",
      },
    },

    {
      $unwind: {
        path: "$academicCoursesTmp",
        preserveNullAndEmptyArrays: false,
      },
    },

    {
      $group: {
        _id: {
          districtStateId: "$districtStateId",
          courseId: "$academicCoursesTmp.courseId",
          status: "$active",
        },
        count: { $sum: 1 },
      },
    },

    {
      $group: {
        _id: {
          districtStateId: "$_id.districtStateId",
          courseId: "$_id.courseId",
        },

        activeCount: {
          $sum: {
            $cond: [{ $eq: ["$_id.status", "Active"] }, "$count", 0],
          },
        },

        inactiveCount: {
          $sum: {
            $cond: [{ $eq: ["$_id.status", "In-Active"] }, "$count", 0],
          },
        },

        alumniCount: {
          $sum: {
            $cond: [{ $eq: ["$_id.status", "Alumni"] }, "$count", 0],
          },
        },
      },
    },

    {
      $addFields: {
        totalCount: {
          $add: ["$activeCount", "$inactiveCount", "$alumniCount"],
        },
      },
    },

    {
      $lookup: {
        from: "courses",
        localField: "_id.courseId",
        foreignField: "_id",
        as: "course",
      },
    },

    {
      $unwind: {
        path: "$course",
        preserveNullAndEmptyArrays: true,
      },
    },

    {
      $sort: {
        "course.name": 1,
      },
    },

    {
      $group: {
        _id: "$_id.districtStateId",

        studentCountsByCourse: {
          $push: {
            courseId: "$_id.courseId",
            courseName: "$course.name",
            activeCount: "$activeCount",
            inactiveCount: "$inactiveCount",
            alumniCount: "$alumniCount",
            totalCount: "$totalCount",
          },
        },

        studentActiveCount: { $sum: "$activeCount" },
        studentInactiveCount: { $sum: "$inactiveCount" },
        studentAlumniCount: { $sum: "$alumniCount" },
        studentCount: { $sum: "$totalCount" },
      },
    },
  ]);

  return new Map(studentCounts.map((x) => [String(x._id), x]));
};

const getDistrictStates = async (req, res) => {
  try {
    const districtStates = await DistrictState.find()
      .sort({ state: 1, district: 1 })
      .lean();

    const districtStateIds = districtStates.map((districtState) => districtState._id);

    const [niswanCountMap, employeeCountMap, studentCountMap] =
      await Promise.all([
        getDistrictNiswanCountMap(districtStateIds),
        getDistrictEmployeeCountMap(districtStateIds),
        getDistrictStudentCountMap(districtStateIds),
      ]);

    const result = districtStates.map((districtState) => {
      const did = String(districtState._id);

      const niswanStats = niswanCountMap.get(did);
      const employeeStats = employeeCountMap.get(did);
      const studentStats = studentCountMap.get(did);

      return {
        ...districtState,

        // ✅ Niswan counts
        niswanActiveCount: niswanStats?.niswanActiveCount || 0,
        niswanInactiveCount: niswanStats?.niswanInactiveCount || 0,
        niswanCount: niswanStats?.niswanCount || 0,

        // old/common aliases if existing UI uses these
        schoolCount: niswanStats?.niswanCount || 0,
        _schoolsCount: niswanStats?.niswanCount || 0,
        activeSchoolCount: niswanStats?.niswanActiveCount || 0,
        inactiveSchoolCount: niswanStats?.niswanInactiveCount || 0,

        // ✅ Employee counts
        employeeActiveCount: employeeStats?.employeeActiveCount || 0,
        employeeInactiveCount: employeeStats?.employeeInactiveCount || 0,
        employeeCount: employeeStats?.employeeCount || 0,
        employeeCountsByRole: employeeStats?.employeeCountsByRole || [],

        // ✅ Student counts
        studentActiveCount: studentStats?.studentActiveCount || 0,
        studentInactiveCount: studentStats?.studentInactiveCount || 0,
        studentAlumniCount: studentStats?.studentAlumniCount || 0,
        studentCount: studentStats?.studentCount || 0,
        studentCountsByCourse: studentStats?.studentCountsByCourse || [],
      };
    });

    return res.status(200).json({
      success: true,
      districtStates: result,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      error: "get district and States server error",
    });
  }
};
// const getDistrictStates = async (req, res) => {
//   try {
//     const districtStates = await DistrictState.find().sort({ state: 1, district: 1 });

//     const counts = await Student.aggregate([
//       {
//         $group: {
//           _id: '$districtStateId',
//           count: { $sum: 1 },
//         },
//       },
//     ]);

//     if (districtStates.length > 0 && counts.length > 0) {
//       for (const count of counts) {
//         districtStates.map(districtState => {
//           if (districtState?._id?.toString() == count?._id?.toString()) {
//             districtState._studentsCount = count.count;
//             districtState.toObject({ virtuals: true });
//           };
//         });
//       }
//     }

//     return res.status(200).json({ success: true, districtStates });
//   } catch (error) {
//     console.log(error)
//     return res
//       .status(500)
//       .json({ success: false, error: "get district and States server error" });
//   }
// };

const getDistrictStatesFromCache = async (req, res) => {
  try {
    const redis = await getRedis();

    let districtStates = [];
    try {
      const cached = await redis.get("districtStates");
      districtStates = cached ? JSON.parse(cached) : [];
    } catch {
      districtStates = [];
    }

    // ✅ Fallback to DB if cache empty (recommended)
    if (!Array.isArray(districtStates) || districtStates.length === 0) {
      districtStates = await DistrictState.find()
        .select("district state active")
        .sort({ state: 1, district: 1 })
        .lean();

      // ✅ refresh cache (best-effort)
      try {
        await redis.set("districtStates", JSON.stringify(districtStates), { EX: 60 * 10 }); // 10 min
      } catch {
        // ignore cache write errors
      }
    }

    return res.status(200).json({ success: true, districtStates });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "get district and States server error" });
  }
};

const getDistrictState = async (req, res) => {
  const { id } = req.params;
  try {
    let districtState = await DistrictState.findById({ _id: id });
    return res.status(200).json({ success: true, districtState });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get district and State server error" });
  }
};

const updateDistrictState = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      district,
      state, } = req.body;

    const districtState = await DistrictState.findById({ _id: id });
    if (!districtState) {
      return res
        .status(404)
        .json({ success: false, error: "DistrictState not found." });
    }

    const updateDistrictState = await DistrictState.findByIdAndUpdate({ _id: id }, {
      district: toCamelCase(district),
      state: toCamelCase(state),
    })

    if (!updateDistrictState) {
      return res
        .status(404)
        .json({ success: false, error: "document not found" });
    }

    return res.status(200).json({ success: true, message: "DistrictState details updated Successfully." })

  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "update districtStates server error" });
  }
};

const deleteDistrictState = async (req, res) => {
  try {
    const { id } = req.params;
    await DistrictState.findByIdAndDelete({ _id: id });

    const redis = await getRedis();
    await redis.set('totalDistrictStates', await DistrictState.countDocuments());

    return res.status(200).json({ success: true, message: "deleteDistrictState" })
  } catch (error) {
    return res.status(500).json({ success: false, error: "delete DistrictState server error" })
  }
}

export { addDistrictState, getDistrictStates, getDistrictState, updateDistrictState, deleteDistrictState, getDistrictStatesFromCache };
