import multer from "multer";
import jwt from "jsonwebtoken";
import School from "../models/School.js";
import Supervisor from "../models/Supervisor.js";
import Employee from "../models/Employee.js";
import Numbering from "../models/Numbering.js";
import getRedis from "../db/redis.js"
import mongoose from "mongoose";
import { toCamelCase } from "./commonController.js";

const upload = multer({});

export async function generateNextSchoolCode(prefixRaw) {
  const prefix = String(prefixRaw || "").trim().toUpperCase();

  // Allows UN-01, UN-AP, UN-75, UN-KL etc (2 chars after UN-)
  if (!/^UN-[A-Z0-9]{2}$/.test(prefix)) {
    throw new Error("Invalid prefix. Expected like UN-01 / UN-AP / UN-75 / UN-KL");
  }

  const numbering = await Numbering.findOneAndUpdate(
    { name: "School" },
    { $inc: { currentNumber: 1 } },
    { new: true, upsert: true }
  ).lean();

  const next5 = String(numbering.currentNumber).padStart(5, "0");
  return `${prefix}-${next5}`;
}

const addSchool = async (req, res) => {
  try {
    const {
      code,
      nameEnglish,
      nameArabic,
      nameNative,
      address,
      city,
      districtStateId,
      landmark,
      pincode,

      district,
      state,
      contactNumber,
      doe,
      email,
      supervisorId,
      incharge1,
      designation1,
      incharge1Number,
      incharge2,
      designation2,
      incharge2Number,
      incharge3,
      designation3,
      incharge3Number,
      incharge4,
      designation4,
      incharge4Number,
      incharge5,
      designation5,
      incharge5Number,
      incharge6,
      designation6,
      incharge6Number,
      incharge7,
      incharge7Number,
      designation7,
      active,
      createdAt,
      updatedAt,
    } = req.body;

    const schoolByCode = await School.findOne({ code });
    if (schoolByCode != null) {
      return res
        .status(404)
        .json({ success: false, error: "Niswan Code already exists" });
    }

    {/*const schoolByName = await School.findOne({ nameEnglish });
    if (schoolByName != null) {
      return res
        .status(404)
        .json({ success: false, error: "Niswan Name already exists" });
    }*/}

    const supervisorById = await Supervisor.findOne({ _id: supervisorId });
    if (supervisorById == null) {
      return res
        .status(404)
        .json({ success: false, error: "Supervisor data not found." });
    }

    const newCode = await generateNextSchoolCode(code);

    const newSchool = new School({
      code: newCode,
      nameEnglish,
      nameArabic,
      nameNative,

      address: toCamelCase(address),
      city: toCamelCase(city),
      districtStateId,
      landmark: toCamelCase(landmark),
      pincode,

      district: toCamelCase(district),
      state: toCamelCase(state),

      contactNumber,
      doe,
      email,
      supervisorId,

      incharge1: toCamelCase(incharge1),
      incharge1Number,
      designation1: toCamelCase(designation1),

      incharge2: toCamelCase(incharge2),
      incharge2Number,
      designation2: toCamelCase(designation2),

      incharge3: toCamelCase(incharge3),
      incharge3Number,
      designation3: toCamelCase(designation3),

      incharge4: toCamelCase(incharge4),
      incharge4Number,
      designation4: toCamelCase(designation4),

      incharge5: toCamelCase(incharge5),
      incharge5Number,
      designation5: toCamelCase(designation5),

      incharge6: toCamelCase(incharge6),
      incharge6Number,
      designation6: toCamelCase(designation6),

      incharge7: toCamelCase(incharge7),
      incharge7Number,
      designation7: toCamelCase(designation7),

      active,
      createdAt,
      updatedAt,
    });
    await newSchool.save();

    const redis = await getRedis();
    await redis.set('totalSchools', await School.countDocuments() - 1); // Minus HQ

    return res.status(200).json({ success: true, message: "Niswan is created." });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "server error in adding school" });
  }
};

const getSchools = async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const parts = auth.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return res.status(401).json({ success: false, error: "Unauthorized Request" });
    }

    const decoded = jwt.verify(parts[1], process.env.JWT_SECRET);
    const userId = decoded._id;
    const userRole = decoded.role;

    let filter = {};

    if (userRole === "superadmin" || userRole === "hquser") {
      filter = {};
    } else if (userRole === "supervisor") {
      const supervisor = await Supervisor.findOne({ userId }).select("_id").lean();
      if (!supervisor?._id) return res.status(200).json({ success: true, schools: [] });
      filter = { supervisorId: supervisor._id };
    } else if (userRole === "admin") {
      const employee = await Employee.findOne({ userId }).select("schoolId").lean();
      if (!employee?.schoolId) return res.status(200).json({ success: true, schools: [] });
      filter = { _id: employee.schoolId };
    } else {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    // pagination
    const hasPaging = req.query.page || req.query.limit;
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "200", 10), 1), 500);
    const skip = (page - 1) * limit;

    const pipeline = [
      { $match: filter },

      // ✅ Active student count + breakdown by course NAME
      {
        $lookup: {
          from: "students",
          let: { sid: "$_id" },
          pipeline: [
            // only Active students of this school
            {
              $match: {
                $expr: { $eq: ["$schoolId", "$$sid"] },
                active: "Active",
              },
            },

            // take first courseId (if each student has one course)
            { $addFields: { courseId: { $arrayElemAt: ["$courses", 0] } } },

            // group by courseId
            {
              $group: {
                _id: "$courseId",
                count: { $sum: 1 },
              },
            },

            // lookup course name
            {
              $lookup: {
                from: "courses",
                localField: "_id",
                foreignField: "_id",
                as: "course",
              },
            },
            { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },

            // shape output
            {
              $project: {
                _id: 0,
                courseId: "$_id",
                courseName: "$course.name",
                count: 1,
              },
            },

            // sort by courseName (optional)
            { $sort: { courseName: 1 } },
          ],
          as: "studentCountsByCourse",
        },
      },

      // total active students = sum counts
      {
        $addFields: {
          studentCount: { $sum: "$studentCountsByCourse.count" },
        },
      },

      // districtStateId populate
      {
        $lookup: {
          from: "districtstates",
          localField: "districtStateId",
          foreignField: "_id",
          as: "districtStateId",
        },
      },
      { $unwind: { path: "$districtStateId", preserveNullAndEmptyArrays: true } },

      // supervisorId -> supervisor doc
      {
        $lookup: {
          from: "supervisors",
          localField: "supervisorId",
          foreignField: "_id",
          as: "supervisorId",
        },
      },
      { $unwind: { path: "$supervisorId", preserveNullAndEmptyArrays: true } },

      // supervisorId.userId -> user name
      {
        $lookup: {
          from: "users",
          localField: "supervisorId.userId",
          foreignField: "_id",
          as: "supervisorUser",
        },
      },
      { $unwind: { path: "$supervisorUser", preserveNullAndEmptyArrays: true } },

      // shape supervisor like populate
      {
        $addFields: {
          "supervisorId.userId": {
            _id: "$supervisorUser._id",
            name: "$supervisorUser.name",
          },
        },
      },
      { $project: { supervisorUser: 0 } },

      // final fields
      {
        $project: {
          code: 1,
          nameEnglish: 1,
          nameArabic: 1,
          nameNative: 1,
          address: 1,
          city: 1,
          contactNumber: 1,
          active: 1,
          supervisorId: 1,
          districtStateId: { district: 1, state: 1 },

          // ✅ counts
          studentCount: 1,
          studentCountsByCourse: 1, // [{ courseId, courseName, count }]
        },
      },

      { $sort: { code: 1 } },
    ];

    if (hasPaging) pipeline.push({ $skip: skip }, { $limit: limit });

    const schools = await School.aggregate(pipeline);
    return res.status(200).json({ success: true, schools });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, error: "get schools server error" });
  }
};

const getBySchFilter = async (req, res) => {
  const { supervisorId, districtStateId, schStatus } = req.params;

  const isValidParam = (v) =>
    v !== undefined && v !== null && String(v).trim() !== "" &&
    v !== "null" && v !== "undefined";

  const toStr = (v) => (v === undefined || v === null ? "" : String(v).trim());

  const isObjectId = (v) => /^[0-9a-fA-F]{24}$/.test(String(v));

  try {
    const baseMatch = {};

    // ✅ supervisorId is stored as ObjectId → convert
    if (isValidParam(supervisorId)) {
      if (!isObjectId(supervisorId)) {
        return res.status(400).json({ success: false, error: "Invalid supervisorId" });
      }
      baseMatch.supervisorId = new mongoose.Types.ObjectId(supervisorId);
    }

    // ✅ status normalize
    if (isValidParam(schStatus)) {
      baseMatch.active = toStr(schStatus);
    }

    // districtStateId can be ObjectId OR "District, State"
    const dsRaw = toStr(districtStateId);
    const dsIsObjId = isValidParam(dsRaw) && isObjectId(dsRaw);

    if (dsIsObjId) {
      baseMatch.districtStateId = new mongoose.Types.ObjectId(dsRaw);
    }

    // If user sends "Kerala, Kerala" we match after lookup
    let dsDistrict = "";
    let dsState = "";
    if (isValidParam(dsRaw) && !dsIsObjId) {
      // handle "Kerala, Kerala," and extra spaces
      const parts = dsRaw
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);

      dsDistrict = parts[0] || "";
      dsState = parts[1] || "";
    }

    const pipeline = [
      { $match: baseMatch },

      // ✅ districtStateId lookup FIRST (needed for text matching)
      {
        $lookup: {
          from: "districtstates",
          localField: "districtStateId",
          foreignField: "_id",
          as: "districtStateId",
        },
      },
      { $unwind: { path: "$districtStateId", preserveNullAndEmptyArrays: true } },

      // ✅ If district/state passed as TEXT, match here
      ...(dsDistrict || dsState
        ? [
          {
            $match: {
              ...(dsDistrict ? { "districtStateId.district": dsDistrict } : {}),
              ...(dsState ? { "districtStateId.state": dsState } : {}),
            },
          },
        ]
        : []),

      // ✅ Active student count + breakdown by course NAME
      {
        $lookup: {
          from: "students",
          let: { sid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$schoolId", "$$sid"] },
                active: "Active",
              },
            },
            { $addFields: { courseId: { $arrayElemAt: ["$courses", 0] } } },
            { $group: { _id: "$courseId", count: { $sum: 1 } } },
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
              $project: {
                _id: 0,
                courseId: "$_id",
                courseName: "$course.name",
                count: 1,
              },
            },
            { $sort: { courseName: 1 } },
          ],
          as: "studentCountsByCourse",
        },
      },
      { $addFields: { studentCount: { $sum: "$studentCountsByCourse.count" } } },

      // ✅ supervisor populate
      {
        $lookup: {
          from: "supervisors",
          localField: "supervisorId",
          foreignField: "_id",
          as: "supervisorId",
        },
      },
      { $unwind: { path: "$supervisorId", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          localField: "supervisorId.userId",
          foreignField: "_id",
          as: "supervisorUser",
        },
      },
      { $unwind: { path: "$supervisorUser", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          "supervisorId.userId": {
            _id: "$supervisorUser._id",
            name: "$supervisorUser.name",
          },
        },
      },
      { $project: { supervisorUser: 0 } },

      // final fields
      {
        $project: {
          code: 1,
          nameEnglish: 1,
          nameArabic: 1,
          nameNative: 1,
          address: 1,
          city: 1,
          active: 1,
          contactNumber: 1,
          supervisorId: 1,
          districtStateId: { district: 1, state: 1 },
          studentCount: 1,
          studentCountsByCourse: 1,
        },
      },

      { $sort: { code: 1 } },
    ];

    const schools = await School.aggregate(pipeline);
    return res.status(200).json({ success: true, schools });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "get schools by FILTER server error" });
  }
};

{/*
const getSchools = async (req, res) => {
  console.log("getSchools called.")
  try {
    const auth = req.headers.authorization || "";
    const parts = auth.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return res.status(401).json({ success: false, error: "Unauthorized Request" });
    }

    const decoded = jwt.verify(parts[1], process.env.JWT_SECRET);
    const userId = decoded._id;
    const userRole = decoded.role;

    // Remove noisy logs (serverless performance)
    // console.log(userId + " , " + userRole);

    // Keep payload minimal (add fields if your UI needs more)
    const schoolSelect =
      "code nameEnglish nameArabic nameNative address city contactNumber active supervisorId districtStateId";

    const populateDistrictState = {
      path: "districtStateId",
      select: "district state",
    };

    const populateSupervisor = {
      path: "supervisorId",
      select: "userId, supervisorId",
      populate: {
        path: "userId",
        select: "name",
      },
    };

    let filter = {};

    if (userRole === "superadmin" || userRole === "hquser") {
      filter = {};

    } else if (userRole === "supervisor") {
      const supervisor = await Supervisor.findOne({ userId })
        .select("_id")
        .lean();

      if (!supervisor?._id) {
        return res.status(200).json({ success: true, schools: [] });
      }

      filter = { supervisorId: supervisor._id };

    } else if (userRole === "admin") {
      const employee = await Employee.findOne({ userId })
        .select("schoolId")
        .lean();

      if (!employee?.schoolId) {
        return res.status(200).json({ success: true, schools: [] });
      }

      filter = { _id: employee.schoolId };

    } else {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    // Optional pagination (only if query params provided)
    const hasPaging = req.query.page || req.query.limit;
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "200", 10), 1), 500);
    const skip = (page - 1) * limit;

    let query = School.find(filter)
      .select(schoolSelect)
      .sort({ code: 1 })
      .populate(populateDistrictState)
      .populate(populateSupervisor)
      .lean();

    if (hasPaging) {
      query = query.skip(skip).limit(limit);
    }

    const schools = await query;
    return res.status(200).json({ success: true, schools });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, error: "get schools server error" });
  }
};
*/}

{/* 
  const getSchools = async (req, res) => {
  try {
    //  const userRole = req.headers['x-u-r'];
    //  const userId = req.headers['x-u-i'];

    const usertoken = req.headers.authorization;
    const token = usertoken.split(' ');
    const decoded = jwt.verify(token[1], process.env.JWT_SECRET);
    //const userId = decoded._id;
    const userRole = decoded.role;

    //console.log(userId + " , " + userRole)
    let schools = [];
    if (userRole == 'superadmin' || userRole == 'hquser') {
      schools = await School.find().sort({ code: 1 })
        // .populate("supervisorId")
        .populate("districtStateId")
        .populate({path: 'supervisorId', populate: {path: 'userId', select: 'name'}});

    } else if (userRole == 'supervisor') {

      const supervisor = await Supervisor.findOne({ userId: userId });
      if (supervisor && supervisor._id) {
        // console.log(supervisor._id.toString())
        schools = await School.find({ supervisorId: supervisor._id }).sort({ code: 1 })
          //  .populate("supervisorId")
          .populate("districtStateId")
          .populate({
            path: 'supervisorId',
            populate: {
              path: 'userId',
              select: 'name'
            },
          });

        //    console.log(schools)
      }

    } else if (userRole == 'admin') {

      let employee = await Employee.findOne({ userId: userId })

      //  console.log(userId + " - " + employee.schoolId)
      if (employee && employee.schoolId) {
        schools = await School.find({ _id: employee.schoolId }).sort({ code: 1 })
          //  .populate("supervisorId")
          .populate("districtStateId")
          .populate({
            path: 'supervisorId',
            populate: {
              path: 'userId',
              select: 'name'
            },
          });
      }
    }

      const counts = await Student.aggregate([
      {
        $group: {
          _id: '$schoolId',
          count: { $sum: 1 },
        },
      },
    ]);
    //  console.log(JSON.stringify(counts));

    if (schools.length > 0 && counts.length > 0) {
      for (const count of counts) {
        schools.map(school => {
          if (school._id.toString() == count._id.toString()) {
            school._studentsCount = count.count;
            school.toObject({ virtuals: true });
          };
        });
      }
    }

  
      const redis = await getRedis();
    const districtStates = JSON.parse(await redis.get('districtStates'));

    let count = 0;
    if (schools.length > 0 && districtStates.length > 0) {
      schools.map(school => {
      //  console.log("1 - " + school.district + ", " + school.state)
        districtStates.map(async districtState => {

      //    console.log("2 - " + districtState.district + ", " + districtState.state)
          if ((districtState.district + ", " + districtState.state).toLowerCase() == (school.district + ", " + school.state).toLowerCase()) {
            school.districtStateId = districtState._id;
            await School.findByIdAndUpdate({ _id: school._id }, { districtStateId: districtState._id });
            console.log("OK");
            count++;
          };
        });
      });
    }
    console.log("Count - " + count)
  

    return res.status(200).json({ success: true, schools });
  } catch (error) {
    console.log(error)
    return res
      .status(500)
      .json({ success: false, error: "get schools server error" });
  }
};

*/}

{/*
const getBySchFilter = async (req, res) => {
  const { supervisorId, districtStateId, schStatus } = req.params;

  const isValidParam = (v) =>
    v !== undefined &&
    v !== null &&
    v !== "" &&
    v !== "null" &&
    v !== "undefined";

  try {
    const query = {};

    if (isValidParam(supervisorId)) {
      query.supervisorId = supervisorId;
    }

    if (isValidParam(districtStateId)) {
      query.districtStateId = districtStateId;
    }

    if (isValidParam(schStatus)) {
      query.active = schStatus;
    }

    // Select only needed fields for list (add more if UI needs)
    const schoolSelect =
      "code nameEnglish nameArabic nameNative address city active contactNumber supervisorId districtStateId";

    const schools = await School.find(query)
      .select(schoolSelect)
      .sort({ code: 1 })
      .populate({ path: "districtStateId", select: "district state" })
      .populate({
        path: "supervisorId",
        select: "userId supervisorId", // keep minimal
        populate: { path: "userId", select: "name" },
      })
      .lean();

    return res.status(200).json({ success: true, schools });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "get schools by FILTER server error" });
  }
};
*/}
{/*
const getBySchFilter = async (req, res) => {

  const { supervisorId, districtStateId, schStatus } = req.params;

  console.log("getBy School Filter : " + supervisorId + ", " + districtStateId + ",  " + schStatus);

  try {

    let filterQuery = School.find();

    if (supervisorId && supervisorId?.length > 0 && supervisorId != 'null' && supervisorId != 'undefined') {

      console.log("supervisorId Added : " + supervisorId);
      filterQuery = filterQuery.where('supervisorId').eq(supervisorId);
    }

    if (districtStateId && districtStateId?.length > 0 && districtStateId != 'null' && districtStateId != 'undefined') {

      console.log("districtStateId Added : " + districtStateId);
      filterQuery = filterQuery.where('districtStateId').eq(districtStateId);
    }

    if (schStatus && schStatus?.length > 0 && schStatus != 'null' && schStatus != 'undefined') {

      console.log("schStatus Added : " + schStatus);
      filterQuery = filterQuery.where('active').eq(schStatus);
    }

    filterQuery.sort({ code: 1 });
    filterQuery.populate("districtStateId")
      .populate({
        path: 'supervisorId',
        populate: {
          path: 'userId',
          select: 'name'
        },
      });

    // console.log(filterQuery);

    const schools = await filterQuery.exec();

    console.log("schools : " + schools?.length)
    return res.status(200).json({ success: true, schools });
  } catch (error) {
    console.log(error)
    return res
      .status(500)
      .json({ success: false, error: "get schools by FILTER server error" });
  }
};
*/}

const getSchoolsFromCache = async (req, res) => {
  try {
    const redis = await getRedis();

    let schools = [];
    try {
      const cached = await redis.get("schools");
      schools = cached ? JSON.parse(cached) : [];
    } catch {
      schools = [];
    }

    // ✅ Fallback to DB if cache empty (optional but recommended)
    if (!Array.isArray(schools) || schools.length === 0) {
      schools = await School.find()
        .select("code nameEnglish nameArabic nameNative address city contactNumber active supervisorId districtStateId")
        .sort({ code: 1 })
        .lean();

      // ✅ refresh cache (best-effort)
      try {
        await redis.set("schools", JSON.stringify(schools), { EX: 60 * 10 }); // 10 min
      } catch {
        // ignore cache write errors
      }
    }

    return res.status(200).json({ success: true, schools });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, error: "get schools server error" });
  }
};

{/*
const getSchoolsFromCache = async (req, res) => {
  try {
    const redis = await getRedis();
    const schools = JSON.parse(await redis.get('schools'));
    return res.status(200).json({ success: true, schools });
  } catch (error) {
    console.log(error)
    return res
      .status(500)
      .json({ success: false, error: "get schools server error" });
  }
};
*/}
const getSchool = async (req, res) => {
  try {
    const { id } = req.params;
    const school = await School.findById({ _id: id })
      .populate("supervisorId")
      .populate("districtStateId")
      .populate({
        path: 'supervisorId',
        populate: {
          path: 'userId',
          select: 'name'
        },
      });

    return res.status(200).json({ success: true, school })
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get schools server error" });
  }
};

const updateSchool = async (req, res) => {
  try {
    const { id } = req.params;
    const { code, nameEnglish,
      nameArabic,
      nameNative,
      address,
      city,
      districtStateId,
      landmark,
      pincode,

      district, state,

      contactNumber, doe, email, active,
      supervisorId,

      incharge1,
      designation1,
      incharge1Number,
      incharge2,
      designation2,
      incharge2Number,
      incharge3,
      designation3,
      incharge3Number,
      incharge4,
      designation4,
      incharge4Number,
      incharge5,
      designation5,
      incharge5Number,
      incharge6,
      designation6,
      incharge6Number,
      incharge7,
      incharge7Number,
      designation7,
    } = req.body;

    const school = await School.findById({ _id: id });
    if (!school) {
      return res
        .status(404)
        .json({ success: false, error: "Niswan not found" });
    }

    const supervisorById = await Supervisor.findOne({ _id: supervisorId });
    if (supervisorById == null) {
      return res
        .status(404)
        .json({ success: false, error: "Supervisor data not found." });
    }

    const updateSchool = await School.findByIdAndUpdate({ _id: id }, {
      code, nameEnglish,
      nameArabic,
      nameNative,

      address: toCamelCase(address),
      city: toCamelCase(city),
      districtStateId,
      landmark: toCamelCase(landmark),
      pincode,

      district: toCamelCase(district),
      state: toCamelCase(state),

      contactNumber, doe, email, active,
      supervisorId,

      incharge1: toCamelCase(incharge1),
      incharge1Number,
      designation1: toCamelCase(designation1),

      incharge2: toCamelCase(incharge2),
      incharge2Number,
      designation2: toCamelCase(designation2),

      incharge3: toCamelCase(incharge3),
      incharge3Number,
      designation3: toCamelCase(designation3),

      incharge4: toCamelCase(incharge4),
      incharge4Number,
      designation4: toCamelCase(designation4),

      incharge5: toCamelCase(incharge5),
      incharge5Number,
      designation5: toCamelCase(designation5),

      incharge6: toCamelCase(incharge6),
      incharge6Number,
      designation6: toCamelCase(designation6),

      incharge7: toCamelCase(incharge7),
      incharge7Number,
      designation7: toCamelCase(designation7),
    })

    if (!updateSchool) {
      return res
        .status(404)
        .json({ success: false, error: "Niswan data not found" });
    }
    {/*
    const schoolList = await School.find({});

    console.log(JSON.stringify(schoolList));

    for (const school of schoolList) {
      let value = school.district + ", TAMILNADU.";
      await School.findByIdAndUpdate({ _id: school._id }, {
        district: value,
      });
    }
      */}

    return res.status(200).json({ success: true, message: "Niswan updated." })

  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "update Niswan server error" });
  }
};

const deleteSchool = async (req, res) => {
  try {
    const { id } = req.params;
    await School.findByIdAndDelete({ _id: id })
    // await deleteSchool.deleteOne()

    const redis = await getRedis();
    await redis.set('totalSchools', await School.countDocuments() - 1); // Minus HQ

    return res.status(200).json({ success: true, deleteSchool })
  } catch (error) {
    return res.status(500).json({ success: false, error: "delete School server error" })
  }
}

export { addSchool, upload, getSchools, getSchool, updateSchool, deleteSchool, getSchoolsFromCache, getBySchFilter };
