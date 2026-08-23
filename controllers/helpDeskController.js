import mongoose from "mongoose";

import HelpDeskQuery from "../models/HelpDeskQuery.js";
import User from "../models/User.js";
import Employee from "../models/Employee.js";
import Student from "../models/Student.js";
import Supervisor from "../models/Supervisor.js";
import School from "../models/School.js";

const CATEGORIES = new Set([
  "General",
  "Student",
  "Employee",
  "Fees / Invoice / Payment",
  "Certificate",
  "Report",
  "Account",
  "Login / Access",
  "Mobile App",
  "Bug / Issue",
  "Suggestion",
  "Other",
]);

const PRIORITIES = new Set(["Low", "Normal", "High", "Urgent"]);
const STATUSES = new Set(["Open", "In Progress", "Answered", "Closed"]);
const ROLE_FILTERS = new Set([
  "hquser",
  "supervisor",
  "admin",
  "employee",
  "teacher",
  "usthadh",
  "warden",
  "staff",
  "student",
  "parent",
  "guest",
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

const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cleanText = (value = "", max = 2500) => String(value || "").trim().slice(0, max);
const isSuperAdmin = (req) => String(req.user?.role || "").toLowerCase() === "superadmin";

const isTruthyQueryValue = (value) => {
  const text = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "on", "unread"].includes(text);
};

const parseDateBoundary = (value, boundary) => {
  const text = cleanText(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;

  const suffix = boundary === "end" ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const date = new Date(`${text}${suffix}`);

  return Number.isNaN(date.getTime()) ? null : date;
};

const safeObjectId = (value) => {
  const text = String(value || "").trim();
  return mongoose.Types.ObjectId.isValid(text) ? text : null;
};

const sameId = (a, b) => String(a || "") === String(b || "");

const isUnreadForUser = (query, user) => {
  const role = String(user?.role || "").toLowerCase();
  const lastMessageAt = query?.lastMessageAt ? new Date(query.lastMessageAt).getTime() : 0;

  if (!lastMessageAt) return false;

  if (role === "superadmin") {
    const readAt = query?.readBySuperadminAt ? new Date(query.readBySuperadminAt).getTime() : 0;
    return !sameId(query?.lastMessageBy, user?._id) && String(query?.lastMessageByRole || "") !== "superadmin" && lastMessageAt > readAt;
  }

  const readAt = query?.readByUserAt ? new Date(query.readByUserAt).getTime() : 0;
  return !sameId(query?.lastMessageBy, user?._id) && lastMessageAt > readAt;
};

const decorateQuery = (query, user) => ({
  ...query,
  unreadForCurrentUser: isUnreadForUser(query, user),
  repliesCount: Array.isArray(query?.replies) ? query.replies.length : Number(query?.repliesCount || 0),
});

const getUserSchoolContext = async (user) => {
  const role = String(user?.role || "").toLowerCase();

  if (EMPLOYEE_LINKED_ROLES.has(role)) {
    const employee = await Employee.findOne({ userId: user._id })
      .populate("schoolId", "code nameEnglish")
      .select("schoolId")
      .lean();

    const school = employee?.schoolId;
    if (school?._id) {
      return {
        schoolId: school._id,
        schoolCode: school.code || "",
        schoolName: school.nameEnglish || "",
      };
    }
  }

  if (STUDENT_LINKED_ROLES.has(role)) {
    const student = await Student.findOne({ userId: user._id })
      .populate("schoolId", "code nameEnglish")
      .select("schoolId")
      .lean();

    const school = student?.schoolId;
    if (school?._id) {
      return {
        schoolId: school._id,
        schoolCode: school.code || "",
        schoolName: school.nameEnglish || "",
      };
    }
  }

  if (role === "supervisor") {
    const supervisor = await Supervisor.findOne({ userId: user._id }).select("_id").lean();

    if (supervisor?._id) {
      const school = await School.findOne({ supervisorId: supervisor._id })
        .select("code nameEnglish")
        .sort({ code: 1 })
        .lean();

      if (school?._id) {
        return {
          schoolId: school._id,
          schoolCode: school.code || "",
          schoolName: school.nameEnglish || "",
        };
      }
    }
  }

  return { schoolId: null, schoolCode: "", schoolName: "" };
};

const markReadForViewer = async (query, user) => {
  if (!query?._id || !user?._id) return query;

  const now = new Date();
  const role = String(user?.role || "").toLowerCase();
  const update = role === "superadmin" ? { readBySuperadminAt: now } : { readByUserAt: now };

  const updated = await HelpDeskQuery.findByIdAndUpdate(query._id, { $set: update }, { new: true }).lean();
  return updated || query;
};

const getUnreadFilterClause = (req) => {
  const role = String(req.user?.role || "").toLowerCase();

  if (role === "superadmin") {
    return {
      $and: [
        { lastMessageByRole: { $ne: "superadmin" } },
        { lastMessageBy: { $ne: req.user._id } },
        {
          $or: [
            { readBySuperadminAt: null },
            { readBySuperadminAt: { $exists: false } },
            { $expr: { $gt: ["$lastMessageAt", "$readBySuperadminAt"] } },
          ],
        },
      ],
    };
  }

  return {
    $and: [
      { lastMessageBy: { $ne: req.user._id } },
      {
        $or: [
          { readByUserAt: null },
          { readByUserAt: { $exists: false } },
          { $expr: { $gt: ["$lastMessageAt", "$readByUserAt"] } },
        ],
      },
    ],
  };
};

const buildListFilter = (req) => {
  const filter = { active: true };
  const andClauses = [];
  const superadmin = isSuperAdmin(req);

  if (!superadmin) {
    filter.createdBy = req.user._id;
  }

  const status = cleanText(req.query.status, 40);
  if (status && status !== "All" && STATUSES.has(status)) filter.status = status;

  const category = cleanText(req.query.category, 80);
  if (category && category !== "All" && CATEGORIES.has(category)) filter.category = category;

  const priority = cleanText(req.query.priority, 40);
  if (priority && priority !== "All" && PRIORITIES.has(priority)) filter.priority = priority;

  if (superadmin) {
    const role = cleanText(req.query.role || req.query.createdByRole, 40).toLowerCase();
    if (role && role !== "all" && ROLE_FILTERS.has(role)) {
      filter.createdByRole = new RegExp(`^${escapeRegex(role)}$`, "i");
    }

    const schoolId = safeObjectId(req.query.schoolId || req.query.niswanId);
    if (schoolId) filter.schoolId = schoolId;
  }

  const updatedFrom = parseDateBoundary(req.query.updatedFrom || req.query.dateFrom, "start");
  const updatedTo = parseDateBoundary(req.query.updatedTo || req.query.dateTo, "end");
  if (updatedFrom || updatedTo) {
    filter.lastMessageAt = {};
    if (updatedFrom) filter.lastMessageAt.$gte = updatedFrom;
    if (updatedTo) filter.lastMessageAt.$lte = updatedTo;
  }

  if (isTruthyQueryValue(req.query.unreadOnly)) {
    andClauses.push(getUnreadFilterClause(req));
  }

  const search = cleanText(req.query.search, 120);
  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    andClauses.push({
      $or: [
        { subject: regex },
        { message: regex },
        { createdByName: regex },
        { createdByRole: regex },
        { schoolCode: regex },
        { schoolName: regex },
        { category: regex },
        { priority: regex },
        { status: regex },
      ],
    });
  }

  if (andClauses.length > 0) filter.$and = andClauses;

  return filter;
};

export const listHelpDeskQueries = async (req, res) => {
  try {
    const page = clamp(req.query.page, 1, 100000, 1);
    const limit = clamp(req.query.limit, 1, 50, 20);
    const filter = buildListFilter(req);

    const [queries, total] = await Promise.all([
      HelpDeskQuery.find(filter)
        .select("-replies.message")
        .sort({ lastMessageAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      HelpDeskQuery.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      queries: queries.map((query) => decorateQuery(query, req.user)),
      page,
      limit,
      total,
      hasMore: page * limit < total,
    });
  } catch (error) {
    console.error("[helpdesk] list:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to load Help Desk queries." });
  }
};

export const getHelpDeskUnreadCount = async (req, res) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    const baseFilter = { active: true };

    if (role === "superadmin") {
      baseFilter.lastMessageByRole = { $ne: "superadmin" };
      baseFilter.lastMessageBy = { $ne: req.user._id };
      baseFilter.$or = [
        { readBySuperadminAt: null },
        { $expr: { $gt: ["$lastMessageAt", "$readBySuperadminAt"] } },
      ];
    } else {
      baseFilter.createdBy = req.user._id;
      baseFilter.lastMessageBy = { $ne: req.user._id };
      baseFilter.$or = [
        { readByUserAt: null },
        { $expr: { $gt: ["$lastMessageAt", "$readByUserAt"] } },
      ];
    }

    const unreadCount = await HelpDeskQuery.countDocuments(baseFilter);
    return res.status(200).json({ success: true, unreadCount });
  } catch (error) {
    console.error("[helpdesk] unread count:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to load Help Desk count." });
  }
};

export const createHelpDeskQuery = async (req, res) => {
  try {
    if (isSuperAdmin(req)) {
      return res.status(400).json({ success: false, error: "Superadmin can reply to received queries from the Help Desk list." });
    }

    const subject = cleanText(req.body?.subject, 160);
    const category = cleanText(req.body?.category, 80) || "General";
    const priority = cleanText(req.body?.priority, 40) || "Normal";
    const message = cleanText(req.body?.message, 2500);

    if (!subject) {
      return res.status(400).json({ success: false, error: "Subject is required." });
    }

    if (!message) {
      return res.status(400).json({ success: false, error: "Message is required." });
    }

    if (!CATEGORIES.has(category)) {
      return res.status(400).json({ success: false, error: "Invalid category." });
    }

    if (!PRIORITIES.has(priority)) {
      return res.status(400).json({ success: false, error: "Invalid priority." });
    }

    const now = new Date();
    const schoolContext = await getUserSchoolContext(req.user);

    const query = await HelpDeskQuery.create({
      subject,
      category,
      priority,
      message,
      createdBy: req.user._id,
      createdByName: req.user?.name || "",
      createdByRole: req.user?.role || "",
      ...schoolContext,
      status: "Open",
      lastMessageAt: now,
      lastMessageBy: req.user._id,
      lastMessageByRole: req.user?.role || "",
      readByUserAt: now,
      createdAt: now,
      updatedAt: now,
    });


    return res.status(201).json({ success: true, query: decorateQuery(query.toObject(), req.user) });
  } catch (error) {
    console.error("[helpdesk] create:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to create Help Desk query." });
  }
};

export const getHelpDeskQuery = async (req, res) => {
  try {
    const id = safeObjectId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: "Invalid Help Desk query id." });

    const filter = { _id: id, active: true };
    if (!isSuperAdmin(req)) filter.createdBy = req.user._id;

    const query = await HelpDeskQuery.findOne(filter).lean();
    if (!query) return res.status(404).json({ success: false, error: "Help Desk query not found." });

    const updated = await markReadForViewer(query, req.user);
    return res.status(200).json({ success: true, query: decorateQuery(updated, req.user) });
  } catch (error) {
    console.error("[helpdesk] detail:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to load Help Desk query." });
  }
};

export const replyHelpDeskQuery = async (req, res) => {
  try {
    const id = safeObjectId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: "Invalid Help Desk query id." });

    const message = cleanText(req.body?.message, 2500);
    if (!message) return res.status(400).json({ success: false, error: "Reply message is required." });

    const filter = { _id: id, active: true };
    if (!isSuperAdmin(req)) filter.createdBy = req.user._id;

    const existing = await HelpDeskQuery.findOne(filter).lean();
    if (!existing) return res.status(404).json({ success: false, error: "Help Desk query not found." });

    const now = new Date();
    const reply = {
      message,
      repliedBy: req.user._id,
      repliedByName: req.user?.name || "",
      repliedByRole: req.user?.role || "",
      createdAt: now,
    };

    const role = String(req.user?.role || "").toLowerCase();
    const nextStatus = role === "superadmin" ? "Answered" : "Open";
    const readUpdate = role === "superadmin" ? { readBySuperadminAt: now } : { readByUserAt: now };

    const updated = await HelpDeskQuery.findOneAndUpdate(
      { _id: id, active: true },
      {
        $push: { replies: reply },
        $set: {
          status: nextStatus,
          closedAt: null,
          lastMessageAt: now,
          lastMessageBy: req.user._id,
          lastMessageByRole: req.user?.role || "",
          updatedAt: now,
          ...readUpdate,
        },
      },
      { new: true }
    ).lean();


    return res.status(200).json({ success: true, query: decorateQuery(updated, req.user) });
  } catch (error) {
    console.error("[helpdesk] reply:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to add Help Desk reply." });
  }
};

export const updateHelpDeskStatus = async (req, res) => {
  try {
    if (!isSuperAdmin(req)) {
      return res.status(403).json({ success: false, error: "Only superadmin can update Help Desk status." });
    }

    const id = safeObjectId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: "Invalid Help Desk query id." });

    const status = cleanText(req.body?.status, 40);
    if (!STATUSES.has(status)) return res.status(400).json({ success: false, error: "Invalid Help Desk status." });

    const now = new Date();
    const update = {
      status,
      updatedAt: now,
      ...(status === "Closed" ? { closedAt: now } : { closedAt: null }),
    };

    const query = await HelpDeskQuery.findOneAndUpdate(
      { _id: id, active: true },
      { $set: update },
      { new: true }
    ).lean();

    if (!query) return res.status(404).json({ success: false, error: "Help Desk query not found." });


    return res.status(200).json({ success: true, query: decorateQuery(query, req.user) });
  } catch (error) {
    console.error("[helpdesk] status:", error?.message || error);
    return res.status(500).json({ success: false, error: "Unable to update Help Desk status." });
  }
};
