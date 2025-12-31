import multer from "multer";
import jwt from "jsonwebtoken";
import { put } from "@vercel/blob";
import mongoose from "mongoose";
import Employee from "../models/Employee.js";
import User from "../models/User.js";
import School from "../models/School.js";
import bcrypt from "bcrypt";
import getRedis from "../db/redis.js"
import { toCamelCase } from "./commonController.js";

const upload = multer({ storage: multer.memoryStorage() });

const NL = "\n";

const isNonEmpty = (v) =>
  v !== undefined && v !== null && String(v).trim().length > 0;

const safeStr = (v) => (v === undefined || v === null ? "" : String(v).trim());

const safeStrNum = (v) => (v === undefined || v === null || v === 0 ? 0 : String(v).trim());

const isObjectIdLike = (v) => /^[a-fA-F0-9]{24}$/.test(String(v || "").trim());

const excelSerialToDate = (serial) => {
  const ms = Math.round((Number(serial) - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Accept dd/mm/yyyy OR yyyy-mm-dd OR Excel serial number
const parseDateFlexible = (raw) => {
  if (raw === undefined || raw === null || raw === "") return null;

  if (typeof raw === "number") return excelSerialToDate(raw);

  const s = String(raw).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return excelSerialToDate(Number(s));

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split("/");
    const day = parseInt(dd, 10);
    const month = parseInt(mm, 10) - 1;
    const year = parseInt(yyyy, 10);
    const d = new Date(year, month, day);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

const addEmployee = async (req, res) => {
  try {
    const {
      name,
      email,
      schoolId,
      employeeId,
      role,
      address,
      contactNumber,
      designation,
      qualification,
      dob,
      gender,
      maritalStatus,
      doj,
      salary,
      password,
    } = req.body;

    const user = await User.findOne({ email: email });
    if (user) {
      return res
        .status(400)
        .json({ success: false, error: "User already registered in emp" });
    }

    const hashPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      name: toCamelCase(name),
      email,
      password: hashPassword,
      role,
      profileImage: "",
    });
    const savedUser = await newUser.save();

    const schoolById = await School.findById({ _id: schoolId });
    if (schoolById == null) {
      return res
        .status(404)
        .json({ success: false, error: "Niswan Not exists" });
    }

    const employee = await Employee.findOne({ employeeId: employeeId });
    if (employee) {
      return res
        .status(400)
        .json({ success: false, error: "Employee Id already found" });
    }

    const newEmployee = new Employee({
      userId: savedUser._id,
      schoolId: schoolById._id,
      employeeId,
      contactNumber,
      address: toCamelCase(address),
      designation: toCamelCase(designation),
      qualification: toCamelCase(qualification),
      dob,
      gender,
      maritalStatus,
      doj,
      salary,
    });

    await newEmployee.save();

    const redis = await getRedis();
    await redis.set("totalEmployees", String(await Employee.countDocuments({ active: "Active" })), { EX: 60 });

    if (req.file) {
      const fileBuffer = req.file.buffer;
      const blob = await put("profiles/" + savedUser._id + ".png", fileBuffer, {
        access: 'public',
        contentType: 'image/png',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        allowOverwrite: true,
      });

      await User.findByIdAndUpdate({ _id: savedUser._id }, { profileImage: blob.downloadUrl });
    }

    return res.status(200).json({ success: true, message: "Employee created" });
  } catch (error) {
    //savedUser.deleteOne();
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "server error in adding employee" });
  }
};

const importEmployeesData = async (req, res) => {
  let successCount = 0;
  let finalResultData = "";

  try {

    console.log("Received...")
    const rows = Array.isArray(req.body)
      ? req.body
      : typeof req.body === "string"
        ? JSON.parse(req.body)
        : [];

    if (!rows || rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Please check the document. Employee data not received.",
      });
    }

    // Prefetch user emails + employeeIds for speed
    const emails = [...new Set(rows.map((r) => safeStr(r.email).toLowerCase()).filter(Boolean))];
    const employeeIds = [...new Set(rows.map((r) => safeStr(r.employeeId)).filter(Boolean))];

    const [existingUsers, existingEmployees] = await Promise.all([
      User.find({ email: { $in: emails } }).select("email").lean(),
      Employee.find({ employeeId: { $in: employeeIds } }).select("employeeId").lean(),
    ]);

    const existingEmailSet = new Set(existingUsers.map((u) => String(u.email)));
    const existingEmpIdSet = new Set(existingEmployees.map((e) => String(e.employeeId)));

    // Prefetch schools by code (if your excel uses codes like UN-13-211)
    const possibleCodes = [...new Set(rows.map((r) => safeStr(r.schoolId)).filter(Boolean))]
      .filter((v) => !isObjectIdLike(v));

    const schoolsByCode = possibleCodes.length
      ? await School.find({ code: { $in: possibleCodes } }).select("_id code").lean()
      : [];

    const schoolCodeMap = new Map(schoolsByCode.map((s) => [String(s.code), s]));

    // Redis optional update
    const redis = await getRedis().catch(() => null);

    let rowNum = 1;

    for (const r of rows) {
      const errors = [];

      const schoolIdRaw = safeStr(r.schoolId);
      const employeeId = safeStr(r.employeeId);
      const name = safeStr(r.name);
      const email = safeStr(r.email).toLowerCase();
      const password = safeStr(r.password);

      const contactNumberRaw = safeStr(r.contactNumber);
      const address = safeStr(r.address);
      const role = safeStr(r.role).toLowerCase();
      const qualification = safeStr(r.qualification);

      const dob = parseDateFlexible(r.dob);
      const gender = safeStr(r.gender) || "Female";
      const maritalStatus = safeStr(r.maritalStatus) || "Single";
      const doj = parseDateFlexible(r.doj);

      const salary = Number(safeStr(r.salary));

      // Required fields
      if (!isNonEmpty(schoolIdRaw)) errors.push("schoolId is missing");
      if (!isNonEmpty(employeeId)) errors.push("employeeId is missing");
      if (!isNonEmpty(name)) errors.push("name is missing");
      if (!isNonEmpty(email)) errors.push("email is missing");
      if (!isNonEmpty(password)) errors.push("password is missing");
      if (!isNonEmpty(contactNumberRaw)) errors.push("contactNumber is missing");
      if (!isNonEmpty(address)) errors.push("address is missing");
      if (!isNonEmpty(role)) errors.push("role is missing");
      if (!Number.isFinite(salary)) errors.push("salary is invalid");

      // Only admin import
      if (role !== "admin") errors.push("Only role=admin allowed for this import");

      // existing checks (prefetched)
      if (email && existingEmailSet.has(email)) errors.push(`User already exists for email: ${email}`);
      if (employeeId && existingEmpIdSet.has(employeeId)) errors.push(`Employee already exists for employeeId: ${employeeId}`);

      // resolve schoolId (ObjectId or code)
      let schoolId = null;
      if (isObjectIdLike(schoolIdRaw)) {
        schoolId = schoolIdRaw;
      } else {
        const school = schoolCodeMap.get(schoolIdRaw);
        if (!school?._id) errors.push(`Invalid schoolId/code: ${schoolIdRaw}`);
        else schoolId = String(school._id);
      }

      // validate phone number numeric
      const contactNumberDigits = contactNumberRaw.replace(/\D/g, "");
      if (!contactNumberDigits) errors.push("contactNumber is invalid");

      if (errors.length > 0) {
        finalResultData += `Row : ${rowNum}, ${errors.join(", ")}.${NL}`;
        rowNum++;
        continue;
      }

      // Transaction: create User + Employee together
      const session = await mongoose.startSession();

      try {
        await session.withTransaction(async () => {
          // ✅ Encrypt password from Excel
          const hashPassword = await bcrypt.hash(password, 10);

          const createdUserArr = await User.create(
            [
              {
                name,
                email,
                password: hashPassword,
                role: "admin",
                profileImage: "",
              },
            ],
            { session }
          );

          const userId = createdUserArr[0]._id;

          await Employee.create(
            [
              {
                userId,
                schoolId,
                employeeId,
                contactNumber: Number(contactNumberDigits),
                address,
                designation: "Admin",
                qualification,
                dob,
                gender,
                maritalStatus,
                doj,
                salary,
                active: "Active",
                remarks: "Imported",
              },
            ],
            { session }
          );
        });

        // prevent duplicate within same file
        existingEmailSet.add(email);
        existingEmpIdSet.add(employeeId);

        finalResultData += `Row : ${rowNum}, Imported Successfully! employeeId: ${employeeId}, email: ${email}${NL}`;
        successCount++;
      } catch (e) {
        finalResultData += `Row : ${rowNum}, Import failed: ${e?.message || "Unknown error"}${NL}`;
      } finally {
        await session.endSession();
      }

      rowNum++;
    }

    // optional: refresh totalEmployees cache
    try {
      if (redis) {
        const totalEmployees = await Employee.countDocuments({ active: "Active" });
        await redis.set("totalEmployees", String(totalEmployees), { EX: 60 });
      }
    } catch { }

    return res.status(200).json({
      success: true,
      message: `[${successCount}] Admin employees imported successfully!`,
      finalResultData,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      error: "server error in importing employees",
      finalResultData,
    });
  }
};

const getEmployees = async (req, res) => {
  try {

    const usertoken = req.headers.authorization;
    const token = usertoken.split(' ');
    const decoded = jwt.verify(token[1], process.env.JWT_SECRET);

    //const userId = decoded._id;
    const userRole = decoded.role;
    const schoolId = decoded.schoolId;

    const filter =
      userRole === "superadmin" || userRole === "hquser"
        ? { active: "Active" }
        : { schoolId, active: "Active" };

    const employees = await Employee.find(filter)
      .select("employeeId contactNumber designation active userId schoolId")
      .sort({ employeeId: 1 })
      .populate({ path: "userId", select: "name email role" })
      .populate({ path: "schoolId", select: "code nameEnglish" })
      .lean();

    //console.log(userId + " , " + userRole)
    // let schools = [];
    {/* let employees = [];
    if (userRole == 'superadmin' || userRole == 'hquser') {

      employees = await Employee.find({ active: 'Active' }).sort({ employeeId: 1 })
        .populate({ path: "userId", select: "name email role" })
        .populate({ path: 'schoolId', select: '_id code nameEnglish' }).lean();

    } else {

      employees = await Employee.find({ schoolId: schoolId, active: 'Active' }).sort({ employeeId: 1 })
        .populate({ path: "userId", select: "name email role" })
        .populate({ path: 'schoolId', select: '_id code nameEnglish' }).lean();
    }
*/}

    return res.status(200).json({ success: true, employees });
  } catch (error) {
    console.log(error)
    return res
      .status(500)
      .json({ success: false, error: "get employees server error" });
  }
};

const getByEmpFilter = async (req, res) => {
  const { empSchoolId, empRole, empStatus } = req.params;

  const isValidParam = (v) =>
    v !== undefined &&
    v !== null &&
    v !== "" &&
    v !== "null" &&
    v !== "undefined";

  try {
    // Build base query for Employee
    const query = {};

    if (isValidParam(empSchoolId)) {
      query.schoolId = empSchoolId;
    }

    if (isValidParam(empStatus)) {
      query.active = empStatus;
    }

    // Keep response small (add fields if UI needs more)
    const employeeSelect = "employeeId contactNumber designation active userId schoolId";

    // Query employees and populate userId with a role match (if empRole is present)
    const employees = await Employee.find(query)
      .select(employeeSelect)
      .sort({ employeeId: 1 })
      .populate({
        path: "userId",
        select: "name email role",
        ...(isValidParam(empRole) ? { match: { role: empRole } } : {}),
      })
      .populate({
        path: "schoolId",
        select: "code nameEnglish",
      })
      .lean();

    // If role filter applied, remove non-matching (userId becomes null when match fails)
    const filteredEmployees = isValidParam(empRole)
      ? employees.filter((e) => e.userId) // keep only matched roles
      : employees;

    return res.status(200).json({ success: true, employees: filteredEmployees });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "get employees by FILTER server error" });
  }
};

{/*
const getByEmpFilter = async (req, res) => {

  const { empSchoolId, empRole, empStatus } = req.params;

  console.log("getBy Employee Filter : " + empSchoolId + ", " + empRole + ",  " + empStatus);

  try {

    let filterQuery = Employee.find();

    if (empSchoolId && empSchoolId?.length > 0 && empSchoolId != 'null' && empSchoolId != 'undefined') {

      console.log("empSchoolId Added : " + empSchoolId);
      filterQuery = filterQuery.where('schoolId').eq(empSchoolId);
    }

    if (empRole && empRole?.length > 0 && empRole != 'null' && empRole != 'undefined') {

      console.log("empRole Added : " + empRole);

      const users = await User.find({ role: empRole })
      let userIds = [];
      users.forEach(user => userIds.push(user._id));
      console.log("User Ids : " + userIds)
      filterQuery = filterQuery.where('userId').in(userIds);
    }

    if (empStatus && empStatus?.length > 0 && empStatus != 'null' && empStatus != 'undefined') {

      console.log("empStatus Added : " + empStatus);
      filterQuery = filterQuery.where('active').eq(empStatus);
    }

    filterQuery.sort({ employeeId: 1 });
    filterQuery.populate("userId", { password: 0, profileImage: 0 })
      .populate("schoolId");

    // console.log(filterQuery);

    const employees = await filterQuery.exec();

    console.log("Employees : " + employees?.length)
    return res.status(200).json({ success: true, employees });
  } catch (error) {
    console.log(error)
    return res
      .status(500)
      .json({ success: false, error: "get employees by FILTER server error" });
  }
};
*/}

const getEmployee = async (req, res) => {
  const { id } = req.params;
  try {
    let employee;
    employee = await Employee.findById({ _id: id })
      .populate("userId", { password: 0 })
      .populate("schoolId");

    if (!employee) {
      return res
        .status(400)
        .json({ success: false, error: "Employee data not found." });
    }
    return res.status(200).json({ success: true, employee });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get employees server error" });
  }
};

const updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const { name,
      schoolId,
      employeeId,
      contactNumber,
      address,
      designation,
      qualification,
      dob,
      gender,
      maritalStatus,
      doj,
      salary, role } = req.body;

    const employee = await Employee.findById({ _id: id });
    if (!employee) {
      return res
        .status(404)
        .json({ success: false, error: "employee not found" });
    }

    const employeeByEmpId = await Employee.findOne({ employeeId: employeeId });
    console.log("Emp Id : " + id + "  :  " + employeeId + " : " + employeeByEmpId?._id)
    if (employeeByEmpId && employeeByEmpId?._id != id) {
      return res
        .status(404)
        .json({ success: false, error: "Employee Id already taken (duplicate)" });
    }

    const user = await User.findById({ _id: employee.userId })
    if (!user) {
      return res
        .status(404)
        .json({ success: false, error: "User not found" });
    }

    const school = await School.findById({ _id: schoolId })
    if (!school) {
      return res
        .status(404)
        .json({ success: false, error: "Niswan not found" });
    }

    let updateUser;
    if (req.file) {
      const fileBuffer = req.file.buffer;
      const blob = await put("profiles/" + user._id + ".png", fileBuffer, {
        access: 'public',
        contentType: 'image/png',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        allowOverwrite: true,
      });

      updateUser = await User.findByIdAndUpdate({ _id: employee.userId },
        { name: toCamelCase(name), role: role, profileImage: blob.downloadUrl, })
    } else {
      updateUser = await User.findByIdAndUpdate({ _id: employee.userId },
        { name: toCamelCase(name), role: role, })
    }

    const updateEmployee = await Employee.findByIdAndUpdate({ _id: id }, {
      schoolId: school._id,
      employeeId,
      contactNumber,
      address: toCamelCase(address),
      designation: toCamelCase(designation),
      qualification: toCamelCase(qualification),
      dob,
      gender,
      maritalStatus,
      doj,
      salary,
    })

    if (!updateEmployee || !updateUser) {
      return res
        .status(404)
        .json({ success: false, error: "document not found" });
    }

    return res.status(200).json({ success: true, message: "employee update done" })

  } catch (error) {
    console.error(error)
    return res
      .status(500)
      .json({ success: false, error: "update employees server error" });
  }
};

const deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    //  const deleteEmployee = await Employee.findById({ _id: id })
    // await User.findByIdAndDelete({ _id: deleteEmployee.userId._id })
    // await deleteEmployee.deleteOne()

    const updateEmployee = await Employee.findByIdAndUpdate({ _id: id }, {
      active: "In-Active",
      remarks: "Deleted",
    })

    const redis = await getRedis();
    await redis.set('totalEmployees', String(await Employee.countDocuments({ active: "Active" })), { EX: 60 });

    return res.status(200).json({ success: true, updateEmployee })
  } catch (error) {
    return res.status(500).json({ success: false, error: "delete Employee server error" })
  }
}

{/*const fetchEmployeesByDepId = async (req, res) => {
  const { id } = req.params;
  try {
    const employees = await Employee.find({ department: id })
    return res.status(200).json({ success: true, employees });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get employeesbyDepId server error" });
  }
}*/}

export { addEmployee, upload, getEmployees, getEmployee, updateEmployee, deleteEmployee, getByEmpFilter, importEmployeesData };
