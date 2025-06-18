import multer from "multer";
import { put } from "@vercel/blob";
import Student from "../models/Student.js";
import User from "../models/User.js";
import School from "../models/School.js";
import Academic from "../models/Academic.js";
import Template from "../models/Template.js";
import AcademicYear from "../models/AcademicYear.js";
import Account from "../models/Account.js";
import bcrypt from "bcrypt";

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
      rollNumber,
      doa,
      dob,
      gender,
      maritalStatus,
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

      hostel,
      hostelRefNumber,
      hostelFees,
      hostelDiscount,

      acYear,

      instituteId1,
      courseId1,
      refNumber1,
      fees1,
      discount1,

      instituteId2,
      courseId2,
      refNumber2,
      fees2,
      discount2,

      instituteId3,
      courseId3,
      refNumber3,
      fees3,
      discount3,

      instituteId4,
      courseId4,
      refNumber4,
      fees4,
      discount4,

      instituteId5,
      courseId5,
      refNumber5,
      fees5,
      discount5,

    } = req.body;

    const user = await User.findOne({ email: rollNumber });
    if (user) {
      return res
        .status(400)
        .json({ success: false, error: "User already registered in Student" });
    }

    const hashPassword = await bcrypt.hash(rollNumber, 10);

    const newUser = new User({
      name,
      email: rollNumber,
      password: hashPassword,
      role: "student",
      profileImage: "",
    });
    savedUser = await newUser.save();

    const schoolById = await School.findById({ _id: schoolId });
    if (schoolById == null) {
      return res
        .status(404)
        .json({ success: false, error: "Niswan Not exists" });
    }

    let hostelFinalFeesVal = Number(hostelFees ? hostelFees : "0") - Number(hostelDiscount ? hostelDiscount : "0");
    const newStudent = new Student({
      userId: savedUser._id,
      schoolId: schoolById._id,
      rollNumber,
      doa,
      dob,
      gender,
      maritalStatus,
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
      hostel,
      hostelRefNumber,
      hostelFees,
      hostelDiscount,
      hostelFinalFees: hostelFinalFeesVal,
      active: "Active",
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
      fees1,
      discount1,
      finalFees1: finalFees1Val,

      instituteId2,
      courseId2,
      refNumber2,
      fees2,
      discount2,
      finalFees2: finalFees2Val,

      instituteId3,
      courseId3,
      refNumber3,
      fees3,
      discount3,
      finalFees3: finalFees3Val,

      instituteId4,
      courseId4,
      refNumber4,
      fees4,
      discount4,
      finalFees4: finalFees4Val,

      instituteId5,
      courseId5,
      refNumber5,
      fees5,
      discount5,
      finalFees5: finalFees5Val,
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

    return res.status(200).json({ success: true, message: "Student created." });
  } catch (error) {

    if (savedUser != null) {
      savedUser.deleteOne();
    }

    if (savedStudent != null) {
      savedStudent.deleteOne();
    }

    if (savedAcademic != null) {
      savedAcademic.deleteOne();
    }

    if (savedAccount != null) {
      savedAccount.deleteOne();
    }

    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "server error in adding student" });
  }
};

const importStudentsData = async (req, res) => {

  console.log("Inside Import data Method");

  const studentsDataList = req.body;

  studentsDataList.forEach((studentData) => {
    console.log(studentData.name);
    console.log(studentData.schoolId);
    console.log(studentData.rollNumber);
    console.log(studentData.doa);
  });

  console.log(studentsDataList.length);

  let savedUser;
  let savedStudent;
  let savedAcademic;
  let savedAccount;

  try {

    /*
    const {
      name,
      schoolId,
      rollNumber,
      doa,
      dob,
      gender,
      maritalStatus,
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

      hostel,
      hostelRefNumber,
      hostelFees,
      hostelDiscount,

      acYear,

      instituteId1,
      courseId1,
      refNumber1,
      fees1,
      discount1,

      instituteId2,
      courseId2,
      refNumber2,
      fees2,
      discount2,

      instituteId3,
      courseId3,
      refNumber3,
      fees3,
      discount3,

      instituteId4,
      courseId4,
      refNumber4,
      fees4,
      discount4,

      instituteId5,
      courseId5,
      refNumber5,
      fees5,
      discount5,

    } = req.body;

    const user = await User.findOne({ email: rollNumber });
    if (user) {
      return res
        .status(400)
        .json({ success: false, error: "User already registered in Student" });
    }

    const hashPassword = await bcrypt.hash(rollNumber, 10);

    const newUser = new User({
      name,
      email: rollNumber,
      password: hashPassword,
      role: "student",
      profileImage: "",
    });
    savedUser = await newUser.save();

    const schoolById = await School.findById({ _id: schoolId });
    if (schoolById == null) {
      return res
        .status(404)
        .json({ success: false, error: "Niswan Not exists" });
    }

    let hostelFinalFeesVal = Number(hostelFees ? hostelFees : "0") - Number(hostelDiscount ? hostelDiscount : "0");
    const newStudent = new Student({
      userId: savedUser._id,
      schoolId: schoolById._id,
      rollNumber,
      doa,
      dob,
      gender,
      maritalStatus,
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
      hostel,
      hostelRefNumber,
      hostelFees,
      hostelDiscount,
      hostelFinalFees: hostelFinalFeesVal,
      active: "Active",
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
      fees1,
      discount1,
      finalFees1: finalFees1Val,

      instituteId2,
      courseId2,
      refNumber2,
      fees2,
      discount2,
      finalFees2: finalFees2Val,

      instituteId3,
      courseId3,
      refNumber3,
      fees3,
      discount3,
      finalFees3: finalFees3Val,

      instituteId4,
      courseId4,
      refNumber4,
      fees4,
      discount4,
      finalFees4: finalFees4Val,

      instituteId5,
      courseId5,
      refNumber5,
      fees5,
      discount5,
      finalFees5: finalFees5Val,
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
*/
    return res.status(200).json({ success: true, message: "Students data Imported." });
  } catch (error) {

    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "server error in adding student" });
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
      .populate("schoolId");

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
    return res.status(200).json({ success: true, student });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get student by ID server error" });
  }
};

const getAcademic = async (req, res) => {
  const { studentId, acaYear } = req.params;
  try {

    let accYear = (new Date().getFullYear() - 1) + "-" + new Date().getFullYear();
    if (new Date().getMonth() + 1 >= 4) {
      accYear = new Date().getFullYear() + "-" + (new Date().getFullYear() + 1);
    }

    const acadYear = await AcademicYear.findOne({ acYear: accYear });
    if (!acadYear) {
      return res
        .status(404)
        .json({ success: false, error: "Academic Year Not found : " + accYear });
    }

    {/*
    let academic;
    if (acaYear != "vieww") {
      academic = await Academic.findOne({ studentId: studentId, acYear: acadYear._id })
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
    } else {
      academic = await Academic.findOne({ studentId: studentId, acYear: acadYear._id })
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
    }
    */}

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

const updateStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const { name,
      schoolId,
      doa,
      dob,
      gender,
      maritalStatus,
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
      fees1,
      discount1,

      instituteId2,
      courseId2,
      refNumber2,
      fees2,
      discount2,

      instituteId3,
      courseId3,
      refNumber3,
      fees3,
      discount3,

      instituteId4,
      courseId4,
      refNumber4,
      fees4,
      discount4,

      instituteId5,
      courseId5,
      refNumber5,
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

      updateUser = await User.findByIdAndUpdate({ _id: student.userId }, { name, profileImage: blob.downloadUrl, })
    } else {
      updateUser = await User.findByIdAndUpdate({ _id: student.userId }, { name, })
    }

    let hostelFinalFeesVal = Number(hostelFees ? hostelFees : "0") - Number(hostelDiscount ? hostelDiscount : "0");
    const updateStudent = await Student.findByIdAndUpdate({ _id: id }, {
      schoolId, doa,
      dob,
      gender,
      maritalStatus,
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
      hostel,
      hostelRefNumber,
      hostelFees,
      hostelDiscount,
      hostelFinalFees: hostelFinalFeesVal,
      active,
      remarks,
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
      fees1,
      discount1,
      finalFees1: finalFees1Val,

      instituteId2: instituteId2 ? instituteId2 : null,
      courseId2: courseId2 ? courseId2 : null,
      refNumber2,
      fees2,
      discount2,
      finalFees2: finalFees2Val,

      instituteId3: instituteId3 ? instituteId3 : null,
      courseId3: courseId3 ? courseId3 : null,
      refNumber3,
      fees3,
      discount3,
      finalFees3: finalFees3Val,

      instituteId4: instituteId4 ? instituteId4 : null,
      courseId4: courseId4 ? courseId4 : null,
      refNumber4,
      fees4,
      discount4,
      finalFees4: finalFees4Val,

      instituteId5: instituteId5 ? instituteId5 : null,
      courseId5: courseId5 ? courseId5 : null,
      refNumber5,
      fees5,
      discount5,
      finalFees5: finalFees5Val,
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
    //  const deleteStudent = await Student.findById({ _id: id })
    //  await User.findByIdAndDelete({ _id: deleteStudent.userId._id })
    //  await deleteStudent.deleteOne()

    const updateStudent = await Student.findByIdAndUpdate({ _id: id }, {
      active: "In-Active",
      remarks: "Deleted",
    })
    return res.status(200).json({ success: true, updateStudent })
  } catch (error) {
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
  getAcademic, getStudentsBySchool, getStudentsBySchoolAndTemplate, getStudentsCount, importStudentsData
};
