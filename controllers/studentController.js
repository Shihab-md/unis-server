import multer from "multer";
import { put } from "@vercel/blob";
import mongoose from "mongoose";
import Student from "../models/Student.js";
import User from "../models/User.js";
import School from "../models/School.js";
import Academic from "../models/Academic.js";
import Course from "../models/Course.js";
import Template from "../models/Template.js";
import AcademicYear from "../models/AcademicYear.js";
import Account from "../models/Account.js";
import Numbering from "../models/Numbering.js";
import bcrypt from "bcrypt";
import getRedis from "../db/redis.js"
import { toCamelCase } from "./commonController.js";
import * as fs from 'fs';
import * as path from 'path';

const upload = multer({ storage: multer.memoryStorage() });

const addStudent = async (req, res) => {

  let savedUser;
  let savedStudent;
  let savedAcademic;
  let savedAccount;
  try {
    const {
      name,
      schoolId,
      doa,
      dob,
      gender,
      maritalStatus,
      motherTongue,
      bloodGroup,
      idMark1,
      idMark2,
      about,
      fatherName,
      fatherNumber,
      fatherOccupation,
      motherName,
      motherNumber,
      motherOccupation,
      guardianName,
      guardianNumber,
      guardianOccupation,
      guardianRelation,

      address,
      city,
      districtStateId,
      landmark,
      pincode,

      hostel,
      hostelRefNumber,
      hostelFees,
      hostelDiscount,

      acYear,

      instituteId1,
      courseId1,
      refNumber1,
      year1,
      fees1,
      discount1,

      instituteId2,
      courseId2,
      refNumber2,
      year2,
      fees2,
      discount2,

      instituteId3,
      courseId3,
      refNumber3,
      year3,
      fees3,
      discount3,

      instituteId4,
      courseId4,
      refNumber4,
      year4,
      fees4,
      discount4,

      instituteId5,
      courseId5,
      refNumber5,
      year5,
      fees5,
      discount5,

    } = req.body;

    const schoolById = await School.findById({ _id: schoolId });
    if (schoolById == null) {
      return res
        .status(404)
        .json({ success: false, error: "Niswan Not exists" });
    }

    {/*
    let numbering = await Numbering.findOne({ name: "Roll" });
    if (numbering == null) {
      console.log("Numbering not available");
      const newNumbering = new Numbering({
        name: "Roll",
        currentNumber: 0,
      });
      numbering = await newNumbering.save();
    }

    let nextNumber = numbering.currentNumber + 1;
    let schoolCode = schoolById.code;
    const rollNumber = schoolCode.replaceAll("-", "") + String(nextNumber).padStart(7, '0');

    console.log("RollNumber : " + rollNumber)
    await Numbering.findByIdAndUpdate({ _id: numbering._id }, { currentNumber: nextNumber });
 */}

    const numbering = await Numbering.findOneAndUpdate(
      { name: "Roll" },
      { $inc: { currentNumber: 1 } },
      { new: true, upsert: true }
    );

    let schoolCode = schoolById.code;
    const rollNumber = schoolCode.replaceAll("-", "") + String(numbering.currentNumber).padStart(7, '0');

    //  console.log("RollNumber : " + rollNumber)

    const user = await User.findOne({ email: rollNumber });
    if (user) {
      return res
        .status(400)
        .json({ success: false, error: "User already registered in Student" });
    }

    const hashPassword = await bcrypt.hash(rollNumber, 10);

    const newUser = new User({
      name: toCamelCase(name),
      email: rollNumber,
      password: hashPassword,
      role: "student",
      profileImage: "",
    });
    savedUser = await newUser.save();

    let hostelFinalFeesVal = Number(hostelFees ? hostelFees : "0") - Number(hostelDiscount ? hostelDiscount : "0");
    const newStudent = new Student({
      userId: savedUser._id,
      schoolId: schoolById._id,
      rollNumber: rollNumber,
      doa,
      dob,
      gender,
      maritalStatus,
      motherTongue,
      bloodGroup: toCamelCase(bloodGroup),
      idMark1: toCamelCase(idMark1),
      idMark2: toCamelCase(idMark2),
      about: toCamelCase(about),
      fatherName: toCamelCase(fatherName),
      fatherNumber,
      fatherOccupation: toCamelCase(fatherOccupation),
      motherName: toCamelCase(motherName),
      motherNumber,
      motherOccupation: toCamelCase(motherOccupation),
      guardianName: toCamelCase(guardianName),
      guardianNumber,
      guardianOccupation: toCamelCase(guardianOccupation),
      guardianRelation: toCamelCase(guardianRelation),
      address: toCamelCase(address),
      city: toCamelCase(city),
      districtStateId,
      landmark: toCamelCase(landmark),
      pincode,

      feesPaid: 0,

      hostel,
      hostelRefNumber,
      hostelFees,
      hostelDiscount,
      hostelFinalFees: hostelFinalFeesVal,
      active: "Active",
      courses: courseId1
    });

    savedStudent = await newStudent.save();
    if (savedStudent == null) {
      return res
        .status(404)
        .json({ success: false, error: "Error: Student NOT added." });
    }

    const academicYearById = await AcademicYear.findById({ _id: acYear });
    if (academicYearById == null) {
      return res
        .status(404)
        .json({ success: false, error: "Academic Year Not exists" });
    }

    let finalFees1Val = Number(fees1 ? fees1 : "0") - Number(discount1 ? discount1 : "0");
    let finalFees2Val = Number(fees2 ? fees2 : "0") - Number(discount2 ? discount2 : "0");
    let finalFees3Val = Number(fees3 ? fees3 : "0") - Number(discount3 ? discount3 : "0");
    let finalFees4Val = Number(fees4 ? fees4 : "0") - Number(discount4 ? discount4 : "0");
    let finalFees5Val = Number(fees5 ? fees5 : "0") - Number(discount5 ? discount5 : "0");

    const newAcademic = new Academic({
      studentId: savedStudent._id,
      acYear: academicYearById._id,

      instituteId1,
      courseId1,
      refNumber1,
      year1,
      fees1,
      discount1,
      finalFees1: finalFees1Val,
      status1: "Admission",

      instituteId2,
      courseId2,
      refNumber2,
      year2,
      fees2,
      discount2,
      finalFees2: finalFees2Val,
      status2: instituteId2 && courseId2 ? "Admission" : null,

      instituteId3,
      courseId3,
      refNumber3,
      year3,
      fees3,
      discount3,
      finalFees3: finalFees3Val,
      status3: instituteId3 && courseId3 ? "Admission" : null,

      instituteId4,
      courseId4,
      refNumber4,
      year4,
      fees4,
      discount4,
      finalFees4: finalFees4Val,
      status4: instituteId4 && courseId4 ? "Admission" : null,

      instituteId5,
      courseId5,
      refNumber5,
      year5,
      fees5,
      discount5,
      finalFees5: finalFees5Val,
      status5: instituteId5 && courseId5 ? "Admission" : null,
    });

    savedAcademic = await newAcademic.save();

    let totalFees = finalFees1Val + finalFees2Val + finalFees3Val + finalFees4Val + finalFees5Val + hostelFinalFeesVal;

    const newAccount = new Account({
      userId: savedUser._id,
      acYear: academicYearById._id,
      academicId: savedAcademic._id,

      receiptNumber: "Admission",
      type: "fees",
      fees: totalFees,
      paidDate: Date.now(),
      balance: totalFees,
      remarks: "Admission",
    });

    savedAccount = await newAccount.save();

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

    const coursesArray = [courseId1];
    if (courseId2) {
      coursesArray.push(courseId2);
    }
    if (courseId3) {
      coursesArray.push(courseId3);
    }
    if (courseId4) {
      coursesArray.push(courseId4);
    }
    if (courseId5) {
      coursesArray.push(courseId5);
    }
    await Student.findByIdAndUpdate({ _id: savedStudent._id }, { courses: coursesArray });

    const redis = await getRedis();
    await redis.set('totalStudents', await Student.countDocuments());

    return res.status(200).json({ success: true, message: "Student created." });
  } catch (error) {

    if (savedUser != null) {
      await User.findByIdAndDelete({ _id: savedUser._id });
      console.log("User data rollback completed.");
    }

    if (savedStudent != null) {
      const academicList = await Academic.find({ studentId: savedStudent._id })
      academicList.forEach(async academic =>
        await Academic.findByIdAndDelete({ _id: academic._id })
      );
      console.log("Academic data rollback completed.");

      const account = await Account.find({ userId: savedUser._id });
      if (!account) {
        await Account.findByIdAndDelete({ _id: account._id });
        console.log("Account data rollback completed.");
      }
      await Student.findByIdAndDelete({ _id: savedStudent._id });
      console.log("Student data rollback completed.");
    }

    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "server error in adding student" });
  }
};

const importStudentsData = async (req, res) => {
  const NL = "\r\n"; // ✅ Notepad-friendly new line (Windows)

  let successCount = 0;
  let finalResultData = "";

  const DEFAULT_COURSE_ID = "680cf72e79e49fb103ddb97c";
  const INSTITUTE_ID = "67fbba7bcd590bacd4badef0";

  const AC_YEAR_ID = "680485d9361ed06368c57f7c"; // 2024-2025

  const VALID_COURSE_NAMES = new Set(["Muballiga", "Muallama", "Makthab"]);

  const safeStr = (v) => (v === undefined || v === null ? "" : String(v).trim());

  const parseDob = (dobRaw) => {
    const fallback = new Date(2000, 0, 1);
    try {
      const dob = safeStr(dobRaw);
      if (!dob) return fallback;
      const parts = dob.split("/");
      if (parts.length !== 3) return fallback;
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      return Number.isNaN(d.getTime()) ? fallback : d;
    } catch {
      return fallback;
    }
  };

  const parseNumber = (v, def = 0) => {
    const s = safeStr(v);
    if (!s) return def;
    const n = Number(s);
    return Number.isFinite(n) ? n : def;
  };

  // ✅ New template: determine course + year using flags
  const extractCourseYearFromRow = (row) => {
    const mak = parseNumber(row.Makthab, 0) === 1;
    const mua = parseNumber(row.Muallama, 0) === 1;
    const mub = parseNumber(row.Muballiga, 0) === 1;

    const selected = [mak, mua, mub].filter(Boolean).length;
    if (selected === 0) return { error: "Course not selected (Makthab/Muallama/Muballiga should be 1)" };
    if (selected > 1) return { error: "Multiple courses selected. Only one course should be 1 per row." };

    if (mak) {
      const y = parseNumber(row.MakthabYear, 0);
      if (y <= 0) return { error: "MakthabYear not given/invalid" };
      return { courseName: "Makthab", yearCount: y };
    }
    if (mua) {
      const y = parseNumber(row.MuallamaYear, 0);
      if (y <= 0) return { error: "MuallamaYear not given/invalid" };
      return { courseName: "Muallama", yearCount: y };
    }

    const y = parseNumber(row.MuballigaYear, 0);
    if (y <= 0) return { error: "MuballigaYear not given/invalid" };
    return { courseName: "Muballiga", yearCount: y };
  };

  try {
    const studentsDataList = Array.isArray(req.body)
      ? req.body
      : (typeof req.body === "string" ? JSON.parse(req.body) : []);

    if (!studentsDataList || studentsDataList.length <= 0) {
      return res.status(400).json({
        success: false,
        error: "Please check the document. Students data not received.",
      });
    }

    // ---------- Load Redis + courses map ----------
    const redis = await getRedis();

    let courses = [];
    try {
      const coursesCache = await redis.get("courses");
      courses = coursesCache ? JSON.parse(coursesCache) : [];
    } catch {
      courses = [];
    }

    if (!Array.isArray(courses) || courses.length === 0) {
      courses = await Course.find().select("_id name").lean();
    }

    const courseMap = new Map(); // name -> _id
    for (const c of courses) {
      if (c?.name && c?._id) courseMap.set(String(c.name), String(c._id));
    }

    // ---------- Prefetch schools by niswanCode ----------
    const niswanCodes = [...new Set(studentsDataList.map((r) => safeStr(r.niswanCode)).filter(Boolean))];
    const schools = await School.find({ code: { $in: niswanCodes } })
      .select("_id code districtStateId")
      .lean();

    const schoolMap = new Map();
    for (const s of schools) schoolMap.set(String(s.code), s);

    // ---------- Prefetch duplicates by OLD rollNumber (remarks match) ----------
    const oldRollNumbers = [...new Set(studentsDataList.map((r) => safeStr(r.rollNumber)).filter(Boolean))];
    const oldRemarks = oldRollNumbers.map((r) => `Old Roll Number : ${r}`);

    const existingStudents = oldRemarks.length
      ? await Student.find({ remarks: { $in: oldRemarks } }).select("remarks").lean()
      : [];

    const existingOldRemarksSet = new Set(existingStudents.map((s) => String(s.remarks)));

    // ---------- Main loop ----------
    let row = 1;

    for (const studentData of studentsDataList) {
      const errors = [];

      const name = safeStr(studentData.name);
      const oldRollNumber = safeStr(studentData.rollNumber); // ✅ OLD roll number from excel
      const niswanCode = safeStr(studentData.niswanCode);
      const feesVal = safeStr(studentData.fees);

      if (!name) errors.push("Name not given");
      if (!oldRollNumber) errors.push("Old RollNumber not given (rollNumber column)");
      if (!niswanCode) errors.push("NiswanCode not given");

      const school = niswanCode ? schoolMap.get(niswanCode) : null;
      if (!school) errors.push(`NiswanCode not available : ${niswanCode}`);

      // Duplicate check using remarks
      const oldRemark = `Old Roll Number : ${oldRollNumber}`;
      if (oldRollNumber && existingOldRemarksSet.has(oldRemark)) {
        errors.push(`Already imported (old roll found): ${oldRollNumber}`);
      }

      const { courseName, yearCount, error: courseErr } = extractCourseYearFromRow(studentData);
      if (courseErr) errors.push(courseErr);

      if (!feesVal) errors.push("Fees not given");
      if (courseName && !VALID_COURSE_NAMES.has(courseName)) errors.push(`Course not valid: ${courseName}`);

      if (errors.length > 0) {
        finalResultData += `Row : ${row}, ${errors.join(", ")}.${NL}`;
        row++;
        continue;
      }

      const foundCourseId = courseMap.get(courseName);
      if (!foundCourseId) {
        finalResultData += `Row : ${row}, Course not found. Course Name : ${courseName}.${NL}`;
        row++;
        continue;
      }

      const courseId = foundCourseId || DEFAULT_COURSE_ID;

      const fees = parseNumber(feesVal, 0);
      if (fees <= 0) {
        finalResultData += `Row : ${row}, Invalid Fees value: ${feesVal}.${NL}`;
        row++;
        continue;
      }

      // Makthab override
      let finalYearCount = yearCount;
      if (courseName === "Makthab") finalYearCount = 1;

      const session = await mongoose.startSession();

      try {
        await session.withTransaction(async () => {
          // ✅ Generate NEW roll number (atomic sequence)
          const numbering = await Numbering.findOneAndUpdate(
            { name: "Roll" },
            { $inc: { currentNumber: 1 } },
            { new: true, upsert: true, session }
          );

          const schoolCode = String(school.code || "");
          const newRollNumber =
            schoolCode.replaceAll("-", "") +
            String(numbering.currentNumber).padStart(7, "0");

          // Create User (login uses new rollNumber)
          const hashPassword = await bcrypt.hash(newRollNumber, 10);

          const savedUser = await User.create(
            [
              {
                name: toCamelCase(name),
                email: newRollNumber,
                password: hashPassword,
                role: "student",
                profileImage: "",
              },
            ],
            { session }
          );

          const userId = savedUser[0]._id;

          // Create Student (store new rollNumber; keep old in remarks)
          const dobDate = parseDob(studentData.dob);

          const savedStudent = await Student.create(
            [
              {
                userId,
                schoolId: school._id,
                rollNumber: newRollNumber, // ✅ NEW roll number
                doa: new Date(),
                dob: dobDate,
                gender: "Female",
                maritalStatus: "Single",
                idMark1: "-",
                fatherName: safeStr(studentData.fatherName),
                fatherNumber: safeStr(studentData.fatherNumber),
                motherName: safeStr(studentData.motherName),
                motherNumber: safeStr(studentData.motherNumber),
                guardianName: safeStr(studentData.guardianName),
                guardianNumber: safeStr(studentData.guardianNumber),
                guardianRelation: safeStr(studentData.guardianRelation),
                address: safeStr(studentData.address),
                city: safeStr(studentData.city),
                districtStateId: school.districtStateId,
                hostel: "No",
                active: "Active",
                feesPaid: 0,
                courses: [courseId],
                remarks: `Old Roll Number : ${oldRollNumber}`, // ✅ store OLD
              },
            ],
            { session }
          );

          const studentId = savedStudent[0]._id;

          // Create Academics
          let currentAcademicId = null;
          //let lastAccYearId = AC_YEAR_IDS[0];

          //for (let i = 0; i < finalYearCount; i++) {
          //const accYearId = AC_YEAR_ID;
          //let lastAccYearId = accYearId;
          const savedAcademic = await Academic.create(
            [
              {
                studentId,
                acYear: AC_YEAR_ID,
                instituteId1: INSTITUTE_ID,
                courseId1: courseId,
                refNumber1: newRollNumber, // ✅ NEW roll number
                year1: yearCount, //i + 1,
                fees1: fees,
                finalFees1: fees,
                status1: "Admission",
              },
            ],
            { session }
          );

          //if (i === 0) 
          currentAcademicId = savedAcademic[0]._id;
          //}

          // Create Account
          await Account.create(
            [
              {
                userId,
                acYear: AC_YEAR_ID,
                academicId: currentAcademicId,
                receiptNumber: "Admission",
                type: "fees",
                fees: fees,
                paidDate: Date.now(),
                balance: 0,
                remarks: "Admission",
              },
            ],
            { session }
          );
        });

        // mark old roll as imported (avoid duplicates in same file too)
        existingOldRemarksSet.add(`Old Roll Number : ${oldRollNumber}`);

        finalResultData += `Row : ${row}, OldRoll: ${oldRollNumber}, Imported Successfully!${NL}`;
        successCount++;
      } catch (txErr) {
        finalResultData += `Row : ${row}, Import failed: ${txErr?.message || "Unknown error"}${NL}`;
      } finally {
        await session.endSession();
      }

      row++;
    }

    const totalStudents = await Student.countDocuments();
    try {
      await redis.set("totalStudents", String(totalStudents), { EX: 60 });
    } catch {
      await redis.set("totalStudents", String(totalStudents));
    }

    return res.status(200).json({
      success: true,
      message: ` [${successCount}] Students data Imported Successfully!`,
      finalResultData,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      error: "server error in adding student",
      finalResultData,
    });
  }
};

{/*const importStudentsData = async (req, res) => {
  const NL = "\r\n"; // ✅ Windows Notepad-friendly new line

  let successCount = 0;
  let finalResultData = "";

  // ---- Hard-coded IDs (keep yours, but move them to config later) ----
  const DEFAULT_COURSE_ID = "680cf72e79e49fb103ddb97c";
  const INSTITUTE_ID = "67fbba7bcd590bacd4badef0";

  // Year mapping for academic years (yearIndex -> acYearId)
  const AC_YEAR_IDS = [
    "694faa8b849cb7c7714b6c7d", // year 1, 2023-2024
    "680485d9361ed06368c57f7c", // year 2, 2024-2025
    "68612e92eeebf699b9d34a21", // year 3, 2025-2026
  ];

  const VALID_COURSE_NAMES = new Set(["Muballiga", "Muallama", "Makthab"]);

  const isNonEmpty = (v) =>
    v !== undefined && v !== null && String(v).trim().length > 0;

  const safeStr = (v) => (v === undefined || v === null ? "" : String(v).trim());

  const parseDob = (dobRaw) => {
    // expects dd/mm/yyyy; falls back to 01/01/2000
    const fallback = new Date(2000, 0, 1);

    try {
      const dob = safeStr(dobRaw);
      if (!dob) return fallback;

      const parts = dob.split("/");
      if (parts.length !== 3) return fallback;

      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);

      if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return fallback;
      if (year < 1900 || year > 2100) return fallback;

      const d = new Date(year, month, day);
      if (Number.isNaN(d.getTime())) return fallback;
      return d;
    } catch {
      return fallback;
    }
  };

  const parseNumber = (v, def = 0) => {
    const s = safeStr(v);
    if (!s) return def;
    const n = Number(s);
    return Number.isFinite(n) ? n : def;
  };

  // ✅ New template: determine course + year using flags
  const extractCourseYearFromRow = (row) => {
    const mak = parseNumber(row.Makthab, 0) === 1;
    const mua = parseNumber(row.Muallama, 0) === 1;
    const mub = parseNumber(row.Muballiga, 0) === 1;

    const selectedCount = [mak, mua, mub].filter(Boolean).length;

    if (selectedCount === 0) {
      return { error: "Course not selected (Makthab/Muallama/Muballiga should be 1)" };
    }
    if (selectedCount > 1) {
      return { error: "Multiple courses selected. Only one course should be 1 per row." };
    }

    if (mak) {
      const y = parseNumber(row.MakthabYear, 0);
      if (y <= 0) return { error: "MakthabYear not given/invalid" };
      return { courseName: "Makthab", yearCount: y };
    }

    if (mua) {
      const y = parseNumber(row.MuallamaYear, 0);
      if (y <= 0) return { error: "MuallamaYear not given/invalid" };
      return { courseName: "Muallama", yearCount: y };
    }

    // muballiga
    const y = parseNumber(row.MuballigaYear, 0);
    if (y <= 0) return { error: "MuballigaYear not given/invalid" };
    return { courseName: "Muballiga", yearCount: y };
  };

  try {
    // Body may come as JSON string sometimes
    const studentsDataList = Array.isArray(req.body)
      ? req.body
      : (typeof req.body === "string" ? JSON.parse(req.body) : []);

    if (!studentsDataList || studentsDataList.length <= 0) {
      return res.status(400).json({
        success: false,
        error: "Please check the document. Students data not received.",
      });
    }

    // ---------- Load Redis + courses map ----------
    const redis = await getRedis();

    let courses = [];
    try {
      const coursesCache = await redis.get("courses");
      courses = coursesCache ? JSON.parse(coursesCache) : [];
    } catch {
      courses = [];
    }

    // Fallback to DB if Redis missing/empty
    if (!Array.isArray(courses) || courses.length === 0) {
      courses = await Course.find().select("_id name").lean();
    }

    const courseMap = new Map(); // name -> _id
    for (const c of courses) {
      if (c?.name && c?._id) courseMap.set(String(c.name), String(c._id));
    }

    // ---------- Prefetch schools by niswanCode ----------
    const niswanCodes = [...new Set(studentsDataList.map((r) => safeStr(r.niswanCode)).filter(Boolean))];
    const schools = await School.find({ code: { $in: niswanCodes } })
      .select("_id code districtStateId")
      .lean();

    const schoolMap = new Map(); // code -> school doc
    for (const s of schools) schoolMap.set(String(s.code), s);

    // ---------- Prefetch existing users by rollNumber(email) ----------
    const rollNumbers = [...new Set(studentsDataList.map((r) => safeStr(r.rollNumber)).filter(Boolean))];
    const existingUsers = await User.find({ email: { $in: rollNumbers } })
      .select("email")
      .lean();

    const existingEmailSet = new Set(existingUsers.map((u) => String(u.email)));

    // ---------- Main loop ----------
    let row = 1;

    for (const studentData of studentsDataList) {
      const errors = [];

      const name = safeStr(studentData.name);
      const rollNumber = safeStr(studentData.rollNumber);
      const niswanCode = safeStr(studentData.niswanCode);
      const feesVal = safeStr(studentData.fees);

      // Mandatory fields
      if (!name) errors.push("Name not given");
      if (!rollNumber) errors.push("RollNumber not given");
      if (!niswanCode) errors.push("NiswanCode not given");

      // Existing user check (prefetched)
      if (rollNumber && existingEmailSet.has(rollNumber)) {
        errors.push(`User already registered. RollNumber : ${rollNumber}`);
      }

      // School check (prefetched)
      const school = niswanCode ? schoolMap.get(niswanCode) : null;
      if (!school) {
        errors.push(`NiswanCode not available : ${niswanCode}`);
      }

      // ✅ New template: derive course + year
      const { courseName, yearCount, error: courseErr } = extractCourseYearFromRow(studentData);
      if (courseErr) errors.push(courseErr);

      // Fees validation
      if (!isNonEmpty(feesVal)) errors.push("Fees not given");

      if (errors.length > 0) {
        finalResultData += `Row : ${row}, ${errors.join(", ")}.${NL}`;
        row++;
        continue;
      }

      // Course validation
      if (!VALID_COURSE_NAMES.has(courseName)) {
        finalResultData += `Row : ${row}, Course not valid: ${courseName}.${NL}`;
        row++;
        continue;
      }

      // Resolve courseId from cache/db
      let courseId = DEFAULT_COURSE_ID;
      const foundCourseId = courseMap.get(courseName);
      if (!foundCourseId) {
        finalResultData += `Row : ${row}, Course not found. Course Name : ${courseName}.${NL}`;
        row++;
        continue;
      }
      courseId = foundCourseId;

      // Parse fees
      const fees = parseNumber(feesVal, 0);
      if (fees <= 0) {
        finalResultData += `Row : ${row}, Invalid Fees value: ${feesVal}.${NL}`;
        row++;
        continue;
      }

      // Create in a transaction (prevents partial data)
      const session = await mongoose.startSession();

      try {
        await session.withTransaction(async () => {
          // Create User
          const hashPassword = await bcrypt.hash(rollNumber, 10);

          const savedUser = await User.create(
            [
              {
                name: toCamelCase(name),
                email: rollNumber,
                password: hashPassword,
                role: "student",
                profileImage: "",
              },
            ],
            { session }
          );

          const userId = savedUser[0]._id;

          // Create Student
          const dobDate = parseDob(studentData.dob);

          const savedStudent = await Student.create(
            [
              {
                userId,
                schoolId: school._id,
                rollNumber,
                doa: new Date(),
                dob: dobDate,
                gender: "Female",
                maritalStatus: "Single",
                idMark1: "-",
                fatherName: safeStr(studentData.fatherName),
                fatherNumber: safeStr(studentData.fatherNumber),
                motherName: safeStr(studentData.motherName),
                motherNumber: safeStr(studentData.motherNumber),
                guardianName: safeStr(studentData.guardianName),
                guardianNumber: safeStr(studentData.guardianNumber),
                guardianRelation: safeStr(studentData.guardianRelation),
                address: safeStr(studentData.address),
                city: safeStr(studentData.city),
                districtStateId: school.districtStateId,
                hostel: "No",
                active: "Active",
                feesPaid: 0,
                courses: [courseId],
              },
            ],
            { session }
          );

          const studentId = savedStudent[0]._id;

          // Create Academics (one per year)
          let currentAcademicId = null;
          let lastAccYearId = AC_YEAR_IDS[0];

          for (let i = 0; i < yearCount; i++) {
            const accYearId = AC_YEAR_IDS[i] || AC_YEAR_IDS[AC_YEAR_IDS.length - 1];
            lastAccYearId = accYearId;

            const savedAcademic = await Academic.create(
              [
                {
                  studentId,
                  acYear: accYearId,
                  instituteId1: INSTITUTE_ID,
                  courseId1: courseId,
                  refNumber1: rollNumber,
                  year1: i + 1,
                  fees1: fees,
                  finalFees1: fees,
                  status1: "Admission",
                },
              ],
              { session }
            );

            if (i === 0) currentAcademicId = savedAcademic[0]._id;
          }

          // Create Account (for first academic)
          await Account.create(
            [
              {
                userId,
                acYear: lastAccYearId,
                academicId: currentAcademicId,
                receiptNumber: "Admission",
                type: "fees",
                fees: fees,
                paidDate: Date.now(),
                balance: 0,
                remarks: "Admission",
              },
            ],
            { session }
          );
        });

        // Mark rollNumber as existing now (avoid duplicates within same file)
        existingEmailSet.add(rollNumber);

        finalResultData += `Row : ${row}, RollNumber : ${rollNumber}, Imported Successfully!${NL}`;
        successCount++;
      } catch (txErr) {
        finalResultData += `Row : ${row}, Import failed: ${txErr?.message || "Unknown error"}${NL}`;
      } finally {
        await session.endSession();
      }

      row++;
    }

    // Update redis count (with TTL so it refreshes)
    const totalStudents = await Student.countDocuments();
    try {
      await redis.set("totalStudents", String(totalStudents), { EX: 60 });
    } catch {
      await redis.set("totalStudents", String(totalStudents));
    }

    return res.status(200).json({
      success: true,
      message: ` [${successCount}] Students data Imported Successfully!`,
      finalResultData,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      error: "server error in adding student",
      finalResultData,
    });
  }
};*/}

{/*const importStudentsData = async (req, res) => {
  const NL = "\n"; // ✅ Notepad-friendly new line (Windows)

  let successCount = 0;
  let finalResultData = "";

  // ---- Hard-coded IDs (keep yours, but move them to config later) ----
  const DEFAULT_COURSE_ID = "680cf72e79e49fb103ddb97c";
  const INSTITUTE_ID = "67fbba7bcd590bacd4badef0";

  // Year mapping for academic years (yearIndex -> acYearId)
  const AC_YEAR_IDS = [
    "694faa8b849cb7c7714b6c7d", // year 1, 2023-2024
    "680485d9361ed06368c57f7c", // year 2, 2024-2025
    "68612e92eeebf699b9d34a21", // year 3, 2025-2026
  ];

  const VALID_COURSE_NAMES = new Set(["Muballiga", "Muallama", "Makthab"]);

  const isNonEmpty = (v) =>
    v !== undefined && v !== null && String(v).trim().length > 0;

  const safeStr = (v) => (v === undefined || v === null ? "" : String(v).trim());

  const parseDob = (dobRaw) => {
    // expects dd/mm/yyyy; falls back to 01/01/2000
    const fallback = new Date(2000, 0, 1);

    try {
      const dob = safeStr(dobRaw);
      if (!dob) return fallback;

      const parts = dob.split("/");
      if (parts.length !== 3) return fallback;

      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);

      if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return fallback;
      if (year < 1900 || year > 2100) return fallback;

      const d = new Date(year, month, day);
      if (Number.isNaN(d.getTime())) return fallback;
      return d;
    } catch {
      return fallback;
    }
  };

  const parseNumber = (v, def = 0) => {
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : def;
  };

  try {
    // Body may come as JSON string sometimes
    const studentsDataList = Array.isArray(req.body)
      ? req.body
      : (typeof req.body === "string" ? JSON.parse(req.body) : []);

    if (!studentsDataList || studentsDataList.length <= 0) {
      return res.status(400).json({
        success: false,
        error: "Please check the document. Students data not received.",
      });
    }

    // ---------- Load Redis + courses map ----------
    const redis = await getRedis();

    let courses = [];
    try {
      const coursesCache = await redis.get("courses");
      courses = coursesCache ? JSON.parse(coursesCache) : [];
    } catch {
      courses = [];
    }

    // Fallback to DB if Redis missing/empty
    if (!Array.isArray(courses) || courses.length === 0) {
      courses = await Course.find().select("_id name").lean();
    }

    const courseMap = new Map(); // name -> _id
    for (const c of courses) {
      if (c?.name && c?._id) courseMap.set(String(c.name), String(c._id));
    }

    // ---------- Prefetch schools by niswanCode ----------
    const niswanCodes = [...new Set(studentsDataList.map((r) => safeStr(r.niswanCode)).filter(Boolean))];
    const schools = await School.find({ code: { $in: niswanCodes } })
      .select("_id code districtStateId")
      .lean();

    const schoolMap = new Map(); // code -> school doc
    for (const s of schools) schoolMap.set(String(s.code), s);

    // ---------- Prefetch existing users by rollNumber(email) ----------
    const rollNumbers = [...new Set(studentsDataList.map((r) => safeStr(r.rollNumber)).filter(Boolean))];
    const existingUsers = await User.find({ email: { $in: rollNumbers } })
      .select("email")
      .lean();

    const existingEmailSet = new Set(existingUsers.map((u) => String(u.email)));

    // ---------- Main loop ----------
    let row = 1;

    for (const studentData of studentsDataList) {
      const errors = [];

      const name = safeStr(studentData.name);
      const rollNumber = safeStr(studentData.rollNumber);
      const niswanCode = safeStr(studentData.niswanCode);

      const courseName = safeStr(studentData.course);
      const yearVal = safeStr(studentData.year);
      const feesVal = safeStr(studentData.fees);

      // Mandatory fields
      if (!name) errors.push("Name not given");
      if (!rollNumber) errors.push("RollNumber not given");
      if (!niswanCode) errors.push("NiswanCode not given");

      // Existing user check (prefetched)
      if (rollNumber && existingEmailSet.has(rollNumber)) {
        errors.push(`User already registered. RollNumber : ${rollNumber}`);
      }

      // School check (prefetched)
      const school = niswanCode ? schoolMap.get(niswanCode) : null;
      if (!school) {
        errors.push(`NiswanCode not available : ${niswanCode}`);
      }

      // Course validation
      if (isNonEmpty(courseName)) {
        if (!VALID_COURSE_NAMES.has(courseName)) {
          errors.push("Course not valid");
        }
        if (!isNonEmpty(yearVal)) errors.push("Year not given");
        if (!isNonEmpty(feesVal)) errors.push("Fees not given");
      } else {
        // Your current logic: skip if course not present
        errors.push("Course details not given");
      }

      if (errors.length > 0) {
        finalResultData += `Row : ${row}, ${errors.join(", ")}.${NL}`;
        row++;
        continue;
      }

      // Resolve courseId from cache/db
      let courseId = DEFAULT_COURSE_ID;
      const foundCourseId = courseMap.get(courseName);
      if (!foundCourseId) {
        finalResultData += `Row : ${row}, Course not found. Course Name : ${courseName}.${NL}`;
        row++;
        continue;
      }
      courseId = foundCourseId;

      // Parse yearCount and fees
      let yearCount = parseNumber(yearVal, 0);
      if (courseName === "Makthab") yearCount = 1;
      if (yearCount <= 0) {
        finalResultData += `Row : ${row}, Invalid Year value: ${yearVal}.${NL}`;
        row++;
        continue;
      }

      const fees = parseNumber(feesVal, 0);
      if (fees <= 0) {
        finalResultData += `Row : ${row}, Invalid Fees value: ${feesVal}.${NL}`;
        row++;
        continue;
      }

      // Create in a transaction (prevents partial data)
      const session = await mongoose.startSession();

      try {
        await session.withTransaction(async () => {
          // Create User
          const hashPassword = await bcrypt.hash(rollNumber, 10);

          const savedUser = await User.create(
            [
              {
                name: toCamelCase(name),
                email: rollNumber,
                password: hashPassword,
                role: "student",
                profileImage: "",
              },
            ],
            { session }
          );

          const userId = savedUser[0]._id;

          // Create Student
          const dobDate = parseDob(studentData.dob);

          const savedStudent = await Student.create(
            [
              {
                userId,
                schoolId: school._id,
                rollNumber,
                doa: new Date(),
                dob: dobDate,
                gender: "Female",
                maritalStatus: "Single",
                idMark1: "-",
                fatherName: safeStr(studentData.fatherName),
                fatherNumber: safeStr(studentData.fatherNumber),
                motherName: safeStr(studentData.motherName),
                motherNumber: safeStr(studentData.motherNumber),
                guardianName: safeStr(studentData.guardianName),
                guardianNumber: safeStr(studentData.guardianNumber),
                guardianRelation: safeStr(studentData.guardianRelation),
                address: safeStr(studentData.address),
                city: safeStr(studentData.city),
                districtStateId: school.districtStateId,
                hostel: "No",
                active: "Active",
                feesPaid: 0,
                courses: [courseId],
              },
            ],
            { session }
          );

          const studentId = savedStudent[0]._id;

          // Create Academics (one per year)
          let currentAcademicId = null;
          let lastAccYearId = AC_YEAR_IDS[0];

          for (let i = 0; i < yearCount; i++) {
            const accYearId = AC_YEAR_IDS[i] || AC_YEAR_IDS[AC_YEAR_IDS.length - 1];
            lastAccYearId = accYearId;

            const savedAcademic = await Academic.create(
              [
                {
                  studentId,
                  acYear: accYearId,
                  instituteId1: INSTITUTE_ID,
                  courseId1: courseId,
                  refNumber1: rollNumber,
                  year1: i + 1,
                  fees1: fees,
                  finalFees1: fees,
                  status1: "Admission",
                },
              ],
              { session }
            );

            if (i === 0) currentAcademicId = savedAcademic[0]._id;
          }

          // Create Account (for first academic)
          await Account.create(
            [
              {
                userId,
                acYear: lastAccYearId, // keep your current behavior (latest used)
                academicId: currentAcademicId,
                receiptNumber: "Admission",
                type: "fees",
                fees: fees,
                paidDate: Date.now(),
                balance: 0,
                remarks: "Admission",
              },
            ],
            { session }
          );
        });

        // Mark rollNumber as existing now (avoid duplicates within same file)
        existingEmailSet.add(rollNumber);

        finalResultData += `Row : ${row}, RollNumber : ${rollNumber}, Imported Successfully!${NL}`;
        successCount++;
      } catch (txErr) {
        // Transaction rollback happens automatically
        finalResultData += `Row : ${row}, Import failed: ${txErr?.message || "Unknown error"}${NL}`;
      } finally {
        await session.endSession();
      }

      row++;
    }

    // Update redis count (with TTL so it refreshes)
    const totalStudents = await Student.countDocuments();
    try {
      // node-redis supports options
      await redis.set("totalStudents", String(totalStudents), { EX: 60 });
    } catch {
      await redis.set("totalStudents", String(totalStudents));
    }

    return res.status(200).json({
      success: true,
      message: ` [${successCount}] Students data Imported Successfully!`,
      finalResultData,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      error: "server error in adding student",
      finalResultData,
    });
  }
};

{/*
const importStudentsData = async (req, res) => {

  console.log("Import student data - start");

  let successCount = 0;
  let finalResultData = "";
  let savedUser;
  let savedStudent;
  let savedAcademic;
  let savedAccount;
  try {
    const studentsDataList = req.body;

    console.log("Student data import row count : " + studentsDataList.length)
    if (!studentsDataList || studentsDataList.length <= 0) {
      return res
        .status(400)
        .json({ success: false, error: "Please check the document. Students data not received." });
    }

    let row = 1;
    let resultData = "";
    const redis = await getRedis();
    const courses = JSON.parse(await redis.get('courses'));
    for (const studentData of studentsDataList) {
      console.log("Iteration : " + row + " / " + studentsDataList.length);

      // Check Mandatory fields.
      if (!studentData.name || studentData.name === "") {
        resultData += ", Name not given";
      }
      if (!studentData.rollNumber || studentData.rollNumber === "") {
        resultData += ", RollNumber not given";
      }
      if (!studentData.niswanCode || studentData.niswanCode === "") {
        resultData += ", NiswanCode not given";
      }
      //  if (!studentData.dob || studentData.dob === "") {
      //    resultData += ", DOB not given";
      //  }
      //if (!studentData.district || studentData.district === "") {
      //  resultData += ", District not given";
      //}
      if (studentData.course) {
        if (!(studentData.course === "Muballiga" || studentData.course === "Muallama" || studentData.course === "Makthab")) {
          resultData += ", Course not given";
        }
        if (!studentData.year || studentData.year === "") {
          resultData += ", Year not given";
        }
        if (!studentData.fees || studentData.fees === "") {
          resultData += ", Fees not given";
        }
      }

      const user = await User.findOne({ email: studentData.rollNumber });
      if (user) {
        resultData = resultData + ", User already registered. RollNumber : " + studentData.rollNumber;
      }

      const school = await School.findOne({ code: studentData.niswanCode });
      if (school == null) {
        resultData = resultData + ", NiswanCode not available : " + studentData.niswanCode;
      }

      // If any error found, continue to next record.
      if (resultData != "") {
        finalResultData += "\nRow : " + row + resultData + ". \n";
        resultData = "";
        row++;
        console.log("Error found. SO Skipped")
        continue;
      }

      // Create User.
      const hashPassword = await bcrypt.hash(studentData.rollNumber, 10);
      const newUser = new User({
        name: toCamelCase(studentData.name),
        email: studentData.rollNumber,
        password: hashPassword,
        role: "student",
        profileImage: "",
      });

      savedUser = await newUser.save();
      if (!savedUser) {
        finalResultData += "\nRow : " + row + ", Student registration failed. \n";
        resultData = "";
        row++;
        continue;
      }

      //const redis = await getRedis();
      //const courses = JSON.parse(await redis.get('courses'));
      let courseId = "680cf72e79e49fb103ddb97c";
      if (studentData.course) {
        //courseId = courses.filter(course => course.name === studentData.course).map(course => course._id);
        const course = courses.find(c => c.name === studentData.course);
        //console.log("courseId - " + courseId)
        if (!course) {
          finalResultData += "\nRow : " + row + ", Course not found. Course Name : " + studentData.course;
          resultData = "";
          row++;

          if (savedUser != null) {
            await User.findByIdAndDelete({ _id: savedUser._id });
            console.log("User data rollback completed.");
          }

          continue;
        }
        const courseId = course._id;
        const coursesArray = [courseId];

        let parts;
        try {
          parts = studentData.dob && studentData.dob != "" ? studentData.dob.split('/') : "1/1/2000".split('/');
        } catch {
          parts = "1/1/2000".split('/');
        }
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // Subtract 1 for 0-indexed month
        const year = parseInt(parts[2], 10);

        // Create Student data.
        const newStudent = new Student({
          userId: savedUser._id,
          schoolId: school._id,
          rollNumber: studentData.rollNumber,
          doa: new Date(),
          dob: new Date(year, month, day),
          gender: "Female",
          maritalStatus: "Single",
          idMark1: "-",
          fatherName: studentData.fatherName ? studentData.fatherName : "",
          fatherNumber: studentData.fatherNumber ? studentData.fatherNumber : "",
          motherName: studentData.motherName ? studentData.motherName : "",
          motherNumber: studentData.motherNumber ? studentData.motherNumber : "",
          guardianName: studentData.guardianName ? studentData.guardianName : "",
          guardianNumber: studentData.guardianNumber ? studentData.guardianNumber : "",
          guardianRelation: studentData.guardianRelation ? studentData.guardianRelation : "",
          address: studentData.address,
          city: studentData.city,
          districtStateId: school.districtStateId,
          hostel: "No",
          active: studentData.course ? "Active" : "Graduated",
          courses: coursesArray
        });

        savedStudent = await newStudent.save();
        if (!savedStudent) {
          finalResultData += "\nRow : " + row + ", Student registration failed.";
          resultData = "";
          row++;
          continue;
        }

        console.log("Student registered...")
      } else {
        finalResultData += "\nRow : " + row + ", Course details not given.";
        resultData = "";
        row++;

        if (savedUser != null) {
          await User.findByIdAndDelete({ _id: savedUser._id });
          console.log("User data rollback completed.");
        }

        continue;
      }

      const instituteId = "67fbba7bcd590bacd4badef0";

      let yearCount = studentData.year;
      if (studentData.course === "Makthab") {
        yearCount = 1;
      }

      let currentAcademicId;
      // year 1, 2023-2024
      let accYearId = "694faa8b849cb7c7714b6c7d";
      for (let i = 0; i < yearCount; i++) {

        if (i == 1) {
          // year 2, 2024-2025
          accYearId = "680485d9361ed06368c57f7c";
        } if (i == 2) {
          // year 3, 2025-2026
          accYearId = "68612e92eeebf699b9d34a21";
        }

        const newAcademic = new Academic({
          studentId: savedStudent._id,
          acYear: accYearId,

          instituteId1: instituteId,
          courseId1: courseId,
          refNumber1: studentData.rollNumber,
          year1: i + 1,
          fees1: studentData.fees,
          finalFees1: studentData.fees,
          status1: "Admission"
        });

        savedAcademic = await newAcademic.save();
        if (!savedAcademic) {
          finalResultData += "\nRow : " + row + ", Student Academic registration failed. AC year : " + accYearId;
          resultData = "";
          row++;

          if (savedUser != null) {
            await User.findByIdAndDelete({ _id: savedUser._id });
            console.log("User data rollback completed.");
          }

          continue;
        }

        if (i == 0) {
          currentAcademicId = savedAcademic._id;
        }
      }

      console.log("Academic registered...")

      const newAccount = new Account({
        userId: savedUser._id,
        acYear: accYearId,
        academicId: currentAcademicId,

        receiptNumber: "Admission",
        type: "fees",
        fees: studentData.fees,
        paidDate: Date.now(),
        balance: 0,
        remarks: "Admission",
      });

      savedAccount = await newAccount.save();
      if (!savedAccount) {
        finalResultData += "\nRow : " + row + ", Account registration failed. AC year : " + accYearId;
        resultData = "";
        row++;

        if (savedUser != null) {
          await User.findByIdAndDelete({ _id: savedUser._id });
          console.log("User data rollback completed.");
        }

        continue;
      }

      console.log("Account registered...")

      //const coursesArray = [courseId];
      //await Student.findByIdAndUpdate({ _id: savedStudent._id }, { courses: coursesArray });

      finalResultData += "\nRow : " + row + ", RollNumber : " + studentData.rollNumber + ", Imported Successfully!";
      row++;
      successCount++;
      console.log("Success Count : " + successCount);
    }

    //  let tempFilePath = path.join('/tmp', 'Import_data_Result.txt');
    //  fs.writeFileSync(tempFilePath, finalResultData);

    await redis.set('totalStudents', await Student.countDocuments());

    console.log("Import student data - end NORMAL \n" + finalResultData);
    return res.status(200)
      .json({ success: true, message: " [" + successCount + "] Students data Imported Successfully!", finalResultData: finalResultData });

  } catch (error) {
    console.log("Import student data - end ERROR \n" + finalResultData);
    console.log(error);

    if (savedUser != null) {
      await User.findByIdAndDelete({ _id: savedUser._id });
      console.log("User data rollback completed.");
    }

    if (savedStudent != null) {
      const academicList = await Academic.find({ studentId: savedStudent._id })
      academicList.forEach(async academic =>
        await Academic.findByIdAndDelete({ _id: academic._id })
      );
      console.log("Academic data rollback completed.");

      const account = await Account.find({ userId: savedUser._id });
      if (!account) {
        await Account.findByIdAndDelete({ _id: account._id });
        console.log("Account data rollback completed.");
      }
      await Student.findByIdAndDelete({ _id: savedStudent._id });
      console.log("Student data rollback completed.");
    }

    return res
      .status(500)
      .json({ success: false, error: "server error in adding student", finalResultData: finalResultData });
  }
};
*/}

// POST body: { studentIds: ["id1","id2", ...] }
const markFeesPaid = async (req, res) => {
  try {
    const { studentIds } = req.body;

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "studentIds is required (non-empty array)" });
    }

    // Optional: basic ObjectId format check
    const invalid = studentIds.filter((id) => !/^[a-fA-F0-9]{24}$/.test(String(id)));
    if (invalid.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid studentIds: ${invalid.join(", ")}`,
      });
    }

    const result = await Student.updateMany(
      { _id: { $in: studentIds } },
      { $set: { feesPaid: 1 } }
    );

    // result has different shapes depending on mongoose version
    const modified = result?.modifiedCount ?? result?.nModified ?? 0;
    const matched = result?.matchedCount ?? result?.n ?? 0;

    return res.status(200).json({
      success: true,
      message: `Fees marked as paid for ${modified} student(s).`,
      matchedCount: matched,
      modifiedCount: modified,
    });
  } catch (error) {
    console.log("[markFeesPaid] error:", error);
    return res
      .status(500)
      .json({ success: false, error: "server error updating feesPaid" });
  }
};

const getStudents = async (req, res) => {
  try {
    const students = await Student.find()
      .select("rollNumber name dob fatherName fatherNumber motherName motherNumber guardianName guardianRelation guardianNumber course year fees active userId schoolId districtStateId remarks")
      .sort({ rollNumber: 1 })
      .populate({ path: "userId", select: "name email role" })
      .populate({ path: "schoolId", select: "code nameEnglish" })
      .populate({ path: "districtStateId", select: "district state" })
      .lean();

    return res.status(200).json({ success: true, students });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "get students List server error" });
  }
};

{/*
const getStudents = async (req, res) => {
  try {
    console.log("getStudents called : ");

    const students = await Student.find().sort({ 'schoolId.code': 1, rollNumber: 1 })
      .populate("userId", { password: 0, profileImage: 0 })
      .populate("schoolId")
      .populate("districtStateId");
    //  console.log(students);
    return res.status(200).json({ success: true, students });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get students List server error" });
  }
};
*/}

const getStudentsBySchool = async (req, res) => {

  const { schoolId } = req.params;

  console.log("getStudentsBySchool : " + schoolId);
  try {
    const studentSelect =
      "rollNumber name dob fatherName fatherNumber motherName motherNumber guardianName guardianRelation guardianNumber course year fees active userId districtStateId courses feesPaid remarks";

    const studentsList = await Student.find({ schoolId: schoolId })
      .select(studentSelect)
      .sort({ rollNumber: 1 })
      .populate({ path: "userId", select: "name email role" })
      .populate({ path: "districtStateId", select: "district state" })
      .populate({ path: "courses", select: "name type fees years code" })
      .lean();

    const students = studentsList.map((s) => {
      // show only if feesPaid === 1 (or true)
      const isPaid = s.feesPaid === 1 || s.feesPaid === true || s.feesPaid === "1";
      if (!isPaid) {
        const { rollNumber, ...rest } = s;
        return rest;
      }
      return s;
    });

    {/*}  let accYear = (new Date().getFullYear() - 1) + "-" + new Date().getFullYear();
    if (new Date().getMonth() + 1 >= 4) {
      accYear = new Date().getFullYear() + "-" + (new Date().getFullYear() + 1);
    }

    let acadYear = await AcademicYear.findOne({ acYear: accYear });
    if (!acadYear) {
      accYear = (new Date().getFullYear() - 1) + "-" + new Date().getFullYear();
      acadYear = await AcademicYear.findOne({ acYear: accYear });
      if (!acadYear) {
        return res
          .status(404)
          .json({ success: false, error: "Academic Year Not found : " + accYear });
      }
    }

    for (const student of students) {
      const academic = await Academic.findOne({ studentId: student._id, acYear: acadYear._id })
        .populate("courseId1");
      if (academic) {
        student._course = academic.courseId1.name;
        student.toObject({ virtuals: true });
      }
    } */}

    return res.status(200).json({ success: true, students });

  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get students bySchoolId server error" });
  }
};

const getStudentsBySchoolAndTemplate = async (req, res) => {

  const { schoolId, templateId } = req.params;

  console.log("getStudentsBySchoolAndTemplate : " + schoolId + " ,  " + templateId);

  try {

    const template = await Template.findById({ _id: templateId })
      .populate({ path: 'courseId', select: '_id name' });

    if (!template) {
      return res
        .status(404)
        .json({ success: false, error: "Template not found." });
    }
    console.log("OK");

    const academics = await Academic.find({
      $or: [{ 'courseId1': template.courseId, 'status1': 'Completed' },
      { 'courseId2': template.courseId, 'status2': 'Completed' },
      { 'courseId3': template.courseId, 'status3': 'Completed' },
      { 'courseId4': template.courseId, 'status4': 'Completed' },
      { 'courseId5': template.courseId, 'status5': 'Completed' }]
    });

    if (Object.keys(academics).length <= 0) {
      return res
        .status(404)
        .json({ success: false, error: "Academic not found for the Niswan and Course." });
    }
    console.log("OK OK");

    let studentIds = [];
    for (const academic of academics) {
      studentIds.push(String(academic.studentId));
    }

    console.log(studentIds.length);

    let students
    if (studentIds.length > 0) {
      students = await Student.find({ _id: studentIds, schoolId: schoolId }).sort({ rollNumber: 1 })
        .populate("userId", { password: 0, profileImage: 0 });
    }

    return res.status(200).json({ success: true, students });

  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get students bySchoolIdAndTemplate server error" });
  }
};

const getActiveStudents = async (req, res) => {
  try {
    const students = await Student.find({ active: "Active" })
      .populate("userId", { password: 0, profileImage: 0 })
      .populate("schoolId")
      .populate("districtStateId");
    return res.status(200).json({ success: true, students });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get active students server error" });
  }
};

const getByFilter = async (req, res) => {
  const {
    schoolId,
    courseId,
    status,
    acYear,
    maritalStatus,
    hosteller,
    year,
    instituteId,     // (not used in your current logic - keep if you plan)
    courseStatus,
  } = req.params;

  console.log("Get By Filter.")

  const isValidParam = (v) =>
    v !== undefined &&
    v !== null &&
    v !== "" &&
    v !== "null" &&
    v !== "undefined";

  try {
    if (!isValidParam(schoolId)) {
      return res.status(400).json({ success: false, error: "schoolId is required" });
    }

    // ----------------------------
    // 1) Build Student query
    // ----------------------------
    const studentQuery = { schoolId };

    if (isValidParam(status)) studentQuery.active = status;
    //if (isValidParam(maritalStatus)) studentQuery.maritalStatus = maritalStatus;
    if (isValidParam(maritalStatus)) {
      studentQuery.maritalStatus = { $regex: `^${maritalStatus.trim()}$`, $options: "i" };
    }
    if (isValidParam(hosteller)) studentQuery.hostel = hosteller;

    // ----------------------------
    // 2) Academic filter -> get matching studentIds
    //    (Only if any academic filters are present)
    // ----------------------------
    const hasAcademicFilter =
      isValidParam(courseId) || isValidParam(acYear) || isValidParam(year) || isValidParam(courseStatus);

    if (hasAcademicFilter) {
      const academicAnd = [];

      if (isValidParam(courseId)) {
        academicAnd.push({
          $or: [
            { courseId1: courseId },
            { courseId2: courseId },
            { courseId3: courseId },
            { courseId4: courseId },
            { courseId5: courseId },
          ],
        });
      }

      if (isValidParam(acYear)) {
        academicAnd.push({ acYear });
      }

      if (isValidParam(year)) {
        const y = Number(year);
        academicAnd.push({ $or: [{ year1: y }, { year3: y }] });
      }

      if (isValidParam(courseStatus)) {
        academicAnd.push({
          $or: [
            { status1: courseStatus },
            { status2: courseStatus },
            { status3: courseStatus },
            { status4: courseStatus },
            { status5: courseStatus },
          ],
        });
      }

      // Get only studentIds (faster than fetching full academic docs)
      const studentIds = await Academic.distinct("studentId", { $and: academicAnd });

      if (!studentIds || studentIds.length === 0) {
        return res.status(200).json({ success: true, students: [] });
      }

      studentQuery._id = { $in: studentIds };
    }

    // ----------------------------
    // 3) Fetch students (lean + minimal populate)
    // ----------------------------
    const studentSelect =
      "rollNumber name dob active maritalStatus hostel userId schoolId districtStateId courses feesPaid fatherName fatherNumber motherName motherNumber guardianName guardianRelation guardianNumber remarks";

    const studentsMap = await Student.find(studentQuery)
      .select(studentSelect)
      .sort({ rollNumber: 1 })
      .populate({ path: "userId", select: "name email role" })
      .populate({ path: "schoolId", select: "code nameEnglish" })
      .populate({ path: "districtStateId", select: "district state" })
      .populate({ path: "courses", select: "name type fees years code" })
      .lean();

    const students = studentsMap.map((s) => {
      // show only if feesPaid === 1 (or true)
      //const isPaid = s.feesPaid === 1 || s.feesPaid === true || s.feesPaid === "1";
      const isPaid = Number(s.feesPaid) === 1;
      if (!isPaid) {
        const { rollNumber, ...rest } = s;
        return rest;
      }
      return s;
    });

    return res.status(200).json({ success: true, students });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "get students by FILTER server error" });
  }
}

{/*
const getByFilter = async (req, res) => {

  const { schoolId, courseId, status, acYear, maritalStatus, hosteller, year, instituteId, courseStatus } = req.params;

  console.log("getByFilter : " + schoolId + ", " + courseId + ",  " + status + ",  "
    + acYear + ",  " + maritalStatus + ",  " + hosteller + ",  " + year + ",  " + instituteId + ", " + courseStatus);

  try {

    let filterQuery = Student.find();
    filterQuery = filterQuery.where('schoolId').eq(schoolId);
    //filterQuery.push({ schoolId: schoolId });

    if (status && status?.length > 0 && status != 'null' && status != 'undefined') {
      console.log("Status Added : " + status);
      filterQuery = filterQuery.where('active').eq(status);
      //filterQuery.push({ active: status });
    }

    if (maritalStatus && maritalStatus?.length > 0 && maritalStatus != 'null' && maritalStatus != 'undefined') {
      console.log("maritalStatus Added : " + maritalStatus);
      filterQuery = filterQuery.where('maritalStatus').eq(maritalStatus);
      //filterQuery.push({ maritalStatus: maritalStatus });
    }

    if (hosteller && hosteller?.length > 0 && hosteller != 'null' && hosteller != 'undefined') {
      console.log("hosteller Added : " + maritalStatus);
      filterQuery = filterQuery.where('hostel').eq(hosteller);
      //filterQuery.push({ hostel: hosteller });
    }

    if ((courseId && courseId?.length > 0 && courseId != 'null' && courseId != 'undefined')
      || (acYear && acYear?.length > 0 && acYear != 'null' && acYear != 'undefined')
      || (year && year?.length > 0 && year != 'null' && year != 'undefined')
      || (courseStatus && courseStatus?.length > 0 && courseStatus != 'null' && courseStatus != 'undefined')) {

      console.log("courseId Added : " + courseId);
      console.log("acYear Added : " + acYear);
      console.log("Year Added : " + year);
      console.log("courseStatus Added : " + courseStatus);

      let academicQuery = [];

      if (courseId && courseId?.length > 0 && courseId != 'null' && courseId != 'undefined') {
        const orCourseConditions = [];
        orCourseConditions.push({ courseId1: courseId });
        orCourseConditions.push({ courseId2: courseId });
        orCourseConditions.push({ courseId3: courseId });
        orCourseConditions.push({ courseId4: courseId });
        orCourseConditions.push({ courseId5: courseId });
        //academicQuery.$or = orCourseConditions;
        academicQuery.push({ $or: orCourseConditions });
      }

      if (acYear && acYear?.length > 0 && acYear != 'null' && acYear != 'undefined') {
        //academicQuery.acYear = { $eq: acYear };
        academicQuery.push({ acYear: acYear });
      }

      if (year && year?.length > 0 && year != 'null' && year != 'undefined') {
        const orConditions = [];
        orConditions.push({ year1: year });
        orConditions.push({ year3: year });
        //academicQuery.$or = orConditions;
        academicQuery.push({ $or: orConditions });
      }

      if (courseStatus && courseStatus?.length > 0 && courseStatus != 'null' && courseStatus != 'undefined') {
        const orCourseStatusConditions = [];
        orCourseStatusConditions.push({ status1: courseStatus });
        orCourseStatusConditions.push({ status2: courseStatus });
        orCourseStatusConditions.push({ status3: courseStatus });
        orCourseStatusConditions.push({ status4: courseStatus });
        orCourseStatusConditions.push({ status5: courseStatus });
        //academicQuery.$or = orCourseStatusConditions;
        academicQuery.push({ $or: orCourseStatusConditions });
      }

      const academics = await Academic.find({ $and: academicQuery });
      let studentIds = [];
      academics.forEach(academic => studentIds.push(academic.studentId));
      console.log("Student Ids : " + studentIds)
      filterQuery = filterQuery.where('_id').in(studentIds);
      //filterQuery.push({ hostel: hosteller });
    }

    filterQuery.sort({ rollNumber: 1 });
    filterQuery.populate("userId", { password: 0, profileImage: 0 })
      .populate("schoolId")
      .populate("districtStateId")
      .populate("courses");

    // console.log(filterQuery);

    const students = await filterQuery.exec();

    console.log("Students : " + students?.length)
    return res.status(200).json({ success: true, students });
  } catch (error) {
    console.log(error)
    return res
      .status(500)
      .json({ success: false, error: "get students by FILTER server error" });
  }
};
*/}

const getStudent = async (req, res) => {
  const { id } = req.params;

  console.log("getStudent : " + id);

  try {
    let student = await Student.findById(id)
      .populate({ path: "schoolId", select: "code nameEnglish" })
      .populate({ path: "userId", select: "name email role" })
      .populate({ path: "courses", select: "name type fees years code" })
      .populate({ path: "districtStateId", select: "district state" })
      .lean();

    if (!student) {
      return res.status(404).json({ success: false, error: "Student data not found." });
    }

    const academics = await Academic.find({ studentId: student._id })
      .populate({ path: "acYear", select: "_id acYear" })
      .populate({ path: "instituteId1", select: "_id code name" })
      .populate({ path: "courseId1", select: "_id iCode name" })
      .populate({ path: "instituteId2", select: "_id code name" })
      .populate({ path: "courseId2", select: "_id iCode name" })
      .populate({ path: "instituteId3", select: "_id code name" })
      .populate({ path: "courseId3", select: "_id iCode name" })
      .populate({ path: "instituteId4", select: "_id code name" })
      .populate({ path: "courseId4", select: "_id iCode name" })
      .populate({ path: "instituteId5", select: "_id code name" })
      .populate({ path: "courseId5", select: "_id iCode name" })
      .lean(); // ✅ keep lean for academics too (faster)

    // ✅ attach academics
    student._academics = academics || [];

    // ✅ hide rollNumber if not paid
    if (Number(student?.feesPaid) === 0) {
      student.rollNumber = "-";
    }

    return res.status(200).json({ success: true, student });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, error: "get student by ID server error" });
  }
};

/*
const getStudent = async (req, res) => {
  const { id } = req.params;

  console.log("getStudent : " + id);

  try {
    let student = await Student.findById({ _id: id })
      .populate({ path: "schoolId", select: "code nameEnglish" })
      .populate({ path: "userId", select: "name email role" })
      .populate({ path: "courses", select: "name type fees years code" })
      .populate({ path: "districtStateId", select: "district state" })
      .lean();

    if (!student) {
      return res
        .status(404)
        .json({ success: false, error: "Student data not found." });
    }

    const academics = await Academic.find({ studentId: student._id })
      .populate({ path: 'acYear', select: '_id acYear' })
      .populate({ path: 'instituteId1', select: '_id code name' })
      .populate({ path: 'courseId1', select: '_id iCode name' })
      .populate({ path: 'instituteId2', select: '_id code name' })
      .populate({ path: 'courseId2', select: '_id iCode name' })
      .populate({ path: 'instituteId3', select: '_id code name' })
      .populate({ path: 'courseId3', select: '_id iCode name' })
      .populate({ path: 'instituteId4', select: '_id code name' })
      .populate({ path: 'courseId4', select: '_id iCode name' })
      .populate({ path: 'instituteId5', select: '_id code name' })
      .populate({ path: 'courseId5', select: '_id iCode name' })

    //  if (!academics) {
    //    return res
    //      .status(404)
    //      .json({ success: false, error: "Academic details Not found : " + student._id + ", " + accYear });
    //  }

    student._academics = academics;
    student.toObject({ virtuals: true });

    if (student?.feesPaid === 0) {
      student.rollNumber = "-"
    }

    return res.status(200).json({ success: true, student });
  } catch (error) {
    console.log(error)
    return res
      .status(500)
      .json({ success: false, error: "get student by ID server error" });
  }
}
*/

const getStudentForEdit = async (req, res) => {
  const { id } = req.params;

  console.log("getStudentForEdit : " + id);

  try {
    const student = await Student.findById(id)
      .populate({ path: "schoolId", select: "code nameEnglish" })
      .populate({ path: "userId", select: "name email role" })
      .populate({ path: "districtStateId", select: "district state" })
      .populate({ path: "courses", select: "name type fees years code" })
      .lean();

    if (!student) {
      return res.status(404).json({ success: false, error: "Student data not found." });
    }

    // ✅ Fees check (safe numeric)
    if (Number(student?.feesPaid) === 0) {
      return res
        .status(403)
        .json({ success: false, error: "Sorry. Could not Update. (Fees not Paid)" });
    }

    // ✅ Current Academic Year string (Apr–Mar)
    const now = new Date();
    const yearNow = now.getFullYear();
    const month = now.getMonth() + 1;

    let accYear = `${yearNow - 1}-${yearNow}`;
    if (month >= 4) accYear = `${yearNow}-${yearNow + 1}`;

    const acadYear = await AcademicYear.findOne({ acYear: accYear }).select("_id acYear").lean();
    if (!acadYear?._id) {
      return res.status(404).json({ success: false, error: "Academic Year Not found : " + accYear });
    }

    console.log("Student : " + student._id + ", AC Year : " + acadYear._id);

    // ✅ Latest academic record (prefer current year, fallback to latest overall if none)
    let academic = await Academic.findOne({ studentId: student._id, acYear: acadYear._id })
      .sort({ updatedAt: -1 })
      .populate({ path: "acYear", select: "_id acYear" })
      .populate({ path: "instituteId1", select: "_id code name" })
      .populate({ path: "courseId1", select: "_id iCode name" })
      .populate({ path: "instituteId2", select: "_id code name" })
      .populate({ path: "courseId2", select: "_id iCode name" })
      .populate({ path: "instituteId3", select: "_id code name" })
      .populate({ path: "courseId3", select: "_id iCode name" })
      .populate({ path: "instituteId4", select: "_id code name" })
      .populate({ path: "courseId4", select: "_id iCode name" })
      .populate({ path: "instituteId5", select: "_id code name" })
      .populate({ path: "courseId5", select: "_id iCode name" })
      .lean();

    // fallback to latest academic if current year not found
    if (!academic) {
      academic = await Academic.findOne({ studentId: student._id })
        .sort({ updatedAt: -1 })
        .populate({ path: "acYear", select: "_id acYear" })
        .populate({ path: "instituteId1", select: "_id code name" })
        .populate({ path: "courseId1", select: "_id iCode name" })
        .populate({ path: "instituteId2", select: "_id code name" })
        .populate({ path: "courseId2", select: "_id iCode name" })
        .populate({ path: "instituteId3", select: "_id code name" })
        .populate({ path: "courseId3", select: "_id iCode name" })
        .populate({ path: "instituteId4", select: "_id code name" })
        .populate({ path: "courseId4", select: "_id iCode name" })
        .populate({ path: "instituteId5", select: "_id code name" })
        .populate({ path: "courseId5", select: "_id iCode name" })
        .lean();
    }

    // ✅ attach as array (same shape as your frontend expects)
    student._academics = academic ? [academic] : [];

    return res.status(200).json({ success: true, student });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, error: "get student by ID server error" });
  }
};

/*
const getStudentForEdit = async (req, res) => {
  const { id } = req.params;

  console.log("getStudentForEdit : " + id);

  try {
    let student = await Student.findById({ _id: id })
      .populate({ path: "schoolId", select: "code nameEnglish" })
      .populate({ path: "userId", select: "name email role" })
      .populate({ path: "districtStateId", select: "district state" })
      .populate({ path: "courses", select: "name type fees years code" })
      .lean();

    if (!student) {
      return res
        .status(404)
        .json({ success: false, error: "Student data not found." });
    }

    if (student?.feesPaid === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Sorry. Could not Update. (Fees not Paid)" });
    }

    let accYear = (new Date().getFullYear() - 1) + "-" + new Date().getFullYear();
    if (new Date().getMonth() + 1 >= 4) {
      accYear = new Date().getFullYear() + "-" + (new Date().getFullYear() + 1);
    }

    let acadYear = await AcademicYear.findOne({ acYear: accYear });
    if (!acadYear) {
      return res
        .status(404)
        .json({ success: false, error: "Academic Year Not found : " + accYear });
    }

    console.log("Student : " + student._id + ", AC Year : " + acadYear._id);

    /*const academic = await Academic.findOne({ studentId: student._id, acYear: acadYear._id })
      .populate({ path: 'acYear', select: '_id acYear' })
      .populate({ path: 'instituteId1', select: '_id code name' })
      .populate({ path: 'courseId1', select: '_id iCode name' })
      .populate({ path: 'instituteId2', select: '_id code name' })
      .populate({ path: 'courseId2', select: '_id iCode name' })
      .populate({ path: 'instituteId3', select: '_id code name' })
      .populate({ path: 'courseId3', select: '_id iCode name' })
      .populate({ path: 'instituteId4', select: '_id code name' })
      .populate({ path: 'courseId4', select: '_id iCode name' })
      .populate({ path: 'instituteId5', select: '_id code name' })
      .populate({ path: 'courseId5', select: '_id iCode name' });
*/
/*   const academic = await Academic.find({ studentId: student._id })
     .sort({ updatedAt: -1 }).limit(1)
     .populate({ path: 'acYear', select: '_id acYear' })
     .populate({ path: 'instituteId1', select: '_id code name' })
     .populate({ path: 'courseId1', select: '_id iCode name' })
     .populate({ path: 'instituteId2', select: '_id code name' })
     .populate({ path: 'courseId2', select: '_id iCode name' })
     .populate({ path: 'instituteId3', select: '_id code name' })
     .populate({ path: 'courseId3', select: '_id iCode name' })
     .populate({ path: 'instituteId4', select: '_id code name' })
     .populate({ path: 'courseId4', select: '_id iCode name' })
     .populate({ path: 'instituteId5', select: '_id code name' })
     .populate({ path: 'courseId5', select: '_id iCode name' });

   //console.log(academic[0])

   student._academics = academic[0] ? [academic[0]] : [];
   student.toObject({ virtuals: true });

   return res.status(200).json({ success: true, student });
 } catch (error) {
   console.log(error)
   return res
     .status(500)
     .json({ success: false, error: "get student by ID server error" });
 }
};
*/
const getAcademic = async (req, res) => {

  const { studentId, acaYear } = req.params;

  console.log("getAcademic : " + studentId);
  try {

    let accYear = (new Date().getFullYear() - 1) + "-" + new Date().getFullYear();
    if (new Date().getMonth() + 1 >= 4) {
      accYear = new Date().getFullYear() + "-" + (new Date().getFullYear() + 1);
    }

    let acadYear = await AcademicYear.findOne({ acYear: accYear });
    if (!acadYear) {
      accYear = (new Date().getFullYear() - 1) + "-" + new Date().getFullYear();
      acadYear = await AcademicYear.findOne({ acYear: accYear });
      if (!acadYear) {
        return res
          .status(404)
          .json({ success: false, error: "Academic Year Not found : " + accYear });
      }
    }

    let academic = await Academic.findOne({ studentId: studentId, acYear: acadYear._id })
      .populate("acYear")
      .populate("instituteId1")
      .populate("courseId1")
      .populate("instituteId2")
      .populate("courseId2")
      .populate("instituteId3")
      .populate("courseId3")
      .populate("instituteId4")
      .populate("courseId4")
      .populate("instituteId5")
      .populate("courseId5");

    if (!academic) {
      return res
        .status(404)
        .json({ success: false, error: "Academic details Not found : " + studentId + ", " + accYear });
    }

    return res.status(200).json({ success: true, academic });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get academic by student id server error" });
  }
};

const getStudentForPromote = async (req, res) => {

  try {
    const { id } = req.params;
    console.log("getStudentForPromote : " + id);

    let student = await Student.findById({ _id: id })
      .populate({ path: "schoolId", select: "code nameEnglish" })
      .populate({ path: "userId", select: "name email role" })
      .populate({ path: "districtStateId", select: "district state" });
    //.populate({ path: "courses", select: "name type fees years code" });

    if (!student) {
      return res
        .status(404)
        .json({ success: false, error: "Student data not found." });
    }

    const redis = await getRedis();
    const academicYears = JSON.parse(await redis.get('academicYears'));

    let accYear = new Date().getFullYear() + "-" + (new Date().getFullYear() + 1);
    let accYearId = academicYears.filter(acYear => acYear.acYear === accYear).map(acYear => acYear._id);
    console.log("Ac Id - 1 : " + accYearId)

    let academics = await Academic.find({ studentId: student._id, acYear: accYearId })
      .populate({ path: 'acYear', select: '_id acYear' })
      .populate({ path: 'instituteId1', select: '_id code name' })
      .populate({ path: 'courseId1', select: '_id iCode name' })
      .populate({ path: 'instituteId2', select: '_id code name' })
      .populate({ path: 'courseId2', select: '_id iCode name' })
      .populate({ path: 'instituteId3', select: '_id code name' })
      .populate({ path: 'courseId3', select: '_id iCode name' })
      .populate({ path: 'instituteId4', select: '_id code name' })
      .populate({ path: 'courseId4', select: '_id iCode name' })
      .populate({ path: 'instituteId5', select: '_id code name' })
      .populate({ path: 'courseId5', select: '_id iCode name' })

    if (academics && academics.length > 0) {
      return res
        .status(400)
        .json({ success: false, error: "Academic details Already Found : " + student._id + ", " + accYear });
    }

    accYear = (new Date().getFullYear() - 1) + "-" + new Date().getFullYear();
    accYearId = academicYears.filter(acYear => acYear.acYear === accYear).map(acYear => acYear._id);
    console.log("Ac Id - 2 : " + accYearId)

    academics = await Academic.find({ studentId: student._id, acYear: accYearId })
      .populate({ path: 'acYear', select: '_id acYear' })
      .populate({ path: 'instituteId1', select: '_id code name' })
      .populate({ path: 'courseId1', select: '_id iCode name' })
      .populate({ path: 'instituteId2', select: '_id code name' })
      .populate({ path: 'courseId2', select: '_id iCode name' })
      .populate({ path: 'instituteId3', select: '_id code name' })
      .populate({ path: 'courseId3', select: '_id iCode name' })
      .populate({ path: 'instituteId4', select: '_id code name' })
      .populate({ path: 'courseId4', select: '_id iCode name' })
      .populate({ path: 'instituteId5', select: '_id code name' })
      .populate({ path: 'courseId5', select: '_id iCode name' })

    if (!academics || academics.length <= 0) {

      accYear = (new Date().getFullYear() - 2) + "-" + (new Date().getFullYear() - 1);
      accYearId = academicYears.filter(acYear => acYear.acYear === accYear).map(acYear => acYear._id);
      console.log("Ac Id - 3 : " + accYearId)

      academics = await Academic.find({ studentId: student._id, acYear: accYearId })
        .populate({ path: 'acYear', select: '_id acYear' })
        .populate({ path: 'instituteId1', select: '_id code name' })
        .populate({ path: 'courseId1', select: '_id iCode name' })
        .populate({ path: 'instituteId2', select: '_id code name' })
        .populate({ path: 'courseId2', select: '_id iCode name' })
        .populate({ path: 'instituteId3', select: '_id code name' })
        .populate({ path: 'courseId3', select: '_id iCode name' })
        .populate({ path: 'instituteId4', select: '_id code name' })
        .populate({ path: 'courseId4', select: '_id iCode name' })
        .populate({ path: 'instituteId5', select: '_id code name' })
        .populate({ path: 'courseId5', select: '_id iCode name' })
    }

    if (!academics || academics.length <= 0) {
      return res
        .status(404)
        .json({ success: false, error: "Pre Previous Academic details Not found : " + student._id + ", " + accYear });
    }

    student._academics = academics;
    student.toObject({ virtuals: true });

    return res.status(200).json({ success: true, student });
  } catch (error) {
    console.log(error)
    return res
      .status(500)
      .json({ success: false, error: "Get student For Promote server error" });
  }
};

const updateStudent = async (req, res) => {

  console.log("Update Student called.")
  try {
    const { id } = req.params;
    const { name,
      schoolId,
      doa,
      dob,
      gender,
      maritalStatus,
      motherTongue,
      bloodGroup,
      idMark1,
      idMark2,
      about,
      fatherName,
      fatherNumber,
      fatherOccupation,
      motherName,
      motherNumber,
      motherOccupation,
      guardianName,
      guardianNumber,
      guardianOccupation,
      guardianRelation,

      address,
      city,
      districtStateId,
      landmark,
      pincode,

      active,
      remarks,

      hostel,
      hostelRefNumber,
      hostelFees,
      hostelDiscount,

      acYear,

      instituteId1,
      courseId1,
      refNumber1,
      year1,
      fees1,
      discount1,

      instituteId2,
      courseId2,
      refNumber2,
      year2,
      fees2,
      discount2,

      instituteId3,
      courseId3,
      refNumber3,
      year3,
      fees3,
      discount3,

      instituteId4,
      courseId4,
      refNumber4,
      year4,
      fees4,
      discount4,

      instituteId5,
      courseId5,
      refNumber5,
      year5,
      fees5,
      discount5,
    } = req.body;

    const student = await Student.findById({ _id: id });
    if (!student) {
      return res
        .status(404)
        .json({ success: false, error: "Student not found" });
    }

    const user = await User.findById({ _id: student.userId })
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
      const blob = await put("profiles/" + student._id + ".png", fileBuffer, {
        access: 'public',
        contentType: 'image/png',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        allowOverwrite: true,
      });

      updateUser = await User.findByIdAndUpdate({ _id: student.userId }, { name: toCamelCase(name), profileImage: blob.downloadUrl, })
    } else {
      updateUser = await User.findByIdAndUpdate({ _id: student.userId }, { name: toCamelCase(name), })
    }

    let hostelFinalFeesVal = Number(hostelFees ? hostelFees : "0") - Number(hostelDiscount ? hostelDiscount : "0");
    const updateStudent = await Student.findByIdAndUpdate({ _id: id }, {
      schoolId,
      doa,
      dob,
      gender,
      maritalStatus,
      motherTongue,
      bloodGroup: toCamelCase(bloodGroup),
      idMark1: toCamelCase(idMark1),
      idMark2: toCamelCase(idMark2),
      about: toCamelCase(about),
      fatherName: toCamelCase(fatherName),
      fatherNumber,
      fatherOccupation: toCamelCase(fatherOccupation),
      motherName: toCamelCase(motherName),
      motherNumber,
      motherOccupation: toCamelCase(motherOccupation),
      guardianName: toCamelCase(guardianName),
      guardianNumber,
      guardianOccupation: toCamelCase(guardianOccupation),
      guardianRelation: toCamelCase(guardianRelation),
      address: toCamelCase(address),
      city: toCamelCase(city),
      districtStateId,
      landmark: toCamelCase(landmark),
      pincode,
      hostel,
      hostelRefNumber,
      hostelFees,
      hostelDiscount,
      hostelFinalFees: hostelFinalFeesVal,
      active,
      remarks: toCamelCase(remarks),
    })

    console.log("AC Year : " + acYear)
    const academicYearById = await AcademicYear.findById({ _id: acYear });
    if (academicYearById == null) {
      return res
        .status(404)
        .json({ success: false, error: "Academic Year Not exists" });
    }

    let finalFees1Val = Number(fees1 ? fees1 : "0") - Number(discount1 ? discount1 : "0");
    let finalFees2Val = Number(fees2 ? fees2 : "0") - Number(discount2 ? discount2 : "0");
    let finalFees3Val = Number(fees3 ? fees3 : "0") - Number(discount3 ? discount3 : "0");
    let finalFees4Val = Number(fees4 ? fees4 : "0") - Number(discount4 ? discount4 : "0");
    let finalFees5Val = Number(fees5 ? fees5 : "0") - Number(discount5 ? discount5 : "0");

    const updateAcademic = await Academic.findOne({ studentId: student._id, acYear: academicYearById._id });
    if (updateAcademic == null) {

      const newAcademic = new Academic({
        studentId: student._id,
        acYear: academicYearById._id,

        instituteId1,
        courseId1,
        refNumber1,
        year1,
        fees1,
        discount1,
        finalFees1: finalFees1Val,
        status1: "Admission",

        instituteId2,
        courseId2,
        refNumber2,
        year2,
        fees2,
        discount2,
        finalFees2: finalFees2Val,
        status2: instituteId2 && courseId2 ? "Admission" : null,

        instituteId3,
        courseId3,
        refNumber3,
        year3,
        fees3,
        discount3,
        finalFees3: finalFees3Val,
        status3: instituteId3 && courseId3 ? "Admission" : null,

        instituteId4,
        courseId4,
        refNumber4,
        year4,
        fees4,
        discount4,
        finalFees4: finalFees4Val,
        status4: instituteId4 && courseId4 ? "Admission" : null,

        instituteId5: instituteId5 ? instituteId5 : null,
        courseId5: courseId5 ? courseId5 : null,
        refNumber5,
        year5,
        fees5,
        discount5,
        finalFees5: finalFees5Val,
        status5: instituteId5 && courseId5 ? "Admission" : null,
      });

      let savedAcademic = await newAcademic.save();

      let totalFees = finalFees1Val + finalFees2Val + finalFees3Val + finalFees4Val + finalFees5Val + hostelFinalFeesVal;

      const newAccount = new Account({
        userId: student._id,
        acYear: academicYearById._id,
        academicId: savedAcademic._id,

        receiptNumber: "Admission",
        type: "fees",
        fees: totalFees,
        paidDate: Date.now(),
        balance: totalFees,
        remarks: "Admission",
      });

      let savedAccount = await newAccount.save();

    } else {

      const updateAcademicById = await Academic.findByIdAndUpdate({ _id: updateAcademic._id }, {
        instituteId1: instituteId1 ? instituteId1 : null,
        courseId1: courseId1 ? courseId1 : null,
        refNumber1,
        year1,
        fees1,
        discount1,
        finalFees1: finalFees1Val,

        instituteId2: instituteId2 ? instituteId2 : null,
        courseId2: courseId2 ? courseId2 : null,
        refNumber2,
        year2,
        fees2,
        discount2,
        finalFees2: finalFees2Val,
        status2: instituteId2 && courseId2 ? "Admission" : null,

        instituteId3: instituteId3 ? instituteId3 : null,
        courseId3: courseId3 ? courseId3 : null,
        refNumber3,
        year3,
        fees3,
        discount3,
        finalFees3: finalFees3Val,
        status3: instituteId3 && courseId3 ? "Admission" : null,

        instituteId4: instituteId4 ? instituteId4 : null,
        courseId4: courseId4 ? courseId4 : null,
        refNumber4,
        year4,
        fees4,
        discount4,
        finalFees4: finalFees4Val,
        status4: instituteId4 && courseId4 ? "Admission" : null,

        instituteId5: instituteId5 ? instituteId5 : null,
        courseId5: courseId5 ? courseId5 : null,
        refNumber5,
        year5,
        fees5,
        discount5,
        finalFees5: finalFees5Val,
        status5: instituteId5 && courseId5 ? "Admission" : null,
      })

      const updateAccount = await Account.findOne({ userId: updateUser._id, acYear: acYear, academicId: updateAcademic._id });
      if (updateAccount == null) {
        return res
          .status(404)
          .json({ success: false, error: "Account Data Not exists" });
      }

      let totalFees = finalFees1Val + finalFees2Val + finalFees3Val + finalFees4Val + finalFees5Val + hostelFinalFeesVal;

      const updateAccountById = await Account.findByIdAndUpdate({ _id: updateAccount._id }, {
        fees: totalFees,
        paidDate: Date.now(),
        remarks: "Admission-updated",
      })
    }

    const coursesArray = [courseId1];
    if (courseId2) {
      coursesArray.push(courseId2);
    }
    if (courseId3) {
      coursesArray.push(courseId3);
    }
    if (courseId4) {
      coursesArray.push(courseId4);
    }
    if (courseId5) {
      coursesArray.push(courseId5);
    }
    await Student.findByIdAndUpdate({ _id: updateStudent._id }, { courses: coursesArray });

    return res.status(200).json({ success: true, message: "Student updated successfully." })

  } catch (error) {

    console.log(error)
    return res
      .status(500)
      .json({ success: false, error: "update students server error" });
  }
};

const promoteStudent = async (req, res) => {

  console.log("promoteStudent")
  try {
    const { id } = req.params;
    const {
      acYear,

      instituteId1,
      courseId1,
      refNumber1,
      year1,
      fees1,
      discount1,
      status1,

      instituteId2,
      courseId2,
      nextCourseId,
      refNumber2,
      year2,
      fees2,
      discount2,
      status2,

      instituteId3,
      courseId3,
      refNumber3,
      year3,
      fees3,
      discount3,
      status3,

      instituteId4,
      courseId4,
      refNumber4,
      year4,
      fees4,
      discount4,
      status4,

      instituteId5,
      courseId5,
      refNumber5,
      year5,
      fees5,
      discount5,
      status5,
    } = req.body;

    const student = await Student.findById({ _id: id });
    if (!student) {
      return res
        .status(404)
        .json({ success: false, error: "Student not found" });
    }

    const user = await User.findById({ _id: student.userId })
    if (!user) {
      return res
        .status(404)
        .json({ success: false, error: "User data not found" });
    }

    console.log("School Id : " + student.schoolId)
    const school = await School.findById({ _id: student.schoolId })
    if (!school) {
      return res
        .status(404)
        .json({ success: false, error: "Niswan not found" });
    }

    let accYear = new Date().getFullYear() + "-" + (new Date().getFullYear() + 1);
    const redis = await getRedis();
    const academicYears = JSON.parse(await redis.get('academicYears'));
    let accYearId = academicYears.filter(acYear => acYear.acYear === accYear).map(acYear => acYear._id);

    console.log("ACYear-1 : " + accYear + ", ACYearId-1:" + accYearId)
    if (accYearId == null || accYearId == "") {
      accYear = (new Date().getFullYear() - 1) + "-" + new Date().getFullYear();
      accYearId = academicYears.filter(acYear => acYear.acYear === accYear).map(acYear => acYear._id);
      console.log("ACYear-2 : " + accYear + ", ACYearId-2:" + accYearId)
    }

    let finalFees1Val = Number(fees1 ? fees1 : "0") - Number(discount1 ? discount1 : "0");
    let finalFees2Val = Number(fees2 ? fees2 : "0") - Number(discount2 ? discount2 : "0");
    let finalFees3Val = Number(fees3 ? fees3 : "0") - Number(discount3 ? discount3 : "0");
    let finalFees4Val = Number(fees4 ? fees4 : "0") - Number(discount4 ? discount4 : "0");
    let finalFees5Val = Number(fees5 ? fees5 : "0") - Number(discount5 ? discount5 : "0");

    let updateAcademic = await Academic.findOne({ studentId: student._id, acYear: accYearId });
    if (updateAcademic != null) {
      return res
        .status(400)
        .json({ success: false, error: "Check the Academic Data - Already Promote data found." });
    }

    console.log("Status-1 : " + status1 + ", Status-2 : " + status2 + ", Status-3 : " + status3
      + ", Status-4 : " + status4 + ", Status-5 : " + status5);

    // To complete.
    if (status1 === "Completed" || status2 === "Completed" || status3 === "Completed"
      || status4 === "Completed" || status5 === "Completed") {

      const academic = await Academic.findOne({ studentId: student._id, acYear: acYear });
      if (academic != null) {
        await Academic.findByIdAndUpdate({ _id: academic._id }, {
          status1: status1 && status1 === "Completed" ? status1 : academic.status1,
          status2: status2 && status2 === "Completed" ? status2 : academic.status2,
          status3: status3 && status3 === "Completed" ? status3 : academic.status3,
          status4: status4 && status4 === "Completed" ? status4 : academic.status4,
          status5: status5 && status5 === "Completed" ? status5 : academic.status5,
        });
      }
    }

    let savedAccount;
    // To promote.
    if ((status1 && status1 != "Completed") || (status2 && status2 != "Completed") || (status3 && status3 != "Completed")
      || (status4 && status4 != "Completed") || (status5 && status5 != "Completed")) {

      let academicModal = {};

      academicModal['studentId'] = student._id;
      academicModal['acYear'] = accYearId;

      // Deeniyath Education.
      academicModal['instituteId1'] = instituteId1;
      academicModal['courseId1'] = courseId1;
      academicModal['refNumber1'] = refNumber1;
      if (status1 && status1 != "Completed") {
        academicModal['year1'] = status1 && status1 === "Not-Promoted" ? year1 : year1 ? Number(year1) + 1 : 1;
        academicModal['fees1'] = fees1;
        academicModal['discount1'] = discount1;
        academicModal['finalFees1'] = finalFees1Val;
        academicModal['status1'] = status1;
      }

      if (status4 && status4 != "Completed") {
        // Islamic Home Science.
        academicModal['instituteId4'] = instituteId4;
        academicModal['courseId4'] = courseId4;
        academicModal['refNumber4'] = refNumber4;
        academicModal['fees4'] = fees4;
        academicModal['discount4'] = discount4;
        academicModal['finalFees4'] = finalFees4Val;
        academicModal['status4'] = status4;
      }

      if (status2 && status2 != "Completed") {
        // School Education.
        academicModal['instituteId2'] = instituteId2;
        academicModal['courseId2'] = courseId2;
        academicModal['refNumber2'] = refNumber2;
        academicModal['fees2'] = fees2;
        academicModal['discount2'] = discount2;
        academicModal['finalFees2'] = finalFees2Val;
        academicModal['status2'] = status2;
      }

      if (status3 && status3 != "Completed") {
        // College Education.
        academicModal['instituteId3'] = instituteId3;
        academicModal['courseId3'] = courseId3;
        academicModal['refNumber3'] = refNumber3;
        academicModal['year3'] = status3 && status3 === "Not-Promoted" ? year3 : year3 ? Number(year3) + 1 : 1;
        academicModal['fees3'] = fees3;
        academicModal['discount3'] = discount3;
        academicModal['finalFees3'] = finalFees3Val;
        academicModal['status3'] = status3;
      }

      if (status5 && status5 != "Completed") {
        // Vocational Course.
        academicModal['instituteId5'] = instituteId5;
        academicModal['courseId5'] = courseId5;
        academicModal['refNumber5'] = refNumber5;
        academicModal['fees5'] = fees5;
        academicModal['discount5'] = discount5;
        academicModal['finalFees5'] = finalFees5Val;
        academicModal['status5'] = status5;
      }

      console.log(academicModal);
      const newAcademic = new Academic(academicModal)
      updateAcademic = await newAcademic.save();

      let totalFees = (finalFees1Val && status1 != "Completed" ? finalFees1Val : 0)
        + (finalFees2Val && status2 != "Completed" ? finalFees2Val : 0)
        + (finalFees3Val && status3 != "Completed" ? finalFees3Val : 0)
        + (finalFees4Val && status4 != "Completed" ? finalFees4Val : 0)
        + (finalFees5Val && status5 != "Completed" ? finalFees5Val : 0);

      const newAccount = new Account({
        userId: student._id,
        acYear: accYearId,
        academicId: updateAcademic._id,

        receiptNumber: "Promote",
        type: "fees",
        fees: totalFees,
        paidDate: Date.now(),
        balance: totalFees,
        remarks: "Promote",
      });

      savedAccount = await newAccount.save();
    }

    const coursesArray = [];
    if (courseId1 && status1 && status1 != "Completed") {
      coursesArray.push(courseId1);
    }
    if (nextCourseId && status2 && status2 != "Completed") {
      coursesArray.push(nextCourseId);
    }
    if (courseId3 && status3 && status3 != "Completed") {
      coursesArray.push(courseId3);
    }
    if (courseId4 && status4 && status4 != "Completed") {
      coursesArray.push(courseId4);
    }
    if (courseId5 && status5 && status5 != "Completed") {
      coursesArray.push(courseId5);
    }
    await Student.findByIdAndUpdate({ _id: student._id }, { courses: coursesArray });

    return res.status(200).json({ success: true, message: "Student promoted Successfully." })

  } catch (error) {
    console.log(error)

    return res
      .status(500)
      .json({ success: false, error: "Promote students server error" });
  }
};

const deleteStudent = async (req, res) => {
  try {
    const { id } = req.params;

    const deleteStudent = await Student.findById({ _id: id })
      .populate("userId", { password: 0, profileImage: 0 });

    if (deleteStudent.userId && deleteStudent.userId._id) {
      await User.findByIdAndDelete({ _id: deleteStudent.userId._id });
    }
    console.log("User data Successfully Deleted...")

    const academicList = await Academic.find({ studentId: deleteStudent._id })
    academicList.forEach(async academic =>
      await Academic.findByIdAndDelete({ _id: academic._id })
    );
    console.log("Academic data Successfully Deleted...")

    if (deleteStudent.userId && deleteStudent.userId._id) {
      const account = await Account.find({ userId: deleteStudent.userId._id });
      if (!account) {
        await Account.findByIdAndDelete({ _id: account._id });
        console.log("Account data Successfully Deleted...")
      }
    }

    await Student.findByIdAndDelete({ _id: deleteStudent._id });

    const redis = await getRedis();
    await redis.set('totalStudents', await Student.countDocuments());

    console.log("Student data Successfully Deleted...")
    //  await deleteStudent.deleteOne()

    //  const updateStudent = await Student.findByIdAndUpdate({ _id: id }, {
    //    active: "In-Active",
    //    remarks: "Deleted",
    //  })
    return res.status(200).json({ success: true, message: "Successfully deleted" })
  } catch (error) {
    console.log(error)
    return res.status(500).json({ success: false, error: "delete Student server error" })
  }
}

const getStudentsCount = async (req, res) => {

  try {
    const counts = await Student.aggregate([
      {
        $group: {
          _id: '$schoolId',
          count: { $sum: 1 },
        },
      },
    ]);
    res.json(counts);

    return res.status(200).json({ success: true, counts });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "Get Students by School Error." });
  }
};

export {
  addStudent, upload, getStudents, getStudent, updateStudent, deleteStudent, getStudentForEdit,
  getAcademic, getStudentsBySchool, getStudentsBySchoolAndTemplate, getStudentsCount, importStudentsData,
  getStudentForPromote, promoteStudent, getByFilter, markFeesPaid
};
