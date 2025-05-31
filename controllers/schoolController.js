import multer from "multer";
import jwt from "jsonwebtoken";
import School from "../models/School.js";
import Supervisor from "../models/Supervisor.js";
import Employee from "../models/Employee.js";

const upload = multer({});

const addSchool = async (req, res) => {
  try {
    const {
      code,
      nameEnglish,
      nameArabic,
      nameNative,
      address,
      district,
      contactNumber,
      email,
      supervisorId,
      incharge1,
      incharge1Number,
      incharge2,
      incharge2Number,
      incharge3,
      incharge3Number,
      incharge4,
      incharge4Number,
      incharge5,
      incharge5Number,
      incharge6,
      incharge6Number,
      incharge7,
      incharge7Number,
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
      address,
      district,
      contactNumber,
      email,
      supervisorId,
      incharge1,
      incharge1Number,
      incharge2,
      incharge2Number,
      incharge3,
      incharge3Number,
      incharge4,
      incharge4Number,
      incharge5,
      incharge5Number,
      incharge6,
      incharge6Number,
      incharge7,
      incharge7Number,
      active,
      createdAt,
      updatedAt,
    });
    await newSchool.save();
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

    let schools = [];
    if (userRole == 'superadmin' || userRole == 'hquser') {
      schools = await School.find().sort({ code: 1 })
        .populate("supervisorId")
        .populate({
          path: 'supervisorId',
          populate: {
            path: 'userId',
            select: 'name'
          },
        });

    } else if (userRole == 'supervisor') {

      let supervisor = await Supervisor.findOne({ userId: userId })
      if (supervisor && supervisor.supervisorId) {
        schools = await School.find({ supervisorId: supervisor._id }).sort({ code: 1 })
          .populate("supervisorId")
          .populate({
            path: 'supervisorId',
            populate: {
              path: 'userId',
              select: 'name'
            },
          });
      }

    } else if (userRole == 'admin') {

      let employee = await Employee.findOne({ userId: userId })

      //  console.log(userId + " - " + employee.schoolId)
      if (employee && employee.schoolId) {
        schools = await School.find({ _id: employee.schoolId }).sort({ code: 1 })
          .populate("supervisorId")
          .populate({
            path: 'supervisorId',
            populate: {
              path: 'userId',
              select: 'name'
            },
          });
      }
    }

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
      nameNative, address, district, contactNumber, email, active, supervisorId, incharge1, incharge1Number, incharge2, incharge2Number, incharge3,
      incharge3Number,
      incharge4,
      incharge4Number,
      incharge5,
      incharge5Number,
      incharge6,
      incharge6Number,
      incharge7,
      incharge7Number, } = req.body;

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
      nameNative, address, district, contactNumber, email, active, supervisorId, incharge1, incharge1Number, incharge2, incharge2Number, incharge3,
      incharge3Number,
      incharge4,
      incharge4Number,
      incharge5,
      incharge5Number,
      incharge6,
      incharge6Number,
      incharge7,
      incharge7Number,
    })

    if (!updateSchool) {
      return res
        .status(404)
        .json({ success: false, error: "Niswan data not found" });
    }

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
    const deleteSchool = await School.findById({ _id: id })
    await deleteSchool.deleteOne()
    return res.status(200).json({ success: true, deleteSchool })
  } catch (error) {
    return res.status(500).json({ success: false, error: "delete School server error" })
  }
}

export { addSchool, upload, getSchools, getSchool, updateSchool, deleteSchool };
