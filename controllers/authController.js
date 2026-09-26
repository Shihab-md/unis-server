import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

import User from "../models/User.js";
import Employee from "../models/Employee.js";
import Student from "../models/Student.js";
import Supervisor from "../models/Supervisor.js";
import School from "../models/School.js";
import { getRolePermissions } from "../services/permissionService.js";

const looksLikeEmail = (v) => typeof v === "string" && v.includes("@");

const getJwtExpiresIn = () => String(process.env.JWT_EXPIRES_IN || "3h");

const signAuthToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: getJwtExpiresIn() });

const employeeScopedRoles = new Set([
  "admin",
  "teacher",
  "employee",
  "usthadh",
  "warden",
  "staff",
]);

const employeeActiveCheckRoles = new Set([
  "admin",
  "hquser",
  "usthadh",
  "warden",
  "teacher",
]);

const studentRoles = new Set(["student", "parent"]);

const getScopedSessionForUser = async (user) => {
  const role = String(user?.role || "").toLowerCase();

  let schoolId = null;
  let schoolName = null;
  let schoolIds = [];
  let schools = [];

  if (employeeActiveCheckRoles.has(role)) {
    const activeEmployee = await Employee.findOne({ userId: user._id, active: "Active" })
      .select("_id")
      .lean();

    if (!activeEmployee) {
      return {
        ok: false,
        status: 401,
        error: "Your account is inactive. Please login again.",
      };
    }
  }

  if (role === "supervisor") {
    const activeSupervisor = await Supervisor.findOne({ userId: user._id, active: "Active" })
      .select("_id supervisorId")
      .lean();

    if (!activeSupervisor) {
      return {
        ok: false,
        status: 401,
        error: "Your Muavin account is inactive. Please login again.",
      };
    }

    const schoolDocs = await School.find({ supervisorId: activeSupervisor._id })
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

  if (employeeScopedRoles.has(role)) {
    const employee = await Employee.findOne({ userId: user._id, active: "Active" })
      .select("schoolId")
      .lean();

    if (!employee?.schoolId) {
      return {
        ok: false,
        status: 400,
        error: "Your account is not linked to a Niswan. Please contact admin.",
      };
    }

    const school = await School.findById(employee.schoolId)
      .select("code nameEnglish district state")
      .lean();

    if (!school?._id) {
      return {
        ok: false,
        status: 400,
        error: "Your Niswan record is missing. Please contact admin.",
      };
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
      return {
        ok: false,
        status: 400,
        error: "Your account is not linked to a Niswan. Please contact admin.",
      };
    }

    const school = await School.findById(student.schoolId)
      .select("code nameEnglish district state")
      .lean();

    if (!school?._id) {
      return {
        ok: false,
        status: 400,
        error: "Your Niswan record is missing. Please contact admin.",
      };
    }

    schoolId = String(school._id);
    schoolName =
      `${school.code} : ${school.nameEnglish}` +
      (school.district ? `, ${school.district}` : "") +
      (school.state ? `, ${school.state}` : "");
  }

  const tokenPayload = { _id: user._id, role, schoolId, schoolName };
  if (role === "supervisor") tokenPayload.schoolIds = schoolIds;

  const permissions = await getRolePermissions(role);

  const responseUser = {
    _id: user._id,
    name: user.name,
    role,
    schoolId,
    schoolName,
    permissions,
    preferredLanguage: String(user?.preferredLanguage || "en").toLowerCase(),
    ...(role === "supervisor" ? { schoolIds, schools } : {}),
  };

  return { ok: true, role, schoolId, schoolName, schoolIds, schools, permissions, tokenPayload, user: responseUser };
};

const login = async (req, res) => {
  try {
    const loginIdRaw = String(req.body?.loginId ?? req.body?.email ?? "").trim();
    const password = String(req.body?.password ?? "");

    const invalid = () =>
      res.status(401).json({ success: false, error: "Invalid credentials." });

    if (!loginIdRaw || !password) return invalid();

    const fakeHash =
      "$2b$10$CwTycUXWue0Thq9StjUM0uJ8h1vZ1tcHTTX3e8DqRLVQjaxAg/P6m";

    let user = null;
    let employee = null;
    let supervisor = null;

    if (looksLikeEmail(loginIdRaw)) {
      const email = loginIdRaw.toLowerCase();
      user = await User.findOne({ email }).select("_id name role password preferredLanguage").lean();

      if (user) {
        const role = String(user.role || "").toLowerCase();

        if (employeeActiveCheckRoles.has(role)) {
          const emp = await Employee.findOne({ userId: user._id, active: "Active" })
            .select("_id")
            .lean();

          if (!emp) user = null;
        }

        if (role === "supervisor") {
          const sup = await Supervisor.findOne({ userId: user._id, active: "Active" })
            .select("_id")
            .lean();

          if (!sup) user = null;
        }
      }
    } else {
      employee = await Employee.findOne({ employeeId: loginIdRaw, active: "Active" })
        .select("userId employeeId schoolId")
        .lean();

      if (employee?.userId) {
        user = await User.findById(employee.userId).select("_id name role password preferredLanguage").lean();
      } else {
        supervisor = await Supervisor.findOne({ supervisorId: loginIdRaw, active: "Active" })
          .select("_id supervisorId userId")
          .lean();

        if (supervisor?.userId) {
          user = await User.findById(supervisor.userId).select("_id name role password preferredLanguage").lean();
        }
      }
    }

    const hashToCheck = user?.password || fakeHash;
    const isMatch = await bcrypt.compare(password, hashToCheck);

    if (!user || !isMatch) return invalid();

    const scoped = await getScopedSessionForUser(user);
    if (!scoped.ok) {
      return res.status(scoped.status || 400).json({ success: false, error: scoped.error });
    }

    const token = signAuthToken(scoped.tokenPayload);

    return res.status(200).json({
      success: true,
      token,
      user: scoped.user,
    });
  } catch (error) {
    console.log("[login] error:", error?.message || error);
    return res.status(500).json({ success: false, error: "Server error. Please try again." });
  }
};

const getFreshUserForSession = async (payload) => {
  const userId = payload?._id || payload?.id || payload?.userId;
  if (!userId) return null;
  return User.findById(userId).select("_id name role preferredLanguage").lean();
};

const verify = async (req, res) => {
  try {
    const currentUser = await getFreshUserForSession(req.user);
    if (!currentUser) {
      return res.status(401).json({ success: false, error: "Session expired. Please login again." });
    }

    const scoped = await getScopedSessionForUser(currentUser);
    if (!scoped.ok) {
      return res.status(scoped.status || 401).json({ success: false, error: scoped.error });
    }

    return res.status(200).json({ success: true, user: scoped.user });
  } catch (error) {
    console.log("[verify] error:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to verify session." });
  }
};

const refresh = async (req, res) => {
  try {
    const currentUser = await getFreshUserForSession(req.user);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        code: "SESSION_EXPIRED",
        error: "Session expired. Please login again.",
      });
    }

    const scoped = await getScopedSessionForUser(currentUser);

    if (!scoped.ok) {
      return res.status(401).json({
        success: false,
        code: "SESSION_EXPIRED",
        error: scoped.error || "Session expired. Please login again.",
      });
    }

    const token = signAuthToken(scoped.tokenPayload);

    return res.status(200).json({
      success: true,
      refreshed: true,
      token,
      user: scoped.user,
    });
  } catch (error) {
    console.log("[refresh] error:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to refresh session." });
  }
};

export { login, verify, refresh };
