import Institute from "../models/Institute.js";
import redisClient from "../db/redis.js"
import { toCamelCase } from "./commonController.js";

const addInstitute = async (req, res) => {
  try {
    const {
      iCode,
      name,
      type,
      contactNumber,
      email,
      address,
      district,
      incharge1,
      incharge1Number,
      incharge2,
      incharge2Number,
    } = req.body;

    const instituteByCode = await Institute.findOne({ iCode: iCode });
    if (instituteByCode != null) {
      return res
        .status(404)
        .json({ success: false, error: "Institute Code already exists" });
    }

    const newInstitute = new Institute({
      iCode,
      name,
      type,
      contactNumber,
      email,
      address: toCamelCase(address),
      district: toCamelCase(district),
      incharge1: toCamelCase(incharge1),
      incharge1Number,
      incharge2: toCamelCase(incharge2),
      incharge2Number,
    });

    await newInstitute.save();

    await redisClient.set('totalInstitutes', await Institute.countDocuments());

    return res.status(200).json({ success: true, message: "Institute Created Successfully." });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "server error in adding institute" });
  }
};

const getInstitutes = async (req, res) => {
  try {
    const institutes = await Institute.find();
    return res.status(200).json({ success: true, institutes });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get institutes server error" });
  }
};

const getInstitutesFromCache = async (req, res) => {
  try {
    const institutes = JSON.parse(await redisClient.get('institutes'));
    //  console.log(institutes)
    return res.status(200).json({ success: true, institutes });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get institutes server error" });
  }
};

const getInstitute = async (req, res) => {
  const { id } = req.params;
  try {
    let institute = await Institute.findById({ _id: id });
    return res.status(200).json({ success: true, institute });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get institutes server error" });
  }
};

const updateInstitute = async (req, res) => {
  try {
    const { id } = req.params;
    const { name,
      type,
      contactNumber,
      email,
      address,
      district,
      incharge1,
      incharge1Number,
      incharge2,
      incharge2Number, } = req.body;

    const institute = await Institute.findById({ _id: id });
    if (!institute) {
      return res
        .status(404)
        .json({ success: false, error: "Institute not found." });
    }

    const updateInstitute = await Institute.findByIdAndUpdate({ _id: id }, {
      name,
      type,
      contactNumber,
      email,
      address: toCamelCase(address),
      district: toCamelCase(district),
      incharge1: toCamelCase(incharge1),
      incharge1Number,
      incharge2: toCamelCase(incharge2),
      incharge2Number,
    })

    if (!updateInstitute) {
      return res
        .status(404)
        .json({ success: false, error: "document not found" });
    }

    return res.status(200).json({ success: true, message: "Institute details updated Successfully." })

  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "update institutes server error" });
  }
};

const deleteInstitute = async (req, res) => {
  try {
    const { id } = req.params;
    const deleteInstitute = await Institute.findById({ _id: id })
    await deleteInstitute.deleteOne();

    await redisClient.set('totalInstitutes', await Institute.countDocuments());

    return res.status(200).json({ success: true, deleteInstitute })
  } catch (error) {
    return res.status(500).json({ success: false, error: "delete Institute server error" })
  }
}

export { addInstitute, getInstitutes, getInstitute, updateInstitute, deleteInstitute, getInstitutesFromCache };
