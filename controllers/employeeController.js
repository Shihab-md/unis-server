import multer from "multer";
import { put } from "@vercel/blob";
import Employee from "../models/Employee.js";
import User from "../models/User.js";
import School from "../models/School.js";
import bcrypt from "bcrypt";
import { toCamelCase } from "./commonController.js";

const upload = multer({ storage: multer.memoryStorage() });

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

const getEmployees = async (req, res) => {
  try {
    const employees = await Employee.find().sort({ employeeId: 1 })
      .populate("userId", { password: 0, profileImage: 0 })
      .populate("schoolId");
    return res.status(200).json({ success: true, employees });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get employees server error" });
  }
};

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

export { addEmployee, upload, getEmployees, getEmployee, updateEmployee, deleteEmployee, getByEmpFilter };
