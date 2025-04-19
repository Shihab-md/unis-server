import mongoose from "mongoose";
import { Schema } from "mongoose";
import Academic from "../models/Academic.js";

const studentSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true },

  rollNumber: { type: String, required: true, unique: true },
  doa: { type: Date, required: true },
   
  dob: { type: Date, required: true },
  gender: { type: String, enum: ["Male", "Female"], },
  maritalStatus: { type: String, enum: ["Married", "Single"], },
  bloodGroup: { type: String },
  idMark1: { type: String, required: true },
  idMark2: { type: String },

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
  district: { type: String, required: true },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Student = mongoose.model("Student", studentSchema);
export default Student;