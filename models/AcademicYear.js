import mongoose from "mongoose";
import { Schema } from "mongoose";

const academicYearSchema = new Schema({
  acYear: { type: String, required: true, unique: true, index: true },
  desc: { type: String },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const AcademicYear = mongoose.model("AcademicYear", academicYearSchema);
export default AcademicYear;