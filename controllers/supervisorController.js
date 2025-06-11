import multer from "multer";
import Supervisor from "../models/Supervisor.js";
import User from "../models/User.js";
import School from "../models/School.js";
import bcrypt from "bcrypt";
import redisClient from "../db/redis.js"

const upload = multer({});

const addSupervisor = async (req, res) => {
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
      name,
      email,
      password: hashPassword,
      role: "supervisor",
      profileImage: req.file ? req.file.buffer.toString('base64') : "",
    });
    const savedUser = await newUser.save();

    console.log("user created");

    const newSupervisor = new Supervisor({
      userId: savedUser._id,
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
    });

    await newSupervisor.save();
    return res.status(200).json({ success: true, message: "Supervisor Created Successfully." });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "server error in adding supervisor" });
  }
};

const getSupervisors = async (req, res) => {
  try {
    const supervisors = await Supervisor.find()
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

const getSupervisorsFromCache = async (req, res) => {
  try {

    const supervisors = JSON.parse(await redisClient.get('supervisors'));
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
      .populate("userId", { password: 0 });

    if (!supervisor) {
      supervisor = await Supervisor.findOne({ userId: id })
        .populate("userId", { password: 0 });
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
    const { name, contactNumber, address, routeName, gender,
      qualification, dob, maritalStatus, doj, salary } = req.body;

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
      updateUser = await User.findByIdAndUpdate({ _id: supervisor.userId },
        {
          name,
          profileImage: req.file.buffer.toString('base64'),
        })
    } else {
      updateUser = await User.findByIdAndUpdate({ _id: supervisor.userId }, { name, })
    }
    const updateSupervisor = await Supervisor.findByIdAndUpdate({ _id: id }, {
      contactNumber, address, routeName, gender, qualification, dob, maritalStatus,
      doj, salary
    })

    if (!updateSupervisor || !updateUser) {
      return res
        .status(404)
        .json({ success: false, error: "document not found" });
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

    return res.status(200).json({ success: true, updateSupervisor })
  } catch (error) {
    return res.status(500).json({ success: false, error: "delete Supervisor server error" })
  }
}

export { addSupervisor, upload, getSupervisors, getSupervisor, updateSupervisor, deleteSupervisor, getSupervisorsFromCache };
