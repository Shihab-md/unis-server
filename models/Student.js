import mongoose from "mongoose";
import { Schema } from "mongoose";

const studentSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true },

  rollNumber: { type: String, required: true, unique: true },
  doa: { type: Date, required: true },

  dob: { type: Date, required: true },
  gender: { type: String, enum: ["Male", "Female"], },
  maritalStatus: { type: String, enum: ["Married", "Single"], },
  bloodGroup: { type: String },
  identificationMark1: { type: String },
  identificationMark1: { type: String },

  fatherName: { type: String, required: true },
  fatherNumber: { type: Number, required: true },
  motherName: { type: String },
  motherNumber: { type: Number },
  guardianName: { type: String },
  guardianNumber: { type: Number },
  guardianRelation: { type: String },
  address: { type: String, required: true },
  district: { type: String, required: true },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Student = mongoose.model("Student", studentSchema);
export default Student;