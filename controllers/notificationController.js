import mongoose from "mongoose";

import Notification from "../models/Notification.js";
import NotificationBroadcast from "../models/NotificationBroadcast.js";
import MobilePushToken from "../models/MobilePushToken.js";
import WebPushSubscription from "../models/WebPushSubscription.js";
import User from "../models/User.js";
import Employee from "../models/Employee.js";
import Student from "../models/Student.js";
import School from "../models/School.js";
import Supervisor from "../models/Supervisor.js";
import { createUserNotification, getWebPushReadiness } from "../services/notificationService.js";

const VALID_TARGET_ROLES = new Set([
  "superadmin",
  "hquser",
  "supervisor",
  "admin",
  "employee",
  "teacher",
  "usthadh",
  "student",
  "parent",
  "warden",
  "staff",
]);

const EMPLOYEE_LINKED_ROLES = new Set([
  "hquser",
  "admin",
  "employee",
  "teacher",
  "usthadh",
  "warden",
  "staff",
]);

const STUDENT_LINKED_ROLES = new Set(["student", "parent"]);

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
};

const isSuperAdmin = (req) => String(req.user?.role || "").toLowerCase() === "superadmin";

const normalizeRoles = (roles = []) => {
  const source = Array.isArray(roles) ? roles : [roles];

  return [
    ...new Set(
      source
        .map((role) => String(role || "").trim().toLowerCase())
        .filter((role) => VALID_TARGET_ROLES.has(role))
    ),
  ];
};

const normalizeSchoolIds = (schoolIds = []) => {
  const source = Array.isArray(schoolIds) ? schoolIds : [schoolIds];

  return [
    ...new Set(
      source
        .map((id) => String(id || "").trim())
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ),
  ].map((id) => new mongoose.Types.ObjectId(id));
};

const addIds = (set, ids = []) => {
  ids.forEach((id) => {
    if (id) set.add(String(id));
  });
};

const getTargetNiswansForHistory = async ({ selectAllSchools, selectedSchoolIds }) => {
  if (selectAllSchools) {
    return [
      {
        schoolId: null,
        code: "ALL",
        nameEnglish: "All Niswans",
      },
    ];
  }

  if (!selectedSchoolIds.length) return [];

  const schools = await School.find({ _id: { $in: selectedSchoolIds } })
    .select("code nameEnglish")
    .sort({ code: 1 })
    .lean();

  return schools.map((school) => ({
    schoolId: school._id,
    code: school.code || "",
    nameEnglish: school.nameEnglish || "",
  }));
};

const getTargetUserIds = async ({ targetRoles = [], selectedSchoolIds = [], selectAllSchools = true }) => {
  const roles = normalizeRoles(targetRoles);
  const roleSet = new Set(roles);

  if (roles.length === 0) return [];

  const targetUserIds = new Set();
  const hasSchoolFilter = !selectAllSchools && selectedSchoolIds.length > 0;

  const employeeRoles = roles.filter((role) => EMPLOYEE_LINKED_ROLES.has(role));
  const studentRoles = roles.filter((role) => STUDENT_LINKED_ROLES.has(role));

  if (employeeRoles.length > 0) {
    const employees = await Employee.aggregate([
      {
        $match: {
          active: "Active",
          ...(hasSchoolFilter ? { schoolId: { $in: selectedSchoolIds } } : {}),
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      { $match: { "user.role": { $in: employeeRoles } } },
      { $project: { _id: 0, userId: 1 } },
    ]);

    addIds(targetUserIds, employees.map((item) => item.userId));
  }

  if (studentRoles.length > 0) {
    const students = await Student.aggregate([
      {
        $match: {
          active: "Active",
          ...(hasSchoolFilter ? { schoolId: { $in: selectedSchoolIds } } : {}),
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      { $match: { "user.role": { $in: studentRoles } } },
      { $project: { _id: 0, userId: 1 } },
    ]);

    addIds(targetUserIds, students.map((item) => item.userId));
  }

  if (roleSet.has("supervisor")) {
    let supervisorObjectIds = [];

    if (hasSchoolFilter) {
      const schools = await School.find({ _id: { $in: selectedSchoolIds } })
        .select("supervisorId")
        .lean();

      supervisorObjectIds = [
        ...new Set(
          schools
            .map((school) => school.supervisorId)
            .filter(Boolean)
            .map((id) => String(id))
        ),
      ]
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
    }

    const supervisors = await Supervisor.find({
      active: "Active",
      ...(hasSchoolFilter ? { _id: { $in: supervisorObjectIds } } : {}),
    })
      .select("userId")
      .lean();

    addIds(targetUserIds, supervisors.map((item) => item.userId));
  }

  // Direct global/system roles. hquser/admin/staff-like roles are handled through Employee above.
  const directRoles = roles.filter((role) => role === "superadmin");

  if (directRoles.length > 0) {
    const users = await User.find({ role: { $in: directRoles } })
      .select("_id")
      .lean();

    addIds(targetUserIds, users.map((item) => item._id));
  }

  return [...targetUserIds];
};

export const listNotifications = async (req, res) => {
  try {
    const page = clamp(req.query.page, 1, 100000, 1);
    const limit = clamp(req.query.limit, 1, 50, 20);
    const unreadOnly = String(req.query.unreadOnly || "false").toLowerCase() === "true";
    const filter = { userId: req.user._id, ...(unreadOnly ? { readAt: null } : {}) };

    const [notifications, total, unreadCount, allCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ userId: req.user._id, readAt: null }),
      Notification.countDocuments({ userId: req.user._id }),
    ]);

    return res.status(200).json({
      success: true,
      notifications,
      page,
      limit,
      total,
      allCount,
      unreadCount,
      hasMore: page * limit < total,
    });
  } catch (error) {
    console.error("[notifications] list:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to load notifications." });
  }
};

export const getUnreadCount = async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({ userId: req.user._id, readAt: null });
    return res.status(200).json({ success: true, unreadCount });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Unable to load notification count." });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: { readAt: new Date() } },
      { new: true }
    ).lean();

    if (!notification) {
      return res.status(404).json({ success: false, error: "Notification not found." });
    }

    return res.status(200).json({ success: true, notification });
  } catch (error) {
    if (String(error?.name || "") === "CastError") {
      return res.status(400).json({ success: false, error: "Invalid notification id." });
    }

    return res.status(500).json({ success: false, error: "Unable to update notification." });
  }
};

export const markAllNotificationsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { userId: req.user._id, readAt: null },
      { $set: { readAt: new Date() } }
    );

    return res.status(200).json({ success: true, updated: result.modifiedCount || 0 });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Unable to mark notifications as read." });
  }
};

export const registerMobilePushToken = async (req, res) => {
  try {
    const expoPushToken = String(req.body?.expoPushToken || "").trim();
    const platform = String(req.body?.platform || "").trim().toLowerCase();
    const deviceName = String(req.body?.deviceName || "").trim().slice(0, 160);

    if (!/^ExponentPushToken\[[^\]]+\]$|^ExpoPushToken\[[^\]]+\]$/.test(expoPushToken)) {
      return res.status(400).json({ success: false, error: "Invalid Expo push token." });
    }

    if (!["android", "ios"].includes(platform)) {
      return res.status(400).json({ success: false, error: "Invalid mobile platform." });
    }

    const token = await MobilePushToken.findOneAndUpdate(
      { expoPushToken },
      {
        $set: {
          userId: req.user._id,
          platform,
          deviceName,
          active: true,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { new: true, upsert: true }
    ).lean();

    return res.status(200).json({ success: true, registered: true, tokenId: token._id });
  } catch (error) {
    console.error("[notifications] mobile register:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to register mobile notifications." });
  }
};

export const unregisterMobilePushToken = async (req, res) => {
  try {
    const expoPushToken = String(req.body?.expoPushToken || "").trim();

    if (!expoPushToken) {
      return res.status(400).json({ success: false, error: "Push token is required." });
    }

    await MobilePushToken.updateOne(
      { expoPushToken, userId: req.user._id },
      { $set: { active: false, updatedAt: new Date() } }
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Unable to unregister mobile notifications." });
  }
};

export const getWebPushPublicKey = async (req, res) => {
  const readiness = await getWebPushReadiness();

  return res.status(200).json({
    success: true,
    configured: readiness.configured,
    publicKey: readiness.publicKey,
  });
};

export const registerWebPushSubscription = async (req, res) => {
  try {
    const subscription = req.body?.subscription || req.body;
    const endpoint = String(subscription?.endpoint || "").trim();
    const p256dh = String(subscription?.keys?.p256dh || "").trim();
    const auth = String(subscription?.keys?.auth || "").trim();

    if (!endpoint.startsWith("https://") || !p256dh || !auth) {
      return res.status(400).json({ success: false, error: "Invalid Web Push subscription." });
    }

    const row = await WebPushSubscription.findOneAndUpdate(
      { endpoint },
      {
        $set: {
          userId: req.user._id,
          keys: { p256dh, auth },
          userAgent: String(req.headers["user-agent"] || "").slice(0, 500),
          active: true,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { new: true, upsert: true }
    ).lean();

    return res.status(200).json({ success: true, registered: true, subscriptionId: row._id });
  } catch (error) {
    console.error("[notifications] web subscribe:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to register browser notifications." });
  }
};

export const unregisterWebPushSubscription = async (req, res) => {
  try {
    const endpoint = String(req.body?.endpoint || "").trim();

    if (!endpoint) {
      return res.status(400).json({ success: false, error: "Push endpoint is required." });
    }

    await WebPushSubscription.updateOne(
      { endpoint, userId: req.user._id },
      { $set: { active: false, updatedAt: new Date() } }
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Unable to unregister browser notifications." });
  }
};

export const sendBroadcastNotification = async (req, res) => {
  try {
    if (!isSuperAdmin(req)) {
      return res.status(403).json({
        success: false,
        error: "Only superadmin can send notifications.",
      });
    }

    const title = String(req.body?.title || "").trim();
    const message = String(req.body?.message || "").trim();
    const targetRoles = normalizeRoles(req.body?.targetRoles || []);
    const selectAllSchools = req.body?.selectAllSchools !== false && req.body?.selectAllSchools !== "false";
    const selectedSchoolIds = normalizeSchoolIds(req.body?.schoolIds || []);

    if (!title) {
      return res.status(400).json({ success: false, error: "Notification title is required." });
    }

    if (!message) {
      return res.status(400).json({ success: false, error: "Notification message is required." });
    }

    if (targetRoles.length === 0) {
      return res.status(400).json({ success: false, error: "Please select at least one target role." });
    }

    if (!selectAllSchools && selectedSchoolIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Please select at least one Niswan or choose Select All Niswans.",
      });
    }

    const [targetUserIds, targetNiswans] = await Promise.all([
      getTargetUserIds({ targetRoles, selectedSchoolIds, selectAllSchools }),
      getTargetNiswansForHistory({ selectAllSchools, selectedSchoolIds }),
    ]);

    if (targetUserIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No active users found for the selected targets.",
      });
    }

    const results = await Promise.allSettled(
      targetUserIds.map((userId) =>
        createUserNotification({
          userId,
          type: "manual.broadcast",
          title,
          message,
          resourceType: "System",
          webPath: "/dashboard/notifications",
          mobilePath: "/(app)/notifications",
        })
      )
    );

    const sentCount = results.filter(
      (item) => item.status === "fulfilled" && item.value?._id
    ).length;
    const failedCount = results.length - sentCount;

    const broadcast = await NotificationBroadcast.create({
      title,
      message,
      targetRoles,
      selectAllSchools,
      targetNiswans,
      targetUserCount: targetUserIds.length,
      sentCount,
      failedCount,
      createdBy: req.user._id,
      createdByName: req.user?.name || "",
      createdByRole: req.user?.role || "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return res.status(200).json({
      success: true,
      broadcastId: broadcast._id,
      targetCount: targetUserIds.length,
      sentCount,
      failedCount,
    });
  } catch (error) {
    console.error("[notifications] send broadcast:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to send notification." });
  }
};

export const listBroadcastNotifications = async (req, res) => {
  try {
    if (!isSuperAdmin(req)) {
      return res.status(403).json({
        success: false,
        error: "Only superadmin can view sent notification history.",
      });
    }

    const page = clamp(req.query.page, 1, 100000, 1);
    const limit = clamp(req.query.limit, 1, 50, 30);

    const [broadcasts, total] = await Promise.all([
      NotificationBroadcast.find({})
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      NotificationBroadcast.countDocuments({}),
    ]);

    return res.status(200).json({
      success: true,
      broadcasts,
      page,
      limit,
      total,
      hasMore: page * limit < total,
    });
  } catch (error) {
    console.error("[notifications] sent list:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to load sent notification history." });
  }
};