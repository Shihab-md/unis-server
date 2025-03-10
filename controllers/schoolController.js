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
      district,
      contactNumber,
      email,
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
      active,
      createdAt,
      updatedAt,
    } = req.body;

    const schoolByCode = await School.findOne({ code });
    if (schoolByCode != null) {
      return res
        .status(404)
        .json({ success: false, error: "School Code already exists" });
    }

    const schoolByName = await School.findOne({ name });
    if (schoolByName != null) {
      return res
        .status(404)
        .json({ success: false, error: "School Name already exists" });
    }

    const newSchool = new School({
      code,
      name,
      address,
      district,
      contactNumber,
      email,
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
      active,
      createdAt,
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
  try {
    const { id } = req.params;
    const school = await School.findById({ _id: id })
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
    const { code, name, address, district, contactNumber, email, active, incharge1, incharge1Number, incharge2, incharge2Number, incharge3,
      incharge3Number,
      incharge4,
      incharge4Number,
      incharge5,
      incharge5Number, } = req.body;

    const school = await School.findById({ _id: id });
    if (!school) {
      return res
        .status(404)
        .json({ success: false, error: "school not found" });
    }

    const updateSchool = await School.findByIdAndUpdate({ _id: id }, {
      code, name, address, district, contactNumber, email, active, incharge1, incharge1Number, incharge2, incharge2Number, incharge3,
      incharge3Number,
      incharge4,
      incharge4Number,
      incharge5,
      incharge5Number,
    })

    if (!updateSchool) {
      return res
        .status(404)
        .json({ success: false, error: "document not found" });
    }

    return res.status(200).json({ success: true, message: "school updated." })

  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "update schools server error" });
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
