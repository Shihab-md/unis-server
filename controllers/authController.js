import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Employee from "../models/Employee.js";
import Student from "../models/Student.js";
import Supervisor from "../models/Supervisor.js";
import School from "../models/School.js";
import bcrypt from "bcrypt";

const looksLikeEmail = (v) => typeof v === "string" && v.includes("@");

const login = async (req, res) => {
  try {
    const loginIdRaw = String(req.body?.loginId ?? req.body?.email ?? "").trim();
    const password = String(req.body?.password ?? "");

    // ✅ generic error only
    const invalid = () =>
      res.status(401).json({ success: false, error: "Invalid credentials." });

    if (!loginIdRaw || !password) return invalid();

    // constant-time-ish fallback (prevents user enumeration timing)
    const fakeHash =
      "$2b$10$CwTycUXWue0Thq9StjUM0uJ8h1vZ1tcHTTX3e8DqRLVQjaxAg/P6m"; // 'password'

    let user = null;
    let employee = null;
    let supervisor = null;

    // 1) Email login
    if (looksLikeEmail(loginIdRaw)) {
      //const email = loginIdRaw.toLowerCase();
      //user = await User.findOne({ email }).select("_id name role password").lean();
      const email = loginIdRaw.toLowerCase();

      // ✅ get user by email first
      user = await User.findOne({ email }).select("_id name role password").lean();

      if (!user) {
        user = null;
      } else {
        if (user.role === "superadmin") {
        }
        // ✅ restrict by role active status
        if (user.role === "admin" || user.role === "hquser" || user.role === "usthadh" || user.role === "warden" || user.role === "teacher") {
          const emp = await Employee.findOne({ userId: user._id, active: "Active" })
            .select("_id")
            .lean();

          if (!emp) user = null;
        }

        if (user.role === "supervisor") {
          const sup = await Supervisor.findOne({ userId: user._id, active: "Active" })
            .select("_id")
            .lean();

          if (!sup) user = null;
        }
        // ✅ optional: if you have active flag in User schema, also enforce it
        // if (user.active && user.active !== "Active") user = null;
      }
    } else {
      // 2A) employeeId login
      employee = await Employee.findOne({ employeeId: loginIdRaw, active: "Active" })
        .select("userId employeeId schoolId")
        .lean();

      if (employee?.userId) {
        user = await User.findById(employee.userId).select("_id name role password").lean();
      } else {
        // 2B) supervisorId login (NEW)
        supervisor = await Supervisor.findOne({ supervisorId: loginIdRaw, active: "Active" })
          .select("_id supervisorId userId")
          .lean();

        if (supervisor?.userId) {
          user = await User.findById(supervisor.userId).select("_id name role password").lean();
        }
      }
    }

    const hashToCheck = user?.password || fakeHash;
    const isMatch = await bcrypt.compare(password, hashToCheck);

    if (!user || !isMatch) return invalid();

    const role = String(user.role || "").toLowerCase();

    let schoolId = null;
    let schoolName = null;

    // ✅ for supervisor: return schoolIds + schools list
    let schoolIds = [];
    let schools = [];

    const employeeRoles = new Set(["admin", "teacher", "employee", "usthadh", "warden", "staff"]);
    const studentRoles = new Set(["student", "parent"]);

    if (employeeRoles.has(role)) {
      // reuse employee if already fetched via employeeId login
      if (!employee?.schoolId) {
        employee = await Employee.findOne({ userId: user._id }).select("schoolId").lean();
      }

      if (!employee?.schoolId) {
        return res.status(400).json({
          success: false,
          error: "Your account is not linked to a Niswan. Please contact admin.",
        });
      }

      const school = await School.findById(employee.schoolId)
        .select("code nameEnglish district state")
        .lean();

      if (!school?._id) {
        return res.status(400).json({
          success: false,
          error: "Your Niswan record is missing. Please contact admin.",
        });
      }

      schoolId = String(school._id);
      schoolName =
        `${school.code} : ${school.nameEnglish}` +
        (school.district ? `, ${school.district}` : "") +
        (school.state ? `, ${school.state}` : "");
    }

    if (studentRoles.has(role)) {
      const student = await Student.findOne({ userId: user._id }).select("schoolId").lean();

      if (!student?.schoolId) {
        return res.status(400).json({
          success: false,
          error: "Your account is not linked to a Niswan. Please contact admin.",
        });
      }

      const school = await School.findById(student.schoolId)
        .select("code nameEnglish district state")
        .lean();

      if (!school?._id) {
        return res.status(400).json({
          success: false,
          error: "Your Niswan record is missing. Please contact admin.",
        });
      }

      schoolId = String(school._id);
      schoolName =
        `${school.code} : ${school.nameEnglish}` +
        (school.district ? `, ${school.district}` : "") +
        (school.state ? `, ${school.state}` : "");
    }

    if (role === "supervisor") {
      // reuse supervisor if already fetched via supervisorId login
      if (!supervisor?._id) {
        supervisor = await Supervisor.findOne({ userId: user._id })
          .select("_id supervisorId")
          .lean();
      }

      if (supervisor?._id) {
        const schoolDocs = await School.find({ supervisorId: supervisor._id })
          .select("_id code nameEnglish")
          .sort({ code: 1 })
          .lean();

        schoolIds = schoolDocs.map((s) => String(s._id));
        schools = schoolDocs.map((s) => ({
          _id: String(s._id),
          code: s.code,
          nameEnglish: s.nameEnglish,
        }));
      }
      // ✅ no hard error if supervisor has 0 schools; return empty lists
    }

    // ✅ token payload includes schoolIds for supervisor
    const tokenPayload = { _id: user._id, role, schoolId, schoolName };
    if (role === "supervisor") tokenPayload.schoolIds = schoolIds;

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: "10h" });

    return res.status(200).json({
      success: true,
      token,
      user: {
        _id: user._id,
        name: user.name,
        role,
        schoolId,
        schoolName,
        ...(role === "supervisor" ? { schoolIds, schools } : {}),
      },
    });
  } catch (error) {
    console.log("[login] error:", error?.message || error);
    return res.status(500).json({ success: false, error: "Server error. Please try again." });
  }
};

{/*
const login = async (req, res) => {
  try {
    const loginIdRaw = String(req.body?.loginId ?? req.body?.email ?? "").trim();
    const password = String(req.body?.password ?? "");

    // ✅ generic error only
    const invalid = () => res.status(401).json({ success: false, error: "Invalid credentials." });

    if (!loginIdRaw || !password) return invalid();

    // constant-time-ish fallback (prevents user enumeration timing)
    const fakeHash =
      "$2b$10$CwTycUXWue0Thq9StjUM0uJ8h1vZ1tcHTTX3e8DqRLVQjaxAg/P6m"; // 'password'

    let user = null;
    let employee = null;

    // 1) Email login
    if (looksLikeEmail(loginIdRaw)) {
      const email = loginIdRaw.toLowerCase();
      user = await User.findOne({ email }).select("_id name role password").lean();
    } else {
      // 2) employeeId login
      employee = await Employee.findOne({ employeeId: loginIdRaw })
        .select("userId employeeId schoolId")
        .lean();

      if (employee?.userId) {
        user = await User.findById(employee.userId).select("_id name role password").lean();
      }
    }

    const hashToCheck = user?.password || fakeHash;
    const isMatch = await bcrypt.compare(password, hashToCheck);

    if (!user || !isMatch) return invalid();

    const role = String(user.role || "").toLowerCase();

    let schoolId = null;
    let schoolName = null;

    // ✅ for supervisor: return schoolIds + schools list
    let schoolIds = [];
    let schools = [];

    const employeeRoles = new Set(["admin", "teacher", "employee", "usthadh", "warden", "staff"]);
    const studentRoles = new Set(["student", "parent"]);

    if (employeeRoles.has(role)) {
      // reuse employee if already fetched via employeeId login
      if (!employee?.schoolId) {
        employee = await Employee.findOne({ userId: user._id }).select("schoolId").lean();
      }

      if (!employee?.schoolId) {
        return res.status(400).json({
          success: false,
          error: "Your account is not linked to a Niswan. Please contact admin.",
        });
      }

      const school = await School.findById(employee.schoolId)
        .select("code nameEnglish district state")
        .lean();

      if (!school?._id) {
        return res.status(400).json({
          success: false,
          error: "Your Niswan record is missing. Please contact admin.",
        });
      }

      schoolId = String(school._id);
      schoolName =
        `${school.code} : ${school.nameEnglish}` +
        (school.district ? `, ${school.district}` : "") +
        (school.state ? `, ${school.state}` : "");
    }

    if (studentRoles.has(role)) {
      const student = await Student.findOne({ userId: user._id }).select("schoolId").lean();

      if (!student?.schoolId) {
        return res.status(400).json({
          success: false,
          error: "Your account is not linked to a Niswan. Please contact admin.",
        });
      }

      const school = await School.findById(student.schoolId)
        .select("code nameEnglish district state")
        .lean();

      if (!school?._id) {
        return res.status(400).json({
          success: false,
          error: "Your Niswan record is missing. Please contact admin.",
        });
      }

      schoolId = String(school._id);
      schoolName =
        `${school.code} : ${school.nameEnglish}` +
        (school.district ? `, ${school.district}` : "") +
        (school.state ? `, ${school.state}` : "");
    }

    if (role === "supervisor") {
      const sup = await Supervisor.findOne({ userId: user._id }).select("_id").lean();
      if (sup?._id) {
        const schoolDocs = await School.find({ supervisorId: sup._id })
          .select("_id code nameEnglish")
          .sort({ code: 1 })
          .lean();

        schoolIds = schoolDocs.map((s) => String(s._id));
        schools = schoolDocs.map((s) => ({
          _id: String(s._id),
          code: s.code,
          nameEnglish: s.nameEnglish,
        }));
      }
      // not forcing error if supervisor has 0 schools; just return empty list
    }

    // ✅ token payload includes schoolIds for supervisor
    const tokenPayload = { _id: user._id, role, schoolId, schoolName, schoolIds };
    if (role === "supervisor") tokenPayload.schoolIds = schoolIds;

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: "10h" });

    return res.status(200).json({
      success: true,
      token,
      user: {
        _id: user._id,
        name: user.name,
        role,
        schoolId,
        schoolName,
        ...(role === "supervisor" ? { schoolIds, schools } : {}),
      },
    });
  } catch (error) {
    console.log("[login] error:", error?.message || error);
    return res.status(500).json({ success: false, error: "Server error. Please try again." });
  }
};
 */}

const verify = (req, res) => res.status(200).json({ success: true, user: req.user });

export { login, verify };