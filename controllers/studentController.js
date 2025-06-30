import multer from "multer";
import { put } from "@vercel/blob";
import Student from "../models/Student.js";
import User from "../models/User.js";
import School from "../models/School.js";
import Academic from "../models/Academic.js";
import Template from "../models/Template.js";
import AcademicYear from "../models/AcademicYear.js";
import Account from "../models/Account.js";
import Numbering from "../models/Numbering.js";
import bcrypt from "bcrypt";
import redisClient from "../db/redis.js"
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
      district,
      state,

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
      district: toCamelCase(district),
      state: toCamelCase(state),
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
      userId: savedStudent._id,
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

  console.log("Import student data - start");

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
        console.log("Skipped")
        continue;
      }

      // Create User.
      const hashPassword = await bcrypt.hash(studentData.rollNumber, 10);
      const newUser = new User({
        name: studentData.name,
        email: studentData.rollNumber,
        password: hashPassword,
        role: "student",
        profileImage: "",
      });

      savedUser = await newUser.save();
      if (!savedUser) {
        finalResultData += "\nRow : " + row + ", User registration failed. \n";
        resultData = "";
        row++;
        continue;
      }

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
        address: "-",
        district: "-",
        state: "-",
        hostel: "No",
        active: studentData.course ? "Active" : "Graduated",
        courses: ["-"]
      });

      savedStudent = await newStudent.save();
      if (!savedStudent) {
        finalResultData += "\nRow : " + row + ", Student registration failed.";
        resultData = "";
        row++;
        continue;
      }

      const courses = JSON.parse(await redisClient.get('courses'));
      let courseId = "680cf72e79e49fb103ddb97c";
      if (studentData.course) {
        courseId = courses.filter(course => course.name === studentData.course).map(course => course._id);
        console.log("courseId - " + courseId)
        if (!courseId) {
          finalResultData += "\nRow : " + row + ", Course not found. Course Name : " + studentData.course;
          resultData = "";
          row++;
          continue;
        }
      }

      const instituteId = "67fbba7bcd590bacd4badef0";

      let yearCount = studentData.year;
      if (studentData.course === "Makthab") {
        yearCount = 1;
      }

      let currentAcademicId;
      let accYearId = "680485d9361ed06368c57f7c";
      for (let i = 0; i < yearCount; i++) {

        if (i == 1) {
          accYearId = "68039133200583d3d5c01faf";
        } if (i == 2) {
          accYearId = "6803911e200583d3d5c01fa9";
        }

        const newAcademic = new Academic({
          studentId: savedStudent._id,
          acYear: accYearId,
          instituteId1: instituteId,
          courseId1: courseId,
          refNumber1: studentData.rollNumber,
          year: studentData.year,
          fees1: studentData.fees,
          finalFees1: studentData.fees,
        });

        savedAcademic = await newAcademic.save();
        if (!savedAcademic) {
          finalResultData += "\nRow : " + row + ", Student Academic registration failed. AC year : " + accYearId;
          resultData = "";
          row++;
          continue;
        }

        if (i == 0) {
          currentAcademicId = savedAcademic._id;
        }
      }

      const newAccount = new Account({
        userId: savedStudent._id,
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
        continue;
      }

      const coursesArray = [courseId];
      await Student.findByIdAndUpdate({ _id: savedStudent._id }, { courses: coursesArray });

      finalResultData += "\nRow : " + row + ", RollNumber : " + studentData.rollNumber + ", Imported Successfully!";
      row++;
    }


    //  let tempFilePath = path.join('/tmp', 'Import_data_Result.txt');
    //  fs.writeFileSync(tempFilePath, finalResultData);

    console.log("Import student data - end NORMAL \n" + finalResultData);
    return res.status(200)
      .json({ success: true, message: "Students data Imported.", finalResultData: finalResultData });

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

const getStudents = async (req, res) => {
  try {
    console.log("getStudents called : ");

    const students = await Student.find().sort({ 'schoolId.code': 1, rollNumber: 1 })
      .populate("userId", { password: 0, profileImage: 0 })
      .populate("schoolId");
    //  console.log(students);
    return res.status(200).json({ success: true, students });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get students List server error" });
  }
};

const getStudentsBySchool = async (req, res) => {

  const { schoolId } = req.params;

  console.log("getStudentsBySchool : " + schoolId);
  try {
    const students = await Student.find({ schoolId: schoolId }).sort({ rollNumber: 1 })
      .populate("userId", { password: 0, profileImage: 0 })
      .populate("courses");

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
      $or: [{ 'courseId1': template.courseId }, { 'courseId2': template.courseId }, { 'courseId3': template.courseId }, { 'courseId4': template.courseId }, { 'courseId5': template.courseId }]
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
      .populate("schoolId");
    return res.status(200).json({ success: true, students });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get active students server error" });
  }
};

const getStudent = async (req, res) => {
  const { id } = req.params;

  console.log("getStudent : " + id);

  try {
    let student = await Student.findById({ _id: id })
      .populate("userId", { password: 0 })
      .populate("schoolId");

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

    if (!academics) {
      return res
        .status(404)
        .json({ success: false, error: "Academic details Not found : " + studentId + ", " + accYear });
    }

    student._academics = academics;
    student.toObject({ virtuals: true });

    return res.status(200).json({ success: true, student });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get student by ID server error" });
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
      .populate("userId", { password: 0 })
      .populate("schoolId");

    if (!student) {
      return res
        .status(404)
        .json({ success: false, error: "Student data not found." });
    }

    let accYear;
    if (new Date().getMonth() + 1 >= 4) {
      accYear = new Date().getFullYear() + "-" + (new Date().getFullYear() + 1);
    }

    const academicYears = JSON.parse(await redisClient.get('academicYears'));
    let accYearId = academicYears.filter(acYear => acYear.acYear === accYear).map(acYear => acYear._id);

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

    if (!academics) {
      accYear = (new Date().getFullYear() - 1) + "-" + new Date().getFullYear();
      accYearId = academicYears.filter(acYear => acYear.acYear === accYear).map(acYear => acYear._id);

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

      if (!academics) {
        return res
          .status(404)
          .json({ success: false, error: "Academic details Not found : " + student._id + ", " + accYear });
      }
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
      district,
      state,

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
      schoolId, doa,
      dob,
      gender,
      maritalStatus,
      motherTongue,
      bloodGroup: toCamelCase(bloodGroup),
      idMark1: toCamelCase(idMark1),
      idMark2: toCamelCase(idMark2),
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
      district: toCamelCase(district),
      state: toCamelCase(state),
      hostel,
      hostelRefNumber,
      hostelFees,
      hostelDiscount,
      hostelFinalFees: hostelFinalFeesVal,
      active,
      remarks: toCamelCase(remarks),
    })

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
      return res
        .status(404)
        .json({ success: false, error: "Academic Data Not exists" });
    }

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

    const updateAccount = await Account.findOne({ userId: updateStudent._id, acYear: acYear, academicId: updateAcademic._id });
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


    if (!updateStudent || !updateUser || !updateAcademicById) {
      return res
        .status(404)
        .json({ success: false, error: "document not found" });
    }

    return res.status(200).json({ success: true, message: "Student update done" })

  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "update students server error" });
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

{/*const fetchStudentsByDepId = async (req, res) => {
  const { id } = req.params;
  try {
    const students = await Student.find({ department: id })
    return res.status(200).json({ success: true, students });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get studentsbyDepId server error" });
  }
}*/}

export {
  addStudent, upload, getStudents, getStudent, updateStudent, deleteStudent,
  getAcademic, getStudentsBySchool, getStudentsBySchoolAndTemplate, getStudentsCount, importStudentsData,
  getStudentForPromote
};
