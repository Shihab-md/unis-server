import multer from "multer";
import Supervisor from "../models/Supervisor.js";
import User from "../models/User.js";
import bcrypt from "bcrypt";
import path from "path";
import Department from "../models/Department.js";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/uploads");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

const addSupervisor = async (req, res) => {
  try {
    const {
      name,
      email,
      supervisorId,
      routeName,
      qualification,
      dob,
      gender,
      maritalStatus,
      doj,
      designation,
      salary,
      password,
      role,
    } = req.body;

    const user = await User.findOne({ email });
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
      role,
      profileImage: req.file ? req.file.filename : "",
    });
    const savedUser = await newUser.save();

    const newSupervisor = new Supervisor({
      userId: savedUser._id,
      supervisorId,
      routeName,
      qualification,
      dob,
      gender,
      maritalStatus,
      designation,
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
      .populate("userId", { password: 0 });
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
      if(!supervisor) {
        supervisor = await Supervisor.findOne({ userId: id })
      .populate("userId", { password: 0 });
      }
    return res.status(200).json({ success: true, supervisor });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get supervisors server error" });
  }
};

const updateSupervisor = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, routeName, qualification, dob, maritalStatus, designation, department, doj, salary } = req.body;

    const supervisor = await Supervisor.findById({ _id: id });
    if (!supervisor) {
      return res
        .status(404)
        .json({ success: false, error: "Supervisor not found." });
    }
    const user = await User.findById({_id: supervisor.userId})

    if (!user) {
        return res
          .status(404)
          .json({ success: false, error: "User not found." });
      }

      const updateUser = await User.findByIdAndUpdate({_id: supervisor.userId}, {name})
      const updateSupervisor = await Supervisor.findByIdAndUpdate({_id: id}, {
        routeName, qualification, dob, maritalStatus,
        designation, doj, salary
      })

      if(!updateSupervisor || !updateUser) {
        return res
          .status(404)
          .json({ success: false, error: "document not found" });
      }

      return res.status(200).json({success: true, message: "Supervisor details updated Successfully."})

  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "update supervisors server error" });
  }
};

const fetchSupervisorsByDepId = async (req, res) => {
  const { id } = req.params;
  try {
    const supervisors = await Supervisor.find({ department: id })
    return res.status(200).json({ success: true, supervisors });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get supervisorsbyDepId server error" });
  }
}

export { addSupervisor, upload, getSupervisors, getSupervisor, updateSupervisor, fetchSupervisorsByDepId };
