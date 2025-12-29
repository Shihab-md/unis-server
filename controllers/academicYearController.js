import AcademicYear from "../models/AcademicYear.js";
import getRedis from "../db/redis.js"
import { toCamelCase } from "./commonController.js";

const addAcademicYear = async (req, res) => {
  try {
    const {
      acYear,
      desc,
    } = req.body;

    const academicYearByCode = await AcademicYear.findOne({ acYear: acYear });
    if (academicYearByCode != null) {
      return res
        .status(404)
        .json({ success: false, error: "AcademicYear Code already exists" });
    }

    const newAcademicYear = new AcademicYear({
      acYear,
      desc: toCamelCase(desc),
    });

    await newAcademicYear.save();

    const redis = await getRedis();
    await redis.set('totalAcademicYears', await AcademicYear.countDocuments());

    return res.status(200).json({ success: true, message: "AcademicYear Created Successfully." });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "server error in adding academicYear" });
  }
};

const getAcademicYears = async (req, res) => {
  try {
    const academicYears = await AcademicYear.find().sort({ acYear: 1 });
    return res.status(200).json({ success: true, academicYears });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get academicYears server error" });
  }
};

const getAcademicYearsFromCache = async (req, res) => {
  try {
    const redis = await getRedis();
    const academicYears = JSON.parse(await redis.get('academicYears'));
    return res.status(200).json({ success: true, academicYears });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get academicYears server error" });
  }
};

const getAcademicYear = async (req, res) => {
  const { id } = req.params;
  try {
    let academicYear = await AcademicYear.findById({ _id: id });
    return res.status(200).json({ success: true, academicYear });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get academicYears server error" });
  }
};

const updateAcademicYear = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      acYear,
      desc, } = req.body;

    const academicYear = await AcademicYear.findById({ _id: id });
    if (!academicYear) {
      return res
        .status(404)
        .json({ success: false, error: "AcademicYear not found." });
    }

    const updateAcademicYear = await AcademicYear.findByIdAndUpdate({ _id: id }, {
      acYear,
      desc: toCamelCase(desc),
    })

    if (!updateAcademicYear) {
      return res
        .status(404)
        .json({ success: false, error: "document not found" });
    }

    return res.status(200).json({ success: true, message: "AcademicYear details updated Successfully." })

  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "update academicYears server error" });
  }
};

const deleteAcademicYear = async (req, res) => {
  try {
    const { id } = req.params;
    const deleteAcademicYear = await AcademicYear.findById({ _id: id })
    await deleteAcademicYear.deleteOne();

    const redis = await getRedis();
    await redis.set('totalAcademicYears', await AcademicYear.countDocuments());

    return res.status(200).json({ success: true, deleteAcademicYear })
  } catch (error) {
    return res.status(500).json({ success: false, error: "delete AcademicYear server error" })
  }
}

export { addAcademicYear, getAcademicYears, getAcademicYear, updateAcademicYear, deleteAcademicYear, getAcademicYearsFromCache };
