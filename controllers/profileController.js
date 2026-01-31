import jwt from "jsonwebtoken";
import multer from "multer";
import { put } from "@vercel/blob";
import Supervisor from "../models/Supervisor.js";
import Employee from "../models/Employee.js";
import User from "../models/User.js";
import School from "../models/School.js";
import bcrypt from "bcrypt";
import getRedis from "../db/redis.js"
import { toCamelCase } from "./commonController.js";

// Same rule as frontend: 8–64 chars, 1 upper, 1 lower, 1 number, 1 special, no spaces
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s])\S{8,64}$/;

const validateNewPassword = (pw) => {
  if (!pw) return "New password is required";
  if (typeof pw !== "string") return "New password must be a string";
  if (pw.length < 8) return "Password must be at least 8 characters";
  if (pw.length > 64) return "Password must be at most 64 characters";
  if (/\s/.test(pw)) return "Password must not contain spaces";
  if (!PASSWORD_REGEX.test(pw))
    return "Password must include uppercase, lowercase, number, and special character";
  return "";
};

const upload = multer({ storage: multer.memoryStorage() });

function getAuthPayload(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return jwt.verify(token, process.env.JWT_SECRET);
}

const getProfile = async (req, res) => {
  try {
    const payload = getAuthPayload(req);
    const role = payload.role;
    const userId = payload.id || payload._id || payload.userId;

    let profileData = null;
    let user = null;
    if (role === "superadmin" || role === "hquser" || role === "admin" || role === "usthadh" || role === "warden" || role === "teacher") {
      profileData = await Employee.findOne({ userId: userId })
        .select("_id employeeId contactNumber address designation qualification dob gender maritalStatus doj active")
        .populate({ path: "userId", select: "name email role profileImage" })
        .lean();
    }
    if (role === "supervisor") {
      profileData = await Supervisor.findOne({ userId: userId })
        .select("_id supervisorId address contactNumber routeName designation qualification dob gender maritalStatus doj active jobType")
        .populate({ path: "userId", select: "name email role profileImage" })
        .lean();
    }
    if (role === "superadmin" && profileData == null) {
      user = await User.findById(userId).select("name email role profileImage").lean();
    }

    const isSuperadminNoProfile = role === "superadmin" && profileData == null;
    const userPayload = isSuperadminNoProfile
      ? {
        _id: user?._id,
        name: user?.name,
        email: user?.email,
        role: user?.role,
        profileImage: user?.profileImage,
      }
      : {
        _id: profileData?.userId?._id,
        name: profileData?.userId?.name,
        email: profileData?.userId?.email,
        role: profileData?.userId?.role,
        profileImage: profileData?.userId?.profileImage,
      };

    const employeePayload = isSuperadminNoProfile
      ? null
      : {
        _id: profileData?._id,
        employeeId: profileData?.employeeId ? profileData.employeeId : profileData?.supervisorId,
        contactNumber: profileData?.contactNumber,
        address: profileData?.address,
        designation: profileData?.designation,
        qualification: profileData?.qualification,
        dob: profileData?.dob,
        gender: profileData?.gender,
        maritalStatus: profileData?.maritalStatus,
        doj: profileData?.doj,
        active: profileData?.active,
      };

    return res.json({
      success: true,
      user: userPayload,
      employee: employeePayload,
    });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "get Profile server error" });
  }
};

const updatePassword = async (req, res) => {
  try {
    const payload = getAuthPayload(req);
    const userId = payload.id || payload._id || payload.userId;
    const { oldPassword, newPassword } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, error: "userId is required" });
    }
    if (!oldPassword) {
      return res.status(400).json({ success: false, error: "Old password is required" });
    }

    const pwErr = validateNewPassword(newPassword);
    if (pwErr) {
      return res.status(400).json({ success: false, error: pwErr });
    }

    // Fetch only password (smaller payload)
    const user = await User.findById(userId).select("password");
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    // Check old password
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      // 401 is more correct than 404 here
      return res.status(401).json({ success: false, error: "Wrong old password" });
    }

    // Optional: prevent setting same password again
    const isSameAsOld = await bcrypt.compare(newPassword, user.password);
    if (isSameAsOld) {
      return res.status(400).json({
        success: false,
        error: "New password must be different from old password",
      });
    }

    // Hash and save
    const hashPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashPassword;
    await user.save();

    return res.status(200).json({ success: true, message: "Password update done" });
  } catch (error) {
    console.log("[changePassword] error:", error);
    return res.status(500).json({ success: false, error: "setting error" });
  }
};

export { upload, getProfile, updatePassword };
