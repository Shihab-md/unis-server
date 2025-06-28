import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Employee from "../models/Employee.js";
import Student from "../models/Student.js";
import bcrypt from "bcrypt";

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email });
    if (!user) {
      return res.status(404).json({ success: false, error: "User Not Found." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(404).json({ success: false, error: "Please give correct Password." });
    }

    let schoolId, schoolName;

    if (user.role === "admin"
      || user.role === "teacher"
      || user.role === "employee"
      || user.role === "usthadh"
      || user.role === "warden"
      || user.role === "staff") {

      let employee = await Employee.findOne({ userId: user._id })
        .populate({
          path: 'schoolId',
          select: 'code nameEnglish district state'
        });

      schoolId = employee.schoolId._id;
      schoolName = employee.schoolId.code + " : " + employee.schoolId.nameEnglish + ", " + employee.schoolId.district + ", " + employee.schoolId.state;

    } else if (user.role === "student"
      || user.role === "parent") {

      let student = await Student.findOne({ userId: user._id })
        .populate({
          path: 'schoolId',
          select: 'code nameEnglish district state'
        });

      schoolId = student.schoolId._id;
      schoolName = student.schoolId.code + " : " + student.schoolId.nameEnglish + ", " + student.schoolId.district + ", " + student.schoolId.state;
    }

    const token = jwt.sign(
      { _id: user._id, role: user.role, schoolId: schoolId, schoolName: schoolName },
      process.env.JWT_SECRET,
      { expiresIn: "10h" }
    );

    return res
      .status(200)
      .json({
        success: true,
        token,
        user: { _id: user._id, name: user.name, role: user.role, schoolId: schoolId, schoolName: schoolName },
      });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
};

const verify = (req, res) => {
  return res.status(200).json({ success: true, user: req.user })
}

export { login, verify };
