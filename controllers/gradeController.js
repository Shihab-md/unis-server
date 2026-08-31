import Grade from "../models/Grade.js";
import getRedis from "../db/redis.js";

const clean = (value) => (value === undefined || value === null ? "" : String(value).trim());
const escapeRegExp = (value) => clean(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toPercentage = (value, fieldName) => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0 || numberValue > 100) {
    throw new Error(`${fieldName} must be between 0 and 100.`);
  }
  return Number(numberValue.toFixed(2));
};

const toDisplayOrder = (value) => {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 1 || numberValue > 999) {
    throw new Error("Display Order must be a whole number between 1 and 999.");
  }
  return numberValue;
};

const normalizePayload = (body = {}) => {
  const grade = clean(body.grade).toUpperCase();
  if (!grade) throw new Error("Grade is required.");
  if (grade.length > 20) throw new Error("Grade cannot exceed 20 characters.");

  const active = clean(body.active || "Active");
  if (!["Active", "In-Active"].includes(active)) throw new Error("Invalid Grade status.");

  return {
    grade,
    minMarkPercentage: toPercentage(body.minMarkPercentage, "Minimum Mark Percentage"),
    minAttendancePercentage: toPercentage(body.minAttendancePercentage, "Minimum Attendance Percentage"),
    conduct: clean(body.conduct).slice(0, 80),
    displayOrder: toDisplayOrder(body.displayOrder),
    active,
    remarks: clean(body.remarks).slice(0, 250),
    updatedAt: new Date(),
  };
};

const refreshGradeCache = async () => {
  try {
    const redis = await getRedis();
    const grades = await Grade.find()
      .sort({ displayOrder: 1, minMarkPercentage: -1, minAttendancePercentage: -1, grade: 1 })
      .lean();
    await Promise.all([
      redis.set("totalGrades", String(grades.length), { EX: 60 }),
      redis.set("grades", JSON.stringify(grades), { EX: 60 * 30 }),
    ]);
  } catch (error) {
    console.log("[grade] cache refresh skipped:", error?.message || error);
  }
};

export const getGrades = async (req, res) => {
  try {
    const grades = await Grade.find()
      .sort({ displayOrder: 1, minMarkPercentage: -1, minAttendancePercentage: -1, grade: 1 })
      .lean();
    return res.status(200).json({ success: true, grades });
  } catch (error) {
    console.log("[grade] getGrades", error);
    return res.status(500).json({ success: false, error: "Get Grades server error." });
  }
};

export const getGradesFromCache = async (req, res) => {
  try {
    const redis = await getRedis();
    let grades = [];
    try {
      const cached = await redis.get("grades");
      grades = cached ? JSON.parse(cached) : [];
    } catch {
      grades = [];
    }

    grades = Array.isArray(grades)
      ? grades.filter((grade) => clean(grade?.active || "Active") === "Active")
      : [];

    if (grades.length === 0) {
      grades = await Grade.find({ active: "Active" })
        .sort({ displayOrder: 1, minMarkPercentage: -1, minAttendancePercentage: -1, grade: 1 })
        .lean();
      try {
        await redis.set("grades", JSON.stringify(grades), { EX: 60 * 30 });
      } catch {
        // Best-effort cache only.
      }
    }

    return res.status(200).json({ success: true, grades });
  } catch (error) {
    console.log("[grade] getGradesFromCache", error);
    return res.status(500).json({ success: false, error: "Get Grades server error." });
  }
};

export const getGrade = async (req, res) => {
  try {
    const grade = await Grade.findById(req.params.id).lean();
    if (!grade) return res.status(404).json({ success: false, error: "Grade not found." });
    return res.status(200).json({ success: true, grade });
  } catch (error) {
    if (String(error?.name || "") === "CastError") {
      return res.status(400).json({ success: false, error: "Invalid Grade id." });
    }
    console.log("[grade] getGrade", error);
    return res.status(500).json({ success: false, error: "Get Grade server error." });
  }
};

export const addGrade = async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    const duplicate = await Grade.findOne({ grade: { $regex: `^${escapeRegExp(payload.grade)}$`, $options: "i" } })
      .select("_id")
      .lean();
    if (duplicate) return res.status(400).json({ success: false, error: "Grade already exists." });

    const grade = await Grade.create({ ...payload, createdAt: new Date() });
    await refreshGradeCache();
    return res.status(200).json({ success: true, message: "Grade Created Successfully.", grade });
  } catch (error) {
    if (error?.code === 11000) return res.status(400).json({ success: false, error: "Grade already exists." });
    console.log("[grade] addGrade", error);
    return res.status(400).json({ success: false, error: error.message || "Add Grade failed." });
  }
};

export const updateGrade = async (req, res) => {
  try {
    const existing = await Grade.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ success: false, error: "Grade not found." });

    const payload = normalizePayload(req.body);
    const duplicate = await Grade.findOne({
      _id: { $ne: existing._id },
      grade: { $regex: `^${escapeRegExp(payload.grade)}$`, $options: "i" },
    })
      .select("_id")
      .lean();
    if (duplicate) return res.status(400).json({ success: false, error: "Grade already exists." });

    const grade = await Grade.findByIdAndUpdate(req.params.id, { $set: payload }, { new: true, runValidators: true }).lean();
    await refreshGradeCache();
    return res.status(200).json({ success: true, message: "Grade Updated Successfully.", grade });
  } catch (error) {
    if (String(error?.name || "") === "CastError") {
      return res.status(400).json({ success: false, error: "Invalid Grade id." });
    }
    if (error?.code === 11000) return res.status(400).json({ success: false, error: "Grade already exists." });
    console.log("[grade] updateGrade", error);
    return res.status(400).json({ success: false, error: error.message || "Update Grade failed." });
  }
};

export const deleteGrade = async (req, res) => {
  try {
    const grade = await Grade.findByIdAndDelete(req.params.id).lean();
    if (!grade) return res.status(404).json({ success: false, error: "Grade not found." });
    await refreshGradeCache();
    return res.status(200).json({ success: true, message: "Grade Deleted Successfully." });
  } catch (error) {
    if (String(error?.name || "") === "CastError") {
      return res.status(400).json({ success: false, error: "Invalid Grade id." });
    }
    console.log("[grade] deleteGrade", error);
    return res.status(500).json({ success: false, error: "Delete Grade server error." });
  }
};
