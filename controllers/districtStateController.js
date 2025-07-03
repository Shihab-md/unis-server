import DistrictState from "../models/DistrictState.js";
import Student from "../models/Student.js";
import redisClient from "../db/redis.js"
import { toCamelCase } from "./commonController.js";

const addDistrictState = async (req, res) => {
  try {
    const {
      district,
      state,
    } = req.body;

    const districtStateByCode = await DistrictState.findOne({ district: district, state: state });
    if (districtStateByCode != null) {
      return res
        .status(400)
        .json({ success: false, error: "District and State already exists" });
    }

    const newDistrictState = new DistrictState({
      district: toCamelCase(district),
      state: toCamelCase(state),
    });

    await newDistrictState.save()
    return res.status(200).json({ success: true, message: "District and State Created Successfully." });

  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "server error in adding district and State" });
  }
};

const getDistrictStates = async (req, res) => {
  try {
    const districtStates = await DistrictState.find().sort({ state: 1, district: 1 });

    const counts = await Student.aggregate([
      {
        $group: {
          _id: '$districtStateId',
          count: { $sum: 1 },
        },
      },
    ]);

    if (districtStates.length > 0 && counts.length > 0) {
      for (const count of counts) {
        districtStates.map(districtState => {
          if (districtState?._id?.toString() == count?._id?.toString()) {
            districtState._studentsCount = count.count;
            districtState.toObject({ virtuals: true });
          };
        });
      }
    }

    return res.status(200).json({ success: true, districtStates });
  } catch (error) {
    console.log(error)
    return res
      .status(500)
      .json({ success: false, error: "get district and States server error" });
  }
};

const getDistrictStatesFromCache = async (req, res) => {
  try {
    const districtStates = JSON.parse(await redisClient.get('districtStates'));
    return res.status(200).json({ success: true, districtStates });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get district and States server error" });
  }
};

const getDistrictState = async (req, res) => {
  const { id } = req.params;
  try {
    let districtState = await DistrictState.findById({ _id: id });
    return res.status(200).json({ success: true, districtState });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get district and State server error" });
  }
};

const updateDistrictState = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      district,
      state, } = req.body;

    const districtState = await DistrictState.findById({ _id: id });
    if (!districtState) {
      return res
        .status(404)
        .json({ success: false, error: "DistrictState not found." });
    }

    const updateDistrictState = await DistrictState.findByIdAndUpdate({ _id: id }, {
      district: toCamelCase(district),
      state: toCamelCase(state),
    })

    if (!updateDistrictState) {
      return res
        .status(404)
        .json({ success: false, error: "document not found" });
    }

    return res.status(200).json({ success: true, message: "DistrictState details updated Successfully." })

  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "update districtStates server error" });
  }
};

const deleteDistrictState = async (req, res) => {
  try {
    const { id } = req.params;
    await DistrictState.findByIdAndDelete({ _id: id })
    return res.status(200).json({ success: true, message: "deleteDistrictState" })
  } catch (error) {
    return res.status(500).json({ success: false, error: "delete DistrictState server error" })
  }
}

export { addDistrictState, getDistrictStates, getDistrictState, updateDistrictState, deleteDistrictState, getDistrictStatesFromCache };
