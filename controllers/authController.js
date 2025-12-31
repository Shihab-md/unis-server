import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Employee from "../models/Employee.js";
import Student from "../models/Student.js";
import bcrypt from "bcrypt";

const login = async (req, res) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";

    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, error: "Email and password are required." });
    }

    // ✅ If user doesn't exist, we still do a bcrypt compare on a fake hash
    // to reduce timing differences (optional but good).
    const fakeHash =
      "$2b$10$CwTycUXWue0Thq9StjUM0uJ8h1vZ1tcHTTX3e8DqRLVQjaxAg/P6m"; // bcrypt hash for 'password'

    const user = await User.findOne({ email }).select("_id name role password");
    const hashToCheck = user?.password || fakeHash;

    const isMatch = await bcrypt.compare(password, hashToCheck);

    // ✅ Do NOT reveal whether user exists
    if (!user || !isMatch) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid email or password." });
    }

    let schoolId = null;
    let schoolName = null;

    const employeeRoles = new Set([
      "admin",
      "teacher",
      "employee",
      "usthadh",
      "warden",
      "staff",
    ]);
    const studentRoles = new Set(["student", "parent"]);

    if (employeeRoles.has(user.role)) {
      const employee = await Employee.findOne({ userId: user._id })
        .select("schoolId")
        .populate({ path: "schoolId", select: "code nameEnglish district state" })
        .lean();

      if (!employee?.schoolId?._id) {
        return res.status(400).json({
          success: false,
          error: "Your account is not linked to a school. Please contact admin.",
        });
      }

      schoolId = employee.schoolId._id;
      schoolName =
        `${employee.schoolId.code} : ${employee.schoolId.nameEnglish}` +
        (employee.schoolId.district ? `, ${employee.schoolId.district}` : "") +
        (employee.schoolId.state ? `, ${employee.schoolId.state}` : "");
    }

    if (studentRoles.has(user.role)) {
      const student = await Student.findOne({ userId: user._id })
        .select("schoolId")
        .populate({ path: "schoolId", select: "code nameEnglish district state" })
        .lean();

      if (!student?.schoolId?._id) {
        return res.status(400).json({
          success: false,
          error: "Your account is not linked to a school. Please contact admin.",
        });
      }

      schoolId = student.schoolId._id;
      schoolName =
        `${student.schoolId.code} : ${student.schoolId.nameEnglish}` +
        (student.schoolId.district ? `, ${student.schoolId.district}` : "") +
        (student.schoolId.state ? `, ${student.schoolId.state}` : "");
    }

    const token = jwt.sign(
      { _id: user._id, role: user.role, schoolId, schoolName },
      process.env.JWT_SECRET,
      { expiresIn: "10h" }
    );

    return res.status(200).json({
      success: true,
      token,
      user: {
        _id: user._id,
        name: user.name,
        role: user.role,
        schoolId,
        schoolName,
      },
    });
  } catch (error) {
    console.log("[login] error:", error);
    return res
      .status(500)
      .json({ success: false, error: "Server error. Please try again." });
  }
};

const verify = (req, res) => {
  return res.status(200).json({ success: true, user: req.user });
};

export { login, verify };