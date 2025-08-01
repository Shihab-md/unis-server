import multer from "multer";
import jwt from "jsonwebtoken";
import School from "../models/School.js";
import Supervisor from "../models/Supervisor.js";
import Employee from "../models/Employee.js";
import redisClient from "../db/redis.js"
import { toCamelCase } from "./commonController.js";

const upload = multer({});

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

    const newSchool = new School({
      code,
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

    await redisClient.set('totalSchools', await School.countDocuments() - 1); // Minus HQ

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
    //  const userRole = req.headers['x-u-r'];
    //  const userId = req.headers['x-u-i'];

    const usertoken = req.headers.authorization;
    const token = usertoken.split(' ');
    const decoded = jwt.verify(token[1], process.env.JWT_SECRET);
    const userId = decoded._id;
    const userRole = decoded.role;

    console.log(userId + " , " + userRole)
    let schools = [];
    if (userRole == 'superadmin' || userRole == 'hquser') {
      schools = await School.find().sort({ code: 1 })
        // .populate("supervisorId")
        .populate("districtStateId")
        .populate({
          path: 'supervisorId',
          populate: {
            path: 'userId',
            select: 'name'
          },
        });

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

    {/*  const counts = await Student.aggregate([
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
    }*/}

    {/*
    const districtStates = JSON.parse(await redisClient.get('districtStates'));

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
    */}

    return res.status(200).json({ success: true, schools });
  } catch (error) {
    console.log(error)
    return res
      .status(500)
      .json({ success: false, error: "get schools server error" });
  }
};

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

const getSchoolsFromCache = async (req, res) => {
  try {
    const schools = JSON.parse(await redisClient.get('schools'));
    return res.status(200).json({ success: true, schools });
  } catch (error) {
    console.log(error)
    return res
      .status(500)
      .json({ success: false, error: "get schools server error" });
  }
};

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

    await redisClient.set('totalSchools', await School.countDocuments() - 1); // Minus HQ

    return res.status(200).json({ success: true, deleteSchool })
  } catch (error) {
    return res.status(500).json({ success: false, error: "delete School server error" })
  }
}

export { addSchool, upload, getSchools, getSchool, updateSchool, deleteSchool, getSchoolsFromCache, getBySchFilter };
