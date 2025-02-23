import multer from "multer";
import School from "../models/School.js";
import User from "../models/User.js";
import bcrypt from "bcrypt";
import path from "path";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/uploads");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

const addSchool = async (req, res) => {
  try {
    const {
      code,
      name,
      address,
      contactNumber,
      email,
      incharge1,
      incharge1Number,
      incharge2,
      incharge2Number,
      active,
      createdBy,
      createdAt,
      updatedBy,
      updatedAt,
    } = req.body;

    const createdByUser = await User.findOne({ createdBy });
    if (createdByUser) {
      return res
        .status(400)
        .json({ success: false, error: "user already registered in emp" });
    }
    const updatedByUser = await User.findOne({ createdBy });
    if (updatedByUser) {
      return res
        .status(400)
        .json({ success: false, error: "user already registered in emp" });
    }

    const newSchool = new School({
      code,
      name,
      address,
      contactNumber,
      email,
      incharge1,
      incharge1Number,
      incharge2,
      incharge2Number,
      active,
      createdBy: createdByUser._id,
      createdAt,
      updatedBy: updatedByUser._id,
      updatedAt,
    });
    await newSchool.save();
    return res.status(200).json({ success: true, message: "school is created." });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "server error in adding school" });
  }
};

const getSchools = async (req, res) => {
  try {
    const schools = await School.find()
    return res.status(200).json({ success: true, schools });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get schools server error" });
  }
};

const getSchool = async (req, res) => {
  const { id } = req.params;
  try {
    let school;
       school = await School.findOne({ userId: id })
       .populate("createdBy", { password: 0 })
       .populate("updatedBy", { password: 0 })
    return res.status(200).json({ success: true, school });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get schools server error" });
  }
};

const updateSchool = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, contactNumber, email, incharge1, incharge1Number, incharge2, incharge2Number, active, updatedAt } = req.body;

    const school = await School.findById({ _id: id });
    if (!school) {
      return res
        .status(404)
        .json({ success: false, error: "school not found" });
    }
    const user = await User.findById({_id: school.updatedBy})

    if (!user) {
        return res
          .status(404)
          .json({ success: false, error: "user not found" });
      }

      // const updateUser = await User.findByIdAndUpdate({_id: school.userId}, {name})
      const updateSchool = await School.findByIdAndUpdate({_id: id}, {
        name, address, contactNumber, email, incharge1, incharge1Number, incharge2, incharge2Number, active, updatedBy: updatedByUser._id, updatedAt
      })

      if(!updateSchool) {
        return res
          .status(404)
          .json({ success: false, error: "document not found" });
      }

      return res.status(200).json({success: true, message: "school updated."})

  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "update schools server error" });
  }
};

export { addSchool, upload, getSchools, getSchool, updateSchool };
