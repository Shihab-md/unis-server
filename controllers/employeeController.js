import multer from "multer";
import Employee from "../models/Employee.js";
import User from "../models/User.js";
import School from "../models/School.js";
import bcrypt from "bcrypt";

const upload = multer({});

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
      name,
      email,
      password: hashPassword,
      role,
      profileImage: req.file ? req.file.buffer.toString('base64') : "",
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
      address,
      designation,
      qualification,
      dob,
      gender,
      maritalStatus,
      doj,
      salary,
    });

    await newEmployee.save();
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
    const employees = await Employee.find()
      .populate("userId", { password: 0 })
      .populate("schoolId");
    return res.status(200).json({ success: true, employees });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "get employees server error" });
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
      employee = await Employee.findOne({ userId: id })
        .populate("userId", { password: 0 })
        .populate("schoolId");
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
      salary, } = req.body;

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

    //  const updateUser = await User.findByIdAndUpdate({ _id: employee.userId }, { name })

    let updateUser;
    if (req.file) {
      updateUser = await User.findByIdAndUpdate({ _id: employee.userId },
        {
          name,
          profileImage: req.file.buffer.toString('base64'),
        })
    } else {
      updateUser = await User.findByIdAndUpdate({ _id: employee.userId }, { name, })
    }

    const updateEmployee = await Employee.findByIdAndUpdate({ _id: id }, {
      schoolId: school._id,
      contactNumber,
      address,
      designation,
      qualification,
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

export { addEmployee, upload, getEmployees, getEmployee, updateEmployee, deleteEmployee };
