import multer from "multer";
import ClassSection from "../models/ClassSection.js";
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

const addClassSection = async (req, res) => {
  try {
    const {
      classs,
      section,
      createdAt,
      updatedAt,
    } = req.body;

    const classsAndSection = await ClassSection.findByClasssAndSection({ classs, section });
    if (classsAndSection != null) {
      return res
        .status(404)
        .json({ success: false, error: "Same Class and Section found." });
    }

    const newClassSection = new ClassSection({
      classs,
      section,
      createdAt,
      updatedAt,
    });
    await newClassSection.save();
    return res.status(200).json({ success: true, message: "classSection is created." });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "server error in adding classSection" });
  }
};

const getClassSections = async (req, res) => {
  try {
    const classSections = await ClassSection.find()
    return res.status(200).json({ success: true, classSections });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get classSections server error" });
  }
};

const getClassSection = async (req, res) => {
  try {
    const { id } = req.params;
    const classSection = await ClassSection.findById({ _id: id })
    return res.status(200).json({ success: true, classSection })
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get classSections server error" });
  }
};

const updateClassSection = async (req, res) => {
  try {
    const { id } = req.params;
    const { classs, section } = req.body;

    const classSection = await ClassSection.findById({ _id: id });
    if (!classSection) {
      return res
        .status(404)
        .json({ success: false, error: "classSection not found" });
    }

    const updateClassSection = await ClassSection.findByIdAndUpdate({ _id: id }, {
      classs, section
    })

    if (!updateClassSection) {
      return res
        .status(404)
        .json({ success: false, error: "document not found" });
    }

    return res.status(200).json({ success: true, message: "classSection updated." })

  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "update classSections server error" });
  }
};

const deleteClassSection = async (req, res) => {
  try {
    const { id } = req.params;
    const deleteClassSection = await ClassSection.findById({ _id: id })
    await deleteClassSection.deleteOne()
    return res.status(200).json({ success: true, deleteClassSection })
  } catch (error) {
    return res.status(500).json({ success: false, error: "delete ClassSection server error" })
  }
}

export { addClassSection, upload, getClassSections, getClassSection, updateClassSection, deleteClassSection };
