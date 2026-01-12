import multer from "multer";
import { put } from "@vercel/blob";
import Supervisor from "../models/Supervisor.js";
import User from "../models/User.js";
import School from "../models/School.js";
import bcrypt from "bcrypt";
import getRedis from "../db/redis.js"
import { toCamelCase } from "./commonController.js";

const upload = multer({ storage: multer.memoryStorage() });

const addSupervisor = async (req, res) => {

  let savedUser;
  let savedSupervisor;
  try {
    const {
      name,
      email,
      supervisorId,
      address,
      contactNumber,
      routeName,
      qualification,
      dob,
      gender,
      maritalStatus,
      doj,
      salary,
      password,
      jobType,
      remarks
    } = req.body;

    console.log("user started");

    const user = await User.findOne({ email: email });
    if (user) {
      return res
        .status(400)
        .json({ success: false, error: "User already registered." });
    }

    const hashPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      name: toCamelCase(name),
      email,
      password: hashPassword,
      role: "supervisor",
      profileImage: "-",
      //profileImage: req.file ? req.file.buffer.toString('base64') : "",
    });
    const savedUser = await newUser.save();

    const newSupervisor = new Supervisor({
      userId: savedUser._id,
      supervisorId,
      address: toCamelCase(address),
      contactNumber,
      routeName: toCamelCase(routeName),
      qualification: toCamelCase(qualification),
      dob,
      gender,
      maritalStatus,
      doj,
      salary,
      jobType,
      remarks
    });

    savedSupervisor = await newSupervisor.save();

    const redis = await getRedis();
    await redis.set('totalSupervisors', String(await Supervisor.countDocuments({ active: "Active" })), { EX: 60 });

    if (req.file) {
      const fileBuffer = req.file.buffer;
      const blob = await put("profiles/" + savedUser._id + ".png", fileBuffer, {
        access: 'public',
        contentType: 'image/png',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        allowOverwrite: true,
      });

      await User.findByIdAndUpdate({ _id: savedUser._id }, { profileImage: blob.downloadUrl });
    }

    return res.status(200).json({ success: true, message: "Supervisor Created Successfully." });
  } catch (error) {
    console.log(error);

    if (savedUser != null) {
      await User.findByIdAndDelete({ _id: savedUser._id });
    }
    if (savedSupervisor != null) {
      await Supervisor.findByIdAndDelete({ _id: savedSupervisor._id });
    }

    return res
      .status(500)
      .json({ success: false, error: "Server error in adding supervisor" });
  }
};

const getSupervisors = async (req, res) => {
  try {
    // 1) Fetch supervisors (lean = faster)
    const supervisors = await Supervisor.find({ active: "Active" })
      .sort({ supervisorId: 1 })
      .select("supervisorId contactNumber active userId routeName jobType remarks")
      .populate({ path: "userId", select: "name email role" })
      .lean();

    // 2) Count schools per supervisorId
    const counts = await School.aggregate([
      { $match: { supervisorId: { $ne: null } } },
      { $group: { _id: "$supervisorId", count: { $sum: 1 } } },
    ]);

    // 3) Build lookup map: supervisorId -> count
    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

    // 4) Attach count to each supervisor
    const result = supervisors.map((s) => ({
      ...s,
      _schoolsCount: countMap.get(String(s._id)) || 0,
    }));

    return res.status(200).json({ success: true, supervisors: result });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "get supervisors server error" });
  }
};

{/* const getSupervisors = async (req, res) => {
  try {
    const supervisors = await Supervisor.find({ active: 'Active' }).sort({ supervisorId: 1 })
      .populate("userId", { password: 0, profileImage: 0 });

    const counts = await School.aggregate([
      {
        $group: {
          _id: '$supervisorId',
          count: { $sum: 1 },
        },
      },
    ]);

    if (supervisors.length > 0 && counts.length > 0) {
      for (const count of counts) {
        supervisors.map(supervisor => {
          if (supervisor._id.toString() == count._id.toString()) {
            supervisor._schoolsCount = count.count;
            supervisor.toObject({ virtuals: true });
          };
        });
      }
    }

    return res.status(200).json({ success: true, supervisors });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get supervisors server error" });
  }
};
*/}

const getBySupFilter = async (req, res) => {
  const { supSchoolId, supStatus, supType } = req.params;

  const isValidParam = (v) =>
    v !== undefined &&
    v !== null &&
    v !== "" &&
    v !== "null" &&
    v !== "undefined";

  try {
    const query = {};

    // If school is selected, resolve its supervisorId
    if (isValidParam(supSchoolId)) {
      const school = await School.findById(supSchoolId)
        .select("supervisorId")
        .lean();

      // No school or no supervisor mapped -> return empty
      if (!school?.supervisorId) {
        return res.status(200).json({ success: true, supervisors: [] });
      }

      query._id = school.supervisorId;
    }

    if (isValidParam(supStatus)) {
      query.active = supStatus;
    }

    if (isValidParam(supType)) {
      query.jobType = supType;
    }

    const finalQuery = { ...(query || {})};

    // Fetch supervisors (lean + select only needed)
    const supervisors = await Supervisor.find(finalQuery)
      .sort({ supervisorId: 1 })
      .select("supervisorId contactNumber active jobType userId routeName remarks") // add fields you need
      .populate({ path: "userId", select: "name email role" }) // safer than {password:0}
      .lean();

    if (supervisors.length === 0) {
      return res.status(200).json({ success: true, supervisors: [] });
    }

    // Count schools only for returned supervisors
    const supIds = supervisors.map((s) => s._id);

    const counts = await School.aggregate([
      { $match: { supervisorId: { $in: supIds } } },
      { $group: { _id: "$supervisorId", count: { $sum: 1 } } },
    ]);

    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

    const result = supervisors.map((s) => ({
      ...s,
      _schoolsCount: countMap.get(String(s._id)) || 0,
    }));

    return res.status(200).json({ success: true, supervisors: result });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "get Supervisors by FILTER server error" });
  }
};

{/*
const getBySupFilter = async (req, res) => {

  const { supSchoolId, supStatus, supType } = req.params;

  console.log("getBy Supervisor Filter : " + supSchoolId + ", " + supStatus + ",  " + supType);

  try {

    let filterQuery = Supervisor.find();

    if (supSchoolId && supSchoolId?.length > 0 && supSchoolId != 'null' && supSchoolId != 'undefined') {

      console.log("supSchoolId Added : " + supSchoolId);

      const school = await School.findById({ _id: supSchoolId });

      filterQuery = filterQuery.where('_id').eq(school?.supervisorId);
    }

    if (supStatus && supStatus?.length > 0 && supStatus != 'null' && supStatus != 'undefined') {

      console.log("supStatus Added : " + supStatus);
      filterQuery = filterQuery.where('active').eq(supStatus);
    }

    if (supType && supType?.length > 0 && supType != 'null' && supType != 'undefined') {

      console.log("supType Added : " + supType);
      filterQuery = filterQuery.where('jobType').eq(supType);
    }

    filterQuery.sort({ supervisorId: 1 });
    filterQuery.populate("userId", { password: 0, profileImage: 0 });

    // console.log(filterQuery);

    const supervisors = await filterQuery.exec();

    const counts = await School.aggregate([
      {
        $group: {
          _id: '$supervisorId',
          count: { $sum: 1 },
        },
      },
    ]);

    if (supervisors.length > 0 && counts.length > 0) {
      for (const count of counts) {
        supervisors.map(supervisor => {
          if (supervisor._id.toString() == count._id.toString()) {
            supervisor._schoolsCount = count.count;
            supervisor.toObject({ virtuals: true });
          };
        });
      }
    }

    console.log("Supervisors : " + supervisors?.length)
    return res.status(200).json({ success: true, supervisors });
  } catch (error) {
    console.log(error)
    return res
      .status(500)
      .json({ success: false, error: "get Supervisors by FILTER server error" });
  }
};
*/}

const getSupervisorsFromCache = async (req, res) => {
  try {
    const redis = await getRedis();
    const supervisors = JSON.parse(await redis.get('supervisors'));
    // console.log(supervisors);
    return res.status(200).json({ success: true, supervisors });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get supervisors server error" });
  }
};

const getSupervisor = async (req, res) => {
  const { id } = req.params;
  try {
    let supervisor;
    supervisor = await Supervisor.findById({ _id: id })
      .populate("userId", { password: 0, });

    if (!supervisor) {
      return res
        .status(400)
        .json({ success: false, error: "Supervisor data not found." });
    }

    return res.status(200).json({ success: true, supervisor });

  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "get supervisor server error" });
  }
};

const updateSupervisor = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, supervisorId, contactNumber, address, routeName, gender,
      qualification, dob, maritalStatus, doj, jobType, salary, remarks, active } = req.body;

    const supervisor = await Supervisor.findById({ _id: id });
    if (!supervisor) {
      return res
        .status(404)
        .json({ success: false, error: "Supervisor not found." });
    }
    const user = await User.findById({ _id: supervisor.userId })

    if (!user) {
      return res
        .status(404)
        .json({ success: false, error: "User not found." });
    }

    let updateUser;
    if (req.file) {
      const fileBuffer = req.file.buffer;
      const blob = await put("profiles/" + user._id + ".png", fileBuffer, {
        access: 'public',
        contentType: 'image/png',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        allowOverwrite: true,
      });

      updateUser = await User.findByIdAndUpdate({ _id: supervisor.userId }, {
        name: toCamelCase(name),
        profileImage: blob.downloadUrl,
      })
    } else {
      updateUser = await User.findByIdAndUpdate({ _id: supervisor.userId }, {
        name: toCamelCase(name),
      })
    }

    const updateSupervisor = await Supervisor.findByIdAndUpdate({ _id: id }, {
      supervisorId, contactNumber,
      address: toCamelCase(address),
      routeName: toCamelCase(routeName),
      gender,
      qualification: toCamelCase(qualification),
      dob, maritalStatus, jobType,
      doj, salary, remarks, active
    })

    if (!updateSupervisor || !updateUser) {
      return res
        .status(400)
        .json({ success: false, error: "Update Failed..." });
    }

    return res.status(200).json({ success: true, message: "Supervisor details updated Successfully." })

  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "update supervisors server error" });
  }
};

const deleteSupervisor = async (req, res) => {
  try {
    const { id } = req.params;
    //const deleteSupervisor = await Supervisor.findById({ _id: id })
    //await User.findByIdAndDelete({ _id: deleteSupervisor.userId._id })
    //await deleteSupervisor.deleteOne()

    const updateSupervisor = await Supervisor.findByIdAndUpdate({ _id: id }, {
      active: "In-Active",
      remarks: "Deleted",
    })

    const redis = await getRedis();
    await redis.set('totalSupervisors', String(await Supervisor.countDocuments({ active: "Active" })), { EX: 60 });

    return res.status(200).json({ success: true, updateSupervisor })
  } catch (error) {
    return res.status(500).json({ success: false, error: "delete Supervisor server error" })
  }
}

export { addSupervisor, upload, getSupervisors, getSupervisor, updateSupervisor, deleteSupervisor, getSupervisorsFromCache, getBySupFilter };
