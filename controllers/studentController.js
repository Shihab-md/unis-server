import multer from "multer";
import jwt from "jsonwebtoken";
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
import FeeInvoice from "../models/FeeInvoice.js";
import PaymentBatch from "../models/PaymentBatch.js";
import PaymentBatchItem from "../models/PaymentBatchItem.js";
import Numbering from "../models/Numbering.js";
import bcrypt from "bcrypt";
import getRedis from "../db/redis.js"
import { toCamelCase, getNextNumber, createInvoiceFromStructure } from "./commonController.js";
import { getActiveAcademicYearIdFromCache } from "./academicYearController.js";

const upload = multer({ storage: multer.memoryStorage() });

// 2) Upsert Account as "Fees Due" (payment happens later via HQ approval)
const upsertFeesDueAccount = async ({
  userId,
  acYear,
  academicId,
  fees,
  receiptLabel = "Admission",
  remarks = "",
  session,
}) => {
  if (!userId || !acYear || !academicId) throw new Error("Account keys missing (userId/acYear/academicId)");
  const totalFees = Number(fees || 0);
  if (!Number.isFinite(totalFees) || totalFees <= 0) throw new Error("Invalid fees for Account");

  const receiptNumber = await getNextNumber({ name: "Receipt", prefix: "RCPT", pad: 7 });
  //generateReceiptNumber({ session });

  const filter = { userId, acYear, academicId };
  const update = {
    $set: {
      receiptNumber: receiptNumber,
      type: "fees",
      fees: totalFees,
      balance: totalFees,        // due (not paid)
      paidDate: null,            // will be set by payment workflow if you use it
      remarks: remarks || receiptLabel,
    },
    $setOnInsert: {
      userId,
      acYear,
      academicId,
    },
  };

  const doc = await Account.findOneAndUpdate(filter, update, { new: true, upsert: true, session });
  return doc;
};

// 3) Create Fees Invoice (preferred). If FeeStructure not configured, fallback to simple single-head invoice.
const createFeesInvoiceSafe = async ({
  schoolId,
  studentId,
  userId,
  acYear,
  academicId,
  courseId,
  totalFees,
  source = "ADMISSION",
  createdBy,
  session,
}) => {
  const fees = Number(totalFees || 0);
  if (!Number.isFinite(fees) || fees <= 0) return null;

  try {
    // Preferred: uses FeeStructure + proper heads + numbering service
    const inv = await createInvoiceFromStructure({
      schoolId,
      studentId,
      userId,
      acYear,
      academicId,
      courseId,
      source,
      createdBy,
      session,
    });
    return inv;
  } catch (e) {
    // Fallback: create a simple invoice with 1 head (TOTAL)
    const invoiceNo = await getNextNumber({ name: "Invoice", prefix: "INV", pad: 7 });

    const items = [
      {
        headCode: "TOTAL",
        headName: "Course Fees",
        amount: fees,
        discount: 0,
        fine: 0,
        netAmount: fees,
        paidAmount: 0,
      },
    ];

    const inv = await FeeInvoice.create(
      [
        {
          invoiceNo,
          schoolId,
          studentId,
          userId,
          acYear,
          academicId,
          courseId,
          source,
          items,
          total: fees,
          paidTotal: 0,
          balance: fees,
          status: "ISSUED",
          createdBy,
          notes: e?.message ? `Fallback invoice: ${e.message}` : "Fallback invoice",
        },
      ],
      { session }
    );

    return inv?.[0] || null;
  }
};

/* ----------------------- Fees helpers for multi-course slots ----------------------- */
// ✅ MODIFIED: support 1..5 course slots in update/promote flows
const buildAcademicSlotsFromPayload = (payload = {}) => {
  const slots = [];
  for (let i = 1; i <= 5; i++) {
    const instituteId = payload[`instituteId${i}`];
    const courseId = payload[`courseId${i}`];
    const fees = Number(payload[`fees${i}`] || 0);
    const discount = Number(payload[`discount${i}`] || 0);
    const finalFees = Math.max(fees - discount, 0);
    const status = payload[`status${i}`]; // can be undefined
    slots.push({ i, instituteId, courseId, fees, discount, finalFees, status });
  }
  return slots;
};

const buildAcademicSlotsFromDoc = (doc = {}) => {
  const slots = [];
  for (let i = 1; i <= 5; i++) {
    const instituteId = doc[`instituteId${i}`];
    const courseId = doc[`courseId${i}`];
    const fees = Number(doc[`fees${i}`] || 0);
    const discount = Number(doc[`discount${i}`] || 0);
    const finalFees = Number(doc[`finalFees${i}`] ?? Math.max(fees - discount, 0));
    const status = doc[`status${i}`];
    slots.push({ i, instituteId, courseId, fees, discount, finalFees, status });
  }
  return slots;
};

// Detect newly added / changed slots (course or fees changed) and return those slots
const getChangedSlots = (prevDoc, nextPayload) => {
  const prev = buildAcademicSlotsFromDoc(prevDoc || {});
  const next = buildAcademicSlotsFromPayload(nextPayload || {});
  const changed = [];

  for (let i = 0; i < 5; i++) {
    const p = prev[i];
    const n = next[i];

    // Only consider slots that exist in NEW payload
    if (!n.instituteId || !n.courseId) continue;

    // If final fees is 0, nothing to invoice
    if (Number(n.finalFees || 0) <= 0) continue;

    const prevCourse = p?.courseId ? String(p.courseId) : "";
    const nextCourse = n?.courseId ? String(n.courseId) : "";

    const courseChanged = prevCourse !== nextCourse;
    const feesChanged = Number(p?.finalFees || 0) !== Number(n.finalFees || 0);

    // If previous slot was empty OR changed
    if (!prevCourse || courseChanged || feesChanged) {
      changed.push(n);
    }
  }
  return changed;
};

const sumFinalFeesFromPayload = (payload = {}) => {
  const slots = buildAcademicSlotsFromPayload(payload);
  return slots.reduce((s, x) => s + (Number(x.finalFees) > 0 ? Number(x.finalFees) : 0), 0);
};

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

    // ✅ Fees Due: create/update Account (payment will be done via Batch + HQ approval)
    savedAccount = await upsertFeesDueAccount({
      userId: savedUser._id,
      acYear: academicYearById._id,
      academicId: savedAcademic._id,
      fees: totalFees,
      receiptLabel: "Admission",
      remarks: "Admission",
    });

    // ✅ Create Fees Invoice (preferred FeeStructure, fallback to single-head)
    await createFeesInvoiceSafe({
      schoolId: schoolById?._id || schoolId,
      studentId: savedStudent?._id,
      userId: savedUser?._id,
      acYear: academicYearById?._id,
      academicId: savedAcademic?._id,
      courseId: savedAcademic?.courseId1 || courseId1,
      totalFees,
      source: "ADMISSION",
      createdBy: savedUser?._id,
    });

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

  const AC_YEAR_ID = await getActiveAcademicYearIdFromCache(); // "68612e92eeebf699b9d34a21" // 2025-2026 "680485d9361ed06368c57f7c"; // 2024-2025 
  //console.log("AC Year Id : " + AC_YEAR_ID)
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
      if (y < 0) return { error: "MakthabYear not given/invalid" };
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

    // ---------- Prefetch duplicates by OLD rollNumber (about OR remarks match) ----------
    const oldRollNumbers = [...new Set(studentsDataList.map((r) => safeStr(r.rollNumber)).filter(Boolean))];
    const oldRemarks = oldRollNumbers.map((r) => `Old Roll Number : ${r}`);

    const existingStudents = oldRemarks.length
      ? await Student.find({
        $or: [{ about: { $in: oldRemarks } }, { remarks: { $in: oldRemarks } }],
      })
        .select("about remarks")
        .lean()
      : [];

    const existingOldRemarksSet = new Set();
    for (const s of existingStudents) {
      if (s?.about) existingOldRemarksSet.add(String(s.about));
      if (s?.remarks) existingOldRemarksSet.add(String(s.remarks));
    }
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
                about: `Old Roll Number : ${oldRollNumber}`, // ✅ store OLD
              },
            ],
            { session }
          );

          const studentId = savedStudent[0]._id;

          // Create Academics
          let currentAcademicId = null;
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

          // ✅ Fees Due: create/update Account (payment will be done via Batch + HQ approval)
          await upsertFeesDueAccount({
            userId,
            acYear: AC_YEAR_ID,
            academicId: currentAcademicId,
            fees: fees,
            receiptLabel: "Admission",
            remarks: "Admission",
            session,
          });

          // ✅ Create Fees Invoice (preferred FeeStructure, fallback to single-head)
          await createFeesInvoiceSafe({
            schoolId: school._id,
            studentId,
            userId,
            acYear: AC_YEAR_ID,
            academicId: currentAcademicId,
            courseId,
            totalFees: fees,
            source: "ADMISSION",
            createdBy: userId,
            session,
          });
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
      .select("rollNumber name dob fatherName fatherNumber motherName motherNumber guardianName guardianRelation guardianNumber course year fees active userId schoolId districtStateId remarks about")
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

const getStudentsBySchool = async (req, res) => {

  const { schoolId } = req.params;

  console.log("getStudentsBySchool : " + schoolId);
  try {
    const studentSelect =
      "rollNumber name dob fatherName fatherNumber motherName motherNumber guardianName guardianRelation guardianNumber course year fees active userId districtStateId courses feesPaid remarks about";

    const studentsList = await Student.find({ schoolId: schoolId, active: "Active" })
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
    studentQuery.active = isValidParam(status) && String(status).trim() ? status : "Active";
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
      "rollNumber name dob active maritalStatus hostel userId schoolId districtStateId courses feesPaid fatherName fatherNumber motherName motherNumber guardianName guardianRelation guardianNumber remarks about";

    const studentsMap = await Student.find(studentQuery)
      .select(studentSelect)
      .sort({ rollNumber: 1 })
      .populate({ path: "userId", select: "name email role" })
      .populate({ path: "schoolId", select: "code nameEnglish" })
      .populate({ path: "districtStateId", select: "district state" })
      .populate({ path: "courses", select: "name type fees years code" })
      .lean();

    const students = studentsMap.map((s) => {
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

    if (!student) {
      return res
        .status(404)
        .json({ success: false, error: "Student data not found." });
    }

    // ✅ Fees check (safe numeric)
    if (Number(student?.feesPaid) === 0) {
      return res
        .status(403)
        .json({ success: false, error: "Sorry. Could not Promote. (Fees not Paid)" });
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
  try {
    const { id } = req.params;

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
      active,
      remarks,
      hostel,
      hostelRefNumber,
      hostelFees,
      hostelDiscount,
      acYear,

      instituteId1, courseId1, refNumber1, year1, fees1, discount1,
      instituteId2, courseId2, refNumber2, year2, fees2, discount2,
      instituteId3, courseId3, refNumber3, year3, fees3, discount3,
      instituteId4, courseId4, refNumber4, year4, fees4, discount4,
      instituteId5, courseId5, refNumber5, year5, fees5, discount5,
    } = req.body;

    // basic validation early (no DB writes yet)
    if (!id) return res.status(400).json({ success: false, error: "Student id is required" });
    if (!schoolId) return res.status(400).json({ success: false, error: "schoolId is required" });
    if (!acYear) return res.status(400).json({ success: false, error: "acYear is required" });

    const session = await mongoose.startSession();

    let profileUrl = null; // blob url (optional)
    try {
      // ---- Optional upload BEFORE transaction writes ----
      // (Cannot rollback blob upload, but safe enough.)
      if (req.file) {
        const blob = await put(`profiles/${id}.png`, req.file.buffer, {
          access: "public",
          contentType: "image/png",
          token: process.env.BLOB_READ_WRITE_TOKEN,
          allowOverwrite: true,
        });
        profileUrl = blob?.downloadUrl || null;
      }

      await session.withTransaction(async () => {
        // 1) Load student + user (in transaction)
        const student = await Student.findById(id).session(session);
        if (!student) throw new Error("Student not found");

        const user = await User.findById(student.userId).session(session);
        if (!user) throw new Error("User not found");

        const school = await School.findById(schoolId).select("_id").session(session);
        if (!school) throw new Error("Niswan not found");

        const academicYearById = await AcademicYear.findById(acYear).select("_id").session(session);
        if (!academicYearById) throw new Error("Academic Year Not exists");

        // helpers
        const toNum = (v) => {
          const n = Number(v ?? 0);
          return Number.isFinite(n) ? n : 0;
        };

        const finalFees = (fees, discount) => Math.max(0, toNum(fees) - toNum(discount));

        const hostelFinalFeesVal = Math.max(0, toNum(hostelFees) - toNum(hostelDiscount));

        const finalFees1Val = finalFees(fees1, discount1);
        const finalFees2Val = finalFees(fees2, discount2);
        const finalFees3Val = finalFees(fees3, discount3);
        const finalFees4Val = finalFees(fees4, discount4);
        const finalFees5Val = finalFees(fees5, discount5);

        const totalFees =
          finalFees1Val +
          finalFees2Val +
          finalFees3Val +
          finalFees4Val +
          finalFees5Val +
          hostelFinalFeesVal;

        // 2) Update User (name + optional profileImage)
        const userUpdate = {
          name: toCamelCase(name),
        };
        if (profileUrl) userUpdate.profileImage = profileUrl;

        const updatedUser = await User.findByIdAndUpdate(
          user._id,
          userUpdate,
          { new: true, session }
        );

        if (!updatedUser) throw new Error("Failed to update user");

        // 3) Update Student
        const updatedStudent = await Student.findByIdAndUpdate(
          id,
          {
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
          },
          { new: true, session }
        );

        if (!updatedStudent) throw new Error("Failed to update student");

        // 4) Upsert Academic (per studentId + acYear)
        const academicFilter = { studentId: student._id, acYear: academicYearById._id };


        const prevAcademic = await Academic.findOne(academicFilter).session(session).lean(); // ✅ MODIFIED: compare old vs new slots
        const academicUpdate = {
          instituteId1: instituteId1 || null,
          courseId1: courseId1 || null,
          refNumber1,
          year1,
          fees1,
          discount1,
          finalFees1: finalFees1Val,
          status1: instituteId1 && courseId1 ? "Admission" : null,

          instituteId2: instituteId2 || null,
          courseId2: courseId2 || null,
          refNumber2,
          year2,
          fees2,
          discount2,
          finalFees2: finalFees2Val,
          status2: instituteId2 && courseId2 ? "Admission" : null,

          instituteId3: instituteId3 || null,
          courseId3: courseId3 || null,
          refNumber3,
          year3,
          fees3,
          discount3,
          finalFees3: finalFees3Val,
          status3: instituteId3 && courseId3 ? "Admission" : null,

          instituteId4: instituteId4 || null,
          courseId4: courseId4 || null,
          refNumber4,
          year4,
          fees4,
          discount4,
          finalFees4: finalFees4Val,
          status4: instituteId4 && courseId4 ? "Admission" : null,

          instituteId5: instituteId5 || null,
          courseId5: courseId5 || null,
          refNumber5,
          year5,
          fees5,
          discount5,
          finalFees5: finalFees5Val,
          status5: instituteId5 && courseId5 ? "Admission" : null,
        };

        const academicDoc = await Academic.findOneAndUpdate(
          academicFilter,
          { $set: academicUpdate },
          { new: true, upsert: true, session }
        );

        if (!academicDoc?._id) throw new Error("Failed to upsert academic");

        // 5) Upsert Account (keyed by userId + acYear + academicId)
        // ✅ FIX: userId MUST be student.userId (NOT student._id or updatedUser._id)
        const accountFilter = {
          userId: student.userId,
          acYear: academicYearById._id,
          academicId: academicDoc._id,
        };

        // ✅ MODIFIED: capture previous fees BEFORE update (otherwise feesChanged will always be false)
        const prevAccountDoc = await Account.findOne(accountFilter).select("fees").session(session).lean();

        const accountUpdate = {
          userId: student.userId,
          schoolId: schoolId,
          acYear: academicYearById._id,
          academicId: academicDoc._id,
          receiptNumber: prevAccountDoc?.receiptNumber || "Admission",
          type: "fees",
          fees: totalFees,
          paidDate: Date.now(),
          balance: 0,
          remarks: "Admission-updated",
        };

        const accountDoc = await Account.findOneAndUpdate(
          accountFilter,
          { $set: accountUpdate },
          { new: true, upsert: true, session }
        );

        if (!accountDoc?._id) throw new Error("Failed to upsert account");

        // ✅ MODIFIED: Create invoices for *each changed slot* (course1..course5)
        // - Prevent duplicates on profile-only updates
        // - Fix: old code compared AFTER-update account fees (always same)
        try {
          const prevFees = Number(prevAccountDoc?.fees || 0);
          const feesChanged = Math.round(prevFees * 100) !== Math.round(Number(totalFees) * 100);

          const changedSlots = getChangedSlots(prevAcademic, {
            instituteId1, courseId1, fees1, discount1,
            instituteId2, courseId2, fees2, discount2,
            instituteId3, courseId3, fees3, discount3,
            instituteId4, courseId4, fees4, discount4,
            instituteId5, courseId5, fees5, discount5,
          });

          if (feesChanged || changedSlots.length > 0) {
            for (const slot of changedSlots) {
              await createFeesInvoiceSafe({
                schoolId: schoolId,
                studentId: student._id,
                userId: student.userId,
                acYear: academicYearById._id,
                academicId: academicDoc._id,
                courseId: slot.courseId,
                totalFees: slot.finalFees,
                source: "COURSE_CHANGE",
                createdBy: user._id,
                session,
                notes: `Auto invoice (Update) - Slot ${slot.i}`,
              });
            }

            // ✅ If new dues created, allow paying again (reset feesPaid)
            //await Student.findByIdAndUpdate(
            //  id,
            //  { $set: { feesPaid: 0 } },
            //  { session }
            //);
          }
        } catch (e) {
          // Don't fail the whole update if invoice creation fails
          console.log("Invoice create skipped/failed:", e?.message || e);
        }

        // 6) Update Student.courses array based on courseId1..5 (unique, non-null)
        const coursesArray = [courseId1, courseId2, courseId3, courseId4, courseId5]
          .filter(Boolean)
          .map(String);

        const uniqueCourses = [...new Set(coursesArray)];

        await Student.findByIdAndUpdate(
          id,
          { $set: { courses: uniqueCourses } },
          { session }
        );
      });

      await session.endSession();
      return res.status(200).json({ success: true, message: "Student updated successfully." });
    } catch (txError) {
      await session.endSession();
      console.log(txError);
      return res.status(500).json({
        success: false,
        error: txError?.message || "update students server error",
      });
    }
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, error: "update students server error" });
  }
};

const promoteStudent = async (req, res) => {
  const { id } = req.params;

  const {
    instituteId1, instituteId2, instituteId3, instituteId4, instituteId5,
    courseId1, courseId2, courseId3, courseId4, courseId5,
    fees1, fees2, fees3, fees4, fees5,
    discount1, discount2, discount3, discount4, discount5,
    status1, status2, status3, status4, status5,
    year1, year2, year3, year4, year5,
    refNumber1, refNumber2, refNumber3, refNumber4, refNumber5,
  } = req.body || {};

  try {
    // ---------------- Auth ----------------
    const auth = req.headers.authorization || "";
    const parts = auth.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return res.status(401).json({ success: false, error: "Unauthorized Request" });
    }

    const decoded = jwt.verify(parts[1], process.env.JWT_SECRET);
    const userId = decoded._id;
    const userRole = decoded.role;

    if (!["superadmin", "hquser", "supervisor", "admin"].includes(userRole)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const student = await Student.findById(id).select("_id userId schoolId").lean();
    if (!student?._id) {
      return res.status(404).json({ success: false, error: "Student not found" });
    }

    // ---------------- Academic year (ACTIVE) ----------------
    const redis = await getRedis();
    let academicYears = [];
    try {
      const cached = await redis.get("academicYears");
      academicYears = cached ? JSON.parse(cached) : [];
    } catch {
      academicYears = [];
    }

    // ✅ FIX: your DB select should match your actual AcademicYear schema fields
    // Most of your code uses { acYear: "2024-2025", status: "Active" }
    if (!Array.isArray(academicYears) || academicYears.length === 0) {
      academicYears = await AcademicYear.find().select("_id acYear status").lean();
    }

    const activeYear = academicYears.find((a) => String(a.status) === "Active") || academicYears[0];
    if (!activeYear?._id) {
      return res.status(400).json({ success: false, error: "Academic year not configured" });
    }

    // ✅ FIX: keep it ObjectId (do NOT String() it)
    const promoteAcYearId = '68612e92eeebf699b9d34a21';//2025-2026;

    // Prevent double promotion
    const already = await Academic.findOne({ studentId: student._id, acYear: promoteAcYearId })
      .select("_id")
      .lean();

    if (already?._id) {
      return res.status(400).json({ success: false, error: "Already promoted for this Academic Year" });
    }

    // ---------------- Build nextPayload ----------------
    const nextPayload = {
      instituteId1, courseId1, fees1, discount1, status1, year1: Number(year1 || 0),
      instituteId2, courseId2, fees2, discount2, status2, year2: Number(year2 || 0),
      instituteId3, courseId3, fees3, discount3, status3, year3: Number(year3 || 0),
      instituteId4, courseId4, fees4, discount4, status4, year4: Number(year4 || 0),
      instituteId5, courseId5, fees5, discount5, status5, year5: Number(year5 || 0),
    };

    // ✅ slots includes safe parsed numbers (fees/discount/finalFees)
    const slots = buildAcademicSlotsFromPayload(nextPayload);

    // Build academic doc
    const academicDocToCreate = { studentId: student._id, acYear: promoteAcYearId };

    let totalFees = 0;

    for (const s of slots) {
      const st = String(nextPayload[`status${s.i}`] || "");
      const y = Number(nextPayload[`year${s.i}`] || 0);

      if (!s.instituteId || !s.courseId) continue;
      if (st === "Completed") continue;

      const nextYear = st === "Not-Promoted" ? y : Math.max(y + 1, 1);

      academicDocToCreate[`instituteId${s.i}`] = s.instituteId;
      academicDocToCreate[`courseId${s.i}`] = s.courseId;

      // ✅ FIX: keep numeric values already parsed in slots
      academicDocToCreate[`fees${s.i}`] = Number(s.fees || 0);
      academicDocToCreate[`discount${s.i}`] = Number(s.discount || 0);
      academicDocToCreate[`finalFees${s.i}`] = Number(s.finalFees || 0);

      // ✅ keep refNumber from UI if provided
      const refVal = req.body?.[`refNumber${s.i}`];
      if (refVal !== undefined) academicDocToCreate[`refNumber${s.i}`] = refVal;

      academicDocToCreate[`status${s.i}`] = "Admission";
      academicDocToCreate[`year${s.i}`] = nextYear;

      totalFees += Number(s.finalFees || 0);
    }

    // If nothing to promote, return early
    const hasAnySlot = Object.keys(academicDocToCreate).some((k) => k.startsWith("courseId"));
    if (!hasAnySlot) {
      return res.status(400).json({ success: false, error: "No valid course slots to promote" });
    }

    const session = await mongoose.startSession();

    try {
      const createdInvoiceIds = [];

      await session.withTransaction(async () => {
        // 1) Create Academic
        const created = await Academic.create([academicDocToCreate], { session });
        const createdAcademic = created?.[0];

        if (!createdAcademic?._id) throw new Error("Failed to create academic (promotion)");

        // 3) Upsert Account as FEES DUE (not paid)
        if (Number(totalFees) > 0) {
          await upsertFeesDueAccount({
            userId: student.userId,
            acYear: promoteAcYearId,
            academicId: createdAcademic._id,
            fees: totalFees,
            receiptLabel: "Promote",     // ✅ FIX: correct param name
            remarks: "Promoted",
            session,
          });
        }

        // 4) Create invoices for each promoted slot
        for (const s of slots) {
          const st = String(nextPayload[`status${s.i}`] || "");

          if (!s.instituteId || !s.courseId) continue;
          if (st === "Completed") continue;

          const slotFees = Number(s.finalFees || 0);
          if (!Number.isFinite(slotFees) || slotFees <= 0) continue;

          const inv = await createFeesInvoiceSafe({
            schoolId: student.schoolId,
            studentId: student._id,
            userId: student.userId,
            acYear: promoteAcYearId,
            academicId: createdAcademic._id,
            courseId: s.courseId,
            totalFees: slotFees,
            source: "COURSE_CHANGE",      // or "ADMISSION" if you want
            createdBy: userId,            // ✅ FIX: always defined
            session,
          });

          if (inv?._id) createdInvoiceIds.push(String(inv._id));
        }

        // ✅ Optional strictness: If you want promotion to FAIL if no invoice is created
        // if (createdInvoiceIds.length === 0 && Number(totalFees) > 0) {
        //   throw new Error("Promotion created Academic/Account but no invoices were generated");
        // }
      });

      return res.status(200).json({
        success: true,
        message: "Student promoted successfully",
        createdInvoices: createdInvoiceIds,
      });
    } catch (txErr) {
      console.log("[promoteStudent] TX error:", txErr);
      return res.status(500).json({
        success: false,
        error: txErr?.message || "Promotion failed",
      });
    } finally {
      await session.endSession();
    }
  } catch (error) {
    console.log("[promoteStudent] error:", error);
    return res.status(500).json({ success: false, error: "promote student server error" });
  }
};

const deleteStudent = async (req, res) => {
  try {
    const { id } = req.params;

    const deleteStudent = await Student.findById({ _id: id });

    await Student.findByIdAndUpdate({ _id: deleteStudent._id }, {
      active: "In-Active",
      remarks: "Deleted",
    })

    const redis = await getRedis();
    await redis.set('totalStudents', await Student.countDocuments());

    console.log("Student data Successfully Deleted...")

    return res.status(200).json({ success: true, message: "Successfully deleted" })
  } catch (error) {
    console.log(error)
    return res.status(500).json({ success: false, error: "delete Student server error" })
  }
}

const isObjectId = (v) => /^[a-fA-F0-9]{24}$/.test(String(v || ""));

const removeStudents = async (req, res) => {
  try {
    // ✅ role check (adjust to your policy)
    const role = req.user?.role;
    if (!["superadmin", "hquser"].includes(role)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const { studentIds } = req.body;

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "studentIds is required (non-empty array)",
      });
    }

    const invalidIds = studentIds.filter((id) => !isObjectId(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid studentIds: ${invalidIds.join(", ")}`,
      });
    }

    const uniqueStudentIds = [...new Set(studentIds.map(String))];

    const session = await mongoose.startSession();

    let summary = null;

    await session.withTransaction(async () => {
      // 1) Load Students to get their userIds
      const students = await Student.find({ _id: { $in: uniqueStudentIds } })
        .select("_id userId")
        .session(session)
        .lean();

      if (!students || students.length === 0) {
        throw new Error("No students found for provided studentIds");
      }

      const foundStudentIds = students.map((s) => String(s._id));
      const userIds = [...new Set(students.map((s) => String(s.userId)).filter(Boolean))];

      // 2) Fetch invoiceIds for those students
      const invoiceDocs = await FeeInvoice.find({ studentId: { $in: foundStudentIds } })
        .select("_id")
        .session(session)
        .lean();
      const invoiceIds = invoiceDocs.map((d) => d._id);

      // 3) Find batchItems linked to studentIds and/or invoiceIds
      const batchItemQuery = {
        $or: [
          { studentId: { $in: foundStudentIds } },
          ...(invoiceIds.length ? [{ invoiceId: { $in: invoiceIds } }] : []),
        ],
      };

      const batchItems = await PaymentBatchItem.find(batchItemQuery)
        .select("_id batchId")
        .session(session)
        .lean();

      const batchItemIds = batchItems.map((x) => x._id);
      const touchedBatchIds = [...new Set(batchItems.map((x) => String(x.batchId)).filter(Boolean))];

      // 4) Delete children first
      const delBatchItems = batchItemIds.length
        ? await PaymentBatchItem.deleteMany({ _id: { $in: batchItemIds } }).session(session)
        : { deletedCount: 0 };

      const delInvoices = await FeeInvoice.deleteMany({ studentId: { $in: foundStudentIds } }).session(session);

      const delAccounts = await Account.deleteMany({ userId: { $in: userIds } }).session(session);

      const delAcademics = await Academic.deleteMany({ studentId: { $in: foundStudentIds } }).session(session);

      const delStudents = await Student.deleteMany({ _id: { $in: foundStudentIds } }).session(session);

      const delUsers = await User.deleteMany({ _id: { $in: userIds } }).session(session);

      // 5) Delete ONLY empty batches after removing items
      let deletedBatches = 0;

      for (const bid of touchedBatchIds) {
        if (!isObjectId(bid)) continue;

        const remaining = await PaymentBatchItem.countDocuments({ batchId: bid }).session(session);
        if (remaining === 0) {
          const delBatch = await PaymentBatch.deleteOne({ _id: bid }).session(session);
          deletedBatches += delBatch?.deletedCount || 0;
        }
      }

      summary = {
        requestedStudentIds: uniqueStudentIds.length,
        foundStudents: foundStudentIds.length,
        deleted: {
          paymentBatchItems: delBatchItems?.deletedCount || 0,
          feeInvoices: delInvoices?.deletedCount || 0,
          accounts: delAccounts?.deletedCount || 0,
          academics: delAcademics?.deletedCount || 0,
          students: delStudents?.deletedCount || 0,
          users: delUsers?.deletedCount || 0,
          paymentBatches: deletedBatches,
        },
      };
    });

    return res.status(200).json({
      success: true,
      message: "Bulk student removal completed.",
      summary,
    });
  } catch (e) {
    console.log("[removeStudentsCascadeBulk] error:", e);
    return res.status(500).json({ success: false, error: e.message || "server error" });
  }
};

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

// Find the slot index (1..5) where this courseId exists
const findCourseSlotIndex = (academicDoc, courseId) => {
  if (!academicDoc) return null;
  for (let i = 1; i <= 5; i++) {
    const cid = academicDoc[`courseId${i}`];
    if (cid && String(cid) === String(courseId)) return i;
  }
  return null;
};

// Sum finalFees1..5 to compute Account due total
const computeTotalFeesFromAcademic = (acad) => {
  let sum = 0;
  for (let i = 1; i <= 5; i++) {
    const ff = Number(acad?.[`finalFees${i}`] ?? 0);
    if (Number.isFinite(ff) && ff > 0) sum += ff;
  }
  return sum;
};

/**
 * GET /students/promote/candidates/:schoolId/:targetAcYear/:courseId
 * Returns students eligible to promote for the given course (only).
 */
/**export const listPromoteCandidates = async (req, res) => {
  try {
    console.log("listPromoteCandidates")

    const role = req.user?.role;
    if (!["superadmin", "hquser", "admin"].includes(role)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const { schoolId, targetAcYear, courseId } = req.params;
    console.log("AC Year : " + targetAcYear)
    if (!isObjectId(schoolId) || !isObjectId(targetAcYear) || !isObjectId(courseId)) {
      return res.status(400).json({ success: false, error: "Invalid params" });
    }

    // Students in school (active only)
    const students = await Student.find({ schoolId: schoolId, active: "Active", feesPaid: 1 })
      .select("_id userId rollNumber feesPaid")
      .populate({ path: "userId", select: "name" })
      .lean();

    if (!students.length) return res.status(200).json({ success: true, students: [] });

    const studentIds = students.map((s) => s._id);

    // Latest academic containing course for each student (any year)
    const academics = await Academic.find({
      studentId: { $in: studentIds },
      $or: [
        { courseId1: courseId },
        { courseId2: courseId },
        { courseId3: courseId },
        { courseId4: courseId },
        { courseId5: courseId },
      ],
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .select(
        "_id studentId acYear courseId1 courseId2 courseId3 courseId4 courseId5 year1 year2 year3 year4 year5 status1 status2 status3 status4 status5"
      )
      .lean();

    const latestByStudent = new Map();
    for (const a of academics) {
      const k = String(a.studentId);
      if (!latestByStudent.has(k)) latestByStudent.set(k, a);
    }

    // Students already promoted for this course in target year
    const alreadyTarget = await Academic.find({
      studentId: { $in: studentIds },
      acYear: targetAcYear,
      $or: [
        { courseId1: courseId },
        { courseId2: courseId },
        { courseId3: courseId },
        { courseId4: courseId },
        { courseId5: courseId },
      ],
    })
      .select("studentId")
      .lean();

    const alreadySet = new Set(alreadyTarget.map((a) => String(a.studentId)));

    const out = [];
    for (const s of students) {
      const a = latestByStudent.get(String(s._id));
      if (!a) continue; // student never had this course
      if (alreadySet.has(String(s._id))) continue; // already promoted for this course in target year

      const slot = findCourseSlotIndex(a, courseId);
      const fromYear = slot ? Number(a[`year${slot}`] || 0) : 0;
      const fromStatus = slot ? String(a[`status${slot}`] || "") : "";

      out.push({
        studentId: s._id,
        rollNumber: s.rollNumber,
        name: s.userId?.name || "-",
        feesPaid: Number(s.feesPaid || 0),
        fromAcYearId: a.acYear,
        fromSlot: slot,
        fromYear,
        fromStatus,
      });
    }

    return res.status(200).json({ success: true, students: out });
  } catch (e) {
    console.log(e);
    return res.status(e.status || 500).json({ success: false, error: e.message || "server error" });
  }
};*/
export const listPromoteCandidates = async (req, res) => {
  try {
    console.log("listPromoteCandidates");
    const role = req.user?.role;
    if (!["superadmin", "hquser", "admin"].includes(role)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const { schoolId, targetAcYear, courseId } = req.params;

    if (!isObjectId(schoolId) || !isObjectId(targetAcYear) || !isObjectId(courseId)) {
      return res.status(400).json({ success: false, error: "Invalid params" });
    }

    const currentYear = await AcademicYear.findOne({ active: "Active" })
      .select("_id acYear active")
      .lean();

    if (!currentYear?._id) {
      return res.status(400).json({ success: false, error: "Current Academic Year (Active) not configured" });
    }
    const currentAcYearId = String(currentYear._id);

    const students = await Student.find({ schoolId, active: "Active", feesPaid: 1 })
      .select("_id userId rollNumber feesPaid")
      .populate({ path: "userId", select: "name" })
      .lean();

    if (!students.length) return res.status(200).json({ success: true, students: [] });

    const studentIds = students.map((s) => s._id);

    const academics = await Academic.find({
      studentId: { $in: studentIds },
      acYear: currentAcYearId,
      $or: [
        { courseId1: courseId },
        { courseId2: courseId },
        { courseId3: courseId },
        { courseId4: courseId },
        { courseId5: courseId },
      ],
    })
      .select(
        "_id studentId acYear courseId1 courseId2 courseId3 courseId4 courseId5 year1 year2 year3 year4 year5 status1 status2 status3 status4 status5"
      )
      .lean();

    // Map: studentId -> currentYear academic
    const byStudent = new Map(academics.map((a) => [String(a.studentId), a]));

    // Students already promoted for this course in TARGET year
    const alreadyTarget = await Academic.find({
      studentId: { $in: studentIds },
      acYear: targetAcYear,
      $or: [
        { courseId1: courseId },
        { courseId2: courseId },
        { courseId3: courseId },
        { courseId4: courseId },
        { courseId5: courseId },
      ],
    })
      .select("studentId")
      .lean();

    const alreadySet = new Set(alreadyTarget.map((a) => String(a.studentId)));

    const out = [];
    for (const s of students) {
      const a = byStudent.get(String(s._id));
      if (!a) continue;
      if (alreadySet.has(String(s._id))) continue;

      const slot = findCourseSlotIndex(a, courseId);
      if (!slot) continue;

      const fromStatus = String(a[`status${slot}`] || "");
      if (fromStatus === "Completed") continue;

      out.push({
        studentId: s._id,
        rollNumber: s.rollNumber,
        name: s.userId?.name || "-",
        feesPaid: Number(s.feesPaid || 0),
        fromAcYearId: a.acYear,
        fromSlot: slot,
        fromYear: Number(a[`year${slot}`] || 0),
        fromStatus,
      });
    }

    return res.status(200).json({
      success: true,
      currentAcYearId,
      currentAcYear: currentYear.acYear,
      students: out,
    });
  } catch (e) {
    console.log(e);
    return res.status(e.status || 500).json({ success: false, error: e.message || "server error" });
  }
};

/**
 * POST /students/promote/bulk
 * policy: PROMOTE | NOT_PROMOTE | COMPLETE
 * - PROMOTE/NOT_PROMOTE: create invoice for course fees
 * - COMPLETE: no course fees invoice; create certificate print invoice only
 */
export const promoteStudentsBulkByCourse = async (req, res) => {
  let session = null;

  try {
    const role = req.user?.role;
    if (!["superadmin", "hquser", "admin"].includes(role)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const {
      schoolId,
      targetAcYear,
      courseId,
      studentIds,
      policy = "PROMOTE", // PROMOTE | NOT_PROMOTE | COMPLETE
      requireFeesPaid = true,
      chunkSize = 10,
      certificateFee = 50, // ✅ for COMPLETE (default)
    } = req.body || {};

    console.log("Called : promoteStudentsBulkByCourse")
    if (!isObjectId(schoolId) || !isObjectId(targetAcYear) || !isObjectId(courseId)) {
      return res.status(400).json({ success: false, error: "Invalid schoolId / targetAcYear / courseId" });
    }
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ success: false, error: "studentIds required" });
    }

    const uniqueIds = [...new Set(studentIds.map(String))].filter(isObjectId);

    const chunk = (arr, size) => {
      const out = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };

    const chunks = chunk(uniqueIds, Math.max(1, Number(chunkSize || 10)));

    const summary = {
      requested: uniqueIds.length,
      promoted: 0,
      skipped: 0,
      errors: [],
    };
    console.log("Called 2")
    const course = await Course.findById(courseId).select("_id name type").lean();

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const idsChunk = chunks[chunkIndex];

      session = await mongoose.startSession();

      try {
        await session.withTransaction(async () => {
          const students = await Student.find({ _id: { $in: idsChunk }, schoolId })
            .select("_id userId schoolId feesPaid active")
            .session(session)
            .lean();

          const studentMap = new Map(students.map((s) => [String(s._id), s]));

          for (const sid of idsChunk) {
            const st = studentMap.get(String(sid));

            if (!st) {
              summary.errors.push({ studentId: sid, reason: "Student not found in this school" });
              continue;
            }
            if (String(st.active) !== "Active") {
              summary.skipped++;
              continue;
            }

            // ✅ For COMPLETE, you may want to allow even if fees not paid previously.
            // If you want strict rule even for COMPLETE, remove this "policy !== COMPLETE" condition.
            if (requireFeesPaid && policy !== "COMPLETE" && Number(st.feesPaid || 0) !== 1) {
              summary.skipped++;
              continue;
            }

            // Latest academic containing this course
            const sourceAcad = await Academic.findOne({
              studentId: sid,
              $or: [
                { courseId1: courseId },
                { courseId2: courseId },
                { courseId3: courseId },
                { courseId4: courseId },
                { courseId5: courseId },
              ],
            })
              .sort({ updatedAt: -1, createdAt: -1 })
              .session(session)
              .lean();

            if (!sourceAcad) {
              summary.skipped++;
              continue;
            }

            const srcSlot = findCourseSlotIndex(sourceAcad, courseId);
            if (!srcSlot) {
              summary.skipped++;
              continue;
            }

            const srcStatus = String(sourceAcad[`status${srcSlot}`] || "");
            if (srcStatus === "Completed") {
              summary.skipped++;
              continue;
            }

            // Target academic upsert (so other courses can be promoted later)
            const targetFilter = { studentId: sid, acYear: targetAcYear };

            let targetDoc = await Academic.findOne(targetFilter).session(session);
            if (!targetDoc) {
              targetDoc = new Academic({ studentId: sid, acYear: targetAcYear });
            }

            // Already has this course in target year -> skip (unless policy COMPLETE wants to mark complete again)
            const alreadyInTarget = findCourseSlotIndex(targetDoc, courseId);
            if (alreadyInTarget) {
              summary.skipped++;
              continue;
            }

            // Destination slot: prefer same slot, else first empty
            let destSlot = srcSlot;
            const existingCourseAtDest = targetDoc[`courseId${destSlot}`];

            if (existingCourseAtDest && String(existingCourseAtDest) !== String(courseId)) {
              destSlot = null;
              for (let i = 1; i <= 5; i++) {
                if (!targetDoc[`courseId${i}`]) {
                  destSlot = i;
                  break;
                }
              }
              if (!destSlot) {
                summary.errors.push({ studentId: sid, reason: "No empty course slot in target academic" });
                continue;
              }
            }

            const srcYear = Number(sourceAcad[`year${srcSlot}`] || 0);

            // ✅ Decide year based on policy
            const nextYear =
              policy === "NOT_PROMOTE"
                ? Math.max(srcYear, 1)
                : Math.max(srcYear + 1, 1); // PROMOTE or COMPLETE -> next year

            // Copy slot values
            targetDoc[`instituteId${destSlot}`] = sourceAcad[`instituteId${srcSlot}`] || null;
            targetDoc[`courseId${destSlot}`] = courseId;
            targetDoc[`refNumber${destSlot}`] = sourceAcad[`refNumber${srcSlot}`] || "";

            if (policy === "COMPLETE") {
              // ✅ COMPLETE: no course fee, mark completed
              targetDoc[`fees${destSlot}`] = 0;
              targetDoc[`discount${destSlot}`] = 0;
              targetDoc[`finalFees${destSlot}`] = 0;
              targetDoc[`status${destSlot}`] = "Completed";
              targetDoc[`year${destSlot}`] = nextYear;
            } else {
              // ✅ PROMOTE / NOT_PROMOTE: normal admission + fees
              targetDoc[`fees${destSlot}`] = Number(sourceAcad[`fees${srcSlot}`] || 0);
              targetDoc[`discount${destSlot}`] = Number(sourceAcad[`discount${srcSlot}`] || 0);
              targetDoc[`finalFees${destSlot}`] = Number(sourceAcad[`finalFees${srcSlot}`] || 0);
              targetDoc[`status${destSlot}`] = "Admission";
              targetDoc[`year${destSlot}`] = nextYear;
            }

            await targetDoc.save({ session });

            // ✅ Account due update
            // - PROMOTE/NOT_PROMOTE: include course fees (finalFees)
            // - COMPLETE: do NOT include course fee (it is 0), but if certificateFee > 0, we should set dues for certificate
            const totalFees = computeTotalFeesFromAcademic(targetDoc);
            const certFeeNum = Number(certificateFee || 0);
            const certDue = policy === "COMPLETE" && Number.isFinite(certFeeNum) && certFeeNum > 0 ? certFeeNum : 0;

            const totalDue = totalFees + certDue;

            if (totalDue > 0) {
              await upsertFeesDueAccount({
                userId: st.userId,
                schoolId: st.schoolId,
                acYear: targetAcYear,
                academicId: targetDoc._id,
                fees: totalDue,
                receiptLabel: policy === "COMPLETE" ? "Certificate" : "Promote",
                remarks:
                  policy === "COMPLETE"
                    ? `Certificate Print Fee: ${course?.name || "Course"}`
                    : `Promoted: ${course?.name || "Course"}`,
                session,
              });
            }

            // ✅ Invoice creation
            if (policy === "COMPLETE") {
              // Create certificate invoice ONLY (avoid duplicates)
              const certFee = Number(certificateFee || 0);
              if (Number.isFinite(certFee) && certFee > 0) {
                const existingCertInvoice = await FeeInvoice.findOne({
                  studentId: sid,
                  acYear: targetAcYear,
                  courseId,
                  source: "CERTIFICATE",
                  status: { $in: ["ISSUED", "PARTIAL"] },
                })
                  .select("_id")
                  .session(session)
                  .lean();

                if (!existingCertInvoice) {
                  // use fallback invoice with one head by passing totalFees and a special source
                  await createFeesInvoiceSafe({
                    schoolId: st.schoolId,
                    studentId: sid,
                    userId: st.userId,
                    acYear: targetAcYear,
                    academicId: targetDoc._id,
                    courseId,
                    totalFees: certFee,
                    source: "CERTIFICATE",
                    createdBy: req.user?._id || st.userId,
                    session,
                  });
                }
              }
            } else {
              // PROMOTE / NOT_PROMOTE: create course fee invoice (avoid duplicates)
              const existingInvoice = await FeeInvoice.findOne({
                studentId: sid,
                acYear: targetAcYear,
                courseId,
                source: { $ne: "CERTIFICATE" },
                status: { $in: ["ISSUED", "PARTIAL"] },
              })
                .select("_id")
                .session(session)
                .lean();

              if (!existingInvoice) {
                const slotFees = Number(targetDoc[`finalFees${destSlot}`] || 0);
                if (Number.isFinite(slotFees) && slotFees > 0) {
                  await createFeesInvoiceSafe({
                    schoolId: st.schoolId,
                    studentId: sid,
                    userId: st.userId,
                    acYear: targetAcYear,
                    academicId: targetDoc._id,
                    courseId,
                    totalFees: slotFees,
                    source: "PROMOTE",
                    createdBy: req.user?._id || st.userId,
                    session,
                  });
                }
              }
            }

            // ✅ If new due exists, mark as unpaid
            // (You commented earlier; enable it now)
            //if (totalDue > 0) {
            //  await Student.updateOne({ _id: sid }, { $set: { feesPaid: 0 } }, { session });
            //}

            summary.promoted++;
          }
        });
      } catch (chunkErr) {
        console.log(`[promoteStudentsBulkByCourse] chunk ${chunkIndex + 1} failed:`, chunkErr);
        for (const sid of idsChunk) {
          summary.errors.push({ studentId: sid, reason: chunkErr?.message || "Chunk failed" });
        }
      } finally {
        await session.endSession();
        session = null;
      }
    }

    return res.status(200).json({ success: true, summary });
  } catch (e) {
    console.log(e);
    return res.status(e.status || 500).json({ success: false, error: e.message || "server error" });
  } finally {
    if (session) await session.endSession();
  }
};

export {
  addStudent, upload, getStudents, getStudent, updateStudent, deleteStudent, getStudentForEdit,
  getAcademic, getStudentsBySchool, getStudentsBySchoolAndTemplate, getStudentsCount, importStudentsData,
  getStudentForPromote, promoteStudent, getByFilter, markFeesPaid, removeStudents
};
