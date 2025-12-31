import mongoose from "mongoose";
import { Schema } from "mongoose";
 
const studentSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },

  rollNumber: { type: String, required: true, unique: true, index: true },
  doa: { type: Date, required: true },

  dob: { type: Date, required: true },
  gender: { type: String, enum: ["Male", "Female"], },
  maritalStatus: { type: String, enum: ["Married", "Single"], },
  motherTongue: { type: String },
  bloodGroup: { type: String },
  idMark1: { type: String, required: true },
  idMark2: { type: String },
  about: { type: String },
 
  fatherName: { type: String },
  fatherNumber: { type: Number },
  fatherOccupation: { type: String },

  motherName: { type: String },
  motherNumber: { type: Number },
  motherOccupation: { type: String },

  guardianName: { type: String },
  guardianNumber: { type: Number },
  guardianOccupation: { type: String },
  guardianRelation: { type: String },

  address: { type: String, required: true },
  city: { type: String, required: true },
  landmark: { type: String },
  pincode: { type: Number },
  districtStateId: { type: Schema.Types.ObjectId, ref: "DistrictState", required: true },

  hostel: { type: String, index: true, enum: ["Yes", "No"], },
  hostelRefNumber: { type: String },
  hostelFees: { type: Number },
  hostelDiscount: { type: Number },
  hostelFinalFees: { type: Number },

  active: { type: String, index: true, enum: ["Active", "In-Active", "Transferred", "Graduated", "Discontinued"], default: "Active" },
  remarks: { type: String },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },

  courses: [{ type: Schema.Types.ObjectId, ref: 'Course', required: true }],

  _course: { type: String },
  _academics: [{ type: Schema.Types.ObjectId, ref: 'Academic', required: true }],
});

studentSchema.virtual('course').
  get(function () { return this._course; }).
  set(function (courseName) { this._course = courseName; });

studentSchema.virtual('academics').
  get(function () { return this._academics; }).
  set(function (academics) { this._academics = academics; });

studentSchema.index({ schoolId: 1, rollNumber: 1 });

const Student = mongoose.model("Student", studentSchema);
export default Student;