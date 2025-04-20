import multer from "multer";
import Student from "../models/Student.js";
import User from "../models/User.js";
import School from "../models/School.js";
import Academic from "../models/Academic.js";
import AcademicYear from "../models/AcademicYear.js";
import bcrypt from "bcrypt";
import path from "path";

const storage = multer.diskStorage({
  destination: async function (req, file, cb) {
    cb(null, "public/uploads");
  },
  filename: (req, file, cb) => {
    cb(null, path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

const addStudent = async (req, res) => {
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

      acYear,

      instituteId1,
      courseId1,
      refNumber1,
      fees1,
      discount1,
      finalFees1,
      paid1,
      paidDate1,
      balance1,

      instituteId2,
      courseId2,
      refNumber2,
      fees2,
      discount2,
      finalFees2,
      paid2,
      paidDate2,
      balance2,

      instituteId3,
      courseId3,
      refNumber3,
      fees3,
      discount3,
      finalFees3,
      paid3,
      paidDate3,
      balance3,

      instituteId4,
      courseId4,
      refNumber4,
      fees4,
      discount4,
      finalFees4,
      paid4,
      paidDate4,
      balance4,

      instituteId5,
      courseId5,
      refNumber5,
      fees5,
      discount5,
      finalFees5,
      paid5,
      paidDate5,
      balance5,

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
      profileImage: req.file ? req.file.filename : "",
    });
    const savedUser = await newUser.save();

    const schoolById = await School.findById({ _id: schoolId });
    if (schoolById == null) {
      return res
        .status(404)
        .json({ success: false, error: "Niswan Not exists" });
    }

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
    });

    const savedStudent = await newStudent.save();
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

    const newAcademic = new Academic({
      studentId: savedStudent._id,
      acYear: academicYearById._id,
      instituteId1,
      courseId1,
      refNumber1,
      fees1,
      discount1,
      finalFees1,
      paid1,
      paidDate1,
      balance1,

      instituteId2,
      courseId2,
      refNumber2,
      fees2,
      discount2,
      finalFees2,
      paid2,
      paidDate2,
      balance2,

      instituteId3,
      courseId3,
      refNumber3,
      fees3,
      discount3,
      finalFees3,
      paid3,
      paidDate3,
      balance3,

      instituteId4,
      courseId4,
      refNumber4,
      fees4,
      discount4,
      finalFees4,
      paid4,
      paidDate4,
      balance4,

      instituteId5,
      courseId5,
      refNumber5,
      fees5,
      discount5,
      finalFees5,
      paid5,
      paidDate5,
      balance5,
    });

    await newAcademic.save();
    return res.status(200).json({ success: true, message: "Student created." });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, error: "server error in adding student" });
  }
};

const getStudents = async (req, res) => {
  try {
    const students = await Student.find()
      .populate("userId", { password: 0 })
      .populate("schoolId");
    return res.status(200).json({ success: true, students });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get students server error" });
  }
};

const getStudent = async (req, res) => {
  const { id } = req.params;
  try {
    let student = await Student.findById({ _id: id })
      .populate("userId", { password: 0 })
      .populate("schoolId");

    if (!student) {
      student = await Student.findOne({ userId: id })
        .populate("userId", { password: 0 })
        .populate("schoolId");
    }
    return res.status(200).json({ success: true, student });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get students server error" });
  }
};

const getAcademic = async (req, res) => {
  const { studentId, acaYear } = req.params;
  try {

    let accYear = (new Date().getFullYear() - 1) + "-" + new Date().getFullYear();
    if (new Date().getMonth() + 1 >= 4) {
      accYear = new Date().getFullYear() + "-" + (new Date().getFullYear() + 1);
    }

    return res
      .status(404)
      .json({ success: false, error: "Academic Year Not found : " + studentId + ", " + acaYear + ", " + accYear });

    const acYear = await AcademicYear.findOne({ acYear: accYear });
    if (!acYear) {
      return res
        .status(404)
        .json({ success: false, error: "Academic Year Not found : " + accYear });
    }

    let academic;
    if (!acaYear.equals("vieww")) {
      academic = await Academic.findOne({ studentId: studentId, acYear: acYear._id });
    } else {
      academic = await Academic.findOne({ studentId: studentId, acYear: acYear._id })
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

    if (!academic) {
      return res
        .status(404)
        .json({ success: false, error: "Academic details Not found : " + studentId + ", " + accYear });
    }

    return res.status(200).json({ success: true, academic });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get students server error" });
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

      acYear,

      instituteId1,
      courseId1,
      refNumber1,
      fees1,
      discount1,
      finalFees1,
      paid1,
      paidDate1,
      balance1,

      instituteId2,
      courseId2,
      refNumber2,
      fees2,
      discount2,
      finalFees2,
      paid2,
      paidDate2,
      balance2,

      instituteId3,
      courseId3,
      refNumber3,
      fees3,
      discount3,
      finalFees3,
      paid3,
      paidDate3,
      balance3,

      instituteId4,
      courseId4,
      refNumber4,
      fees4,
      discount4,
      finalFees4,
      paid4,
      paidDate4,
      balance4,

      instituteId5,
      courseId5,
      refNumber5,
      fees5,
      discount5,
      finalFees5,
      paid5,
      paidDate5,
      balance5, } = req.body;

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

    const updateUser = await User.findByIdAndUpdate({ _id: student.userId }, { name })

    const updateStudent = await Student.findByIdAndUpdate({ _id: id }, {
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
    })

    const updateAcademic = await Academic.findOne({ studentId: updateStudent._id, acYear: acYear });

    const updateAcademicById = await Academic.findByIdAndUpdate({ _id: updateAcademic._id }, {
      instituteId1,
      courseId1,
      refNumber1,
      fees1,
      discount1,
      finalFees1,
      paid1,
      paidDate1,
      balance1,

      instituteId2,
      courseId2,
      refNumber2,
      fees2,
      discount2,
      finalFees2,
      paid2,
      paidDate2,
      balance2,

      instituteId3,
      courseId3,
      refNumber3,
      fees3,
      discount3,
      finalFees3,
      paid3,
      paidDate3,
      balance3,

      instituteId4,
      courseId4,
      refNumber4,
      fees4,
      discount4,
      finalFees4,
      paid4,
      paidDate4,
      balance4,

      instituteId5,
      courseId5,
      refNumber5,
      fees5,
      discount5,
      finalFees5,
      paid5,
      paidDate5,
      balance5,
    });

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

    await User.findByIdAndDelete({ _id: deleteStudent.userId._id })
    await deleteStudent.deleteOne()
    return res.status(200).json({ success: true, deleteStudent })
  } catch (error) {
    return res.status(500).json({ success: false, error: "delete Student server error" })
  }
}

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

export { addStudent, upload, getStudents, getStudent, updateStudent, deleteStudent, getAcademic };
