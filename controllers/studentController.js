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
import FeeInvoice from "../models/FeeInvoice.js";
import Numbering from "../models/Numbering.js";
import bcrypt from "bcrypt";
import getRedis from "../db/redis.js"
import { toCamelCase, getNextNumber, createInvoiceFromStructure } from "./commonController.js";

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
      createdBy: req.user?._id,
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
            createdBy: req.user?._id,
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

        // ✅ Fees Due (do NOT mark paid here)
        const accountUpdate = {
          receiptNumber: "Admission",
          type: "fees",
          fees: totalFees,
          paidDate: null,
          balance: totalFees,
          remarks: "Admission-updated",
        };

        const accountDoc = await Account.findOneAndUpdate(
          accountFilter,
          { $set: accountUpdate },
          { new: true, upsert: true, session }
        );

        if (!accountDoc?._id) throw new Error("Failed to upsert account");

        // ✅ Create a new invoice only if fees/course changed (prevents duplicates on profile-only updates)
        try {
          const prevFees = Number(accountDoc?.fees || 0);
          const feesChanged = Math.round(prevFees * 100) !== Math.round(Number(totalFees) * 100);

          const prevCourseId = String(academicDoc?.courseId1 || "");
          const newCourseId = String(courseId1 || prevCourseId);
          const courseChanged = prevCourseId && newCourseId && prevCourseId !== newCourseId;

          if (feesChanged || courseChanged) {
            await createFeesInvoiceSafe({
              schoolId: schoolId,
              studentId: student._id,
              userId: student.userId,
              acYear: academicYearById._id,
              academicId: academicDoc._id,
              courseId: newCourseId || prevCourseId,
              totalFees,
              source: "COURSE_CHANGE",
              createdBy: req.user?._id,
              session,
            });
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

  //console.log("promoteStudent")
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

    //console.log("School Id : " + student.schoolId)
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

    //console.log("ACYear-1 : " + accYear + ", ACYearId-1:" + accYearId)
    if (accYearId == null || accYearId == "") {
      accYear = (new Date().getFullYear() - 1) + "-" + new Date().getFullYear();
      accYearId = academicYears.filter(acYear => acYear.acYear === accYear).map(acYear => acYear._id);
      //console.log("ACYear-2 : " + accYear + ", ACYearId-2:" + accYearId)
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

      //console.log(academicModal);
      const newAcademic = new Academic(academicModal)
      updateAcademic = await newAcademic.save();

      let totalFees = (finalFees1Val && status1 != "Completed" ? finalFees1Val : 0)
        + (finalFees2Val && status2 != "Completed" ? finalFees2Val : 0)
        + (finalFees3Val && status3 != "Completed" ? finalFees3Val : 0)
        + (finalFees4Val && status4 != "Completed" ? finalFees4Val : 0)
        + (finalFees5Val && status5 != "Completed" ? finalFees5Val : 0);

      // ✅ Fees Due: create/update Account (payment will be done via Batch + HQ approval)
      savedAccount = await upsertFeesDueAccount({
        userId: student.userId,
        acYear: academicYearById._id,
        academicId: savedAcademic._id,
        fees: totalFees,
        receiptLabel: "Promote",
        remarks: "Promote",
        session,
      });

      // ✅ Create Fees Invoice for promotion (due)
      await createFeesInvoiceSafe({
        schoolId: student.schoolId,
        studentId: student._id,
        userId: student.userId,
        acYear: academicYearById._id,
        academicId: savedAcademic._id,
        courseId: courseId1,
        totalFees,
        source: "COURSE_CHANGE",
        createdBy: req.user?._id,
        session,
      });
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
