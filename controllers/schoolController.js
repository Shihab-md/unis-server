import multer from "multer";
import School from "../models/School.js";
import Supervisor from "../models/Supervisor.js";

const upload = multer({ });

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

    const supervisorById = await Supervisor.findOne({ supervisorId });
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
    const schools = await School.find().sort({ code: 1 });
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

    const supervisorById = await Supervisor.findOne({ supervisorId });
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
