import mongoose from "mongoose";
import { Schema } from "mongoose";

const gradeSchema = new Schema({
  grade: { type: String, required: true, trim: true, uppercase: true, unique: true },
  minMarkPercentage: { type: Number, required: true, min: 0, max: 100 },
  minAttendancePercentage: { type: Number, required: true, min: 0, max: 100 },
  conduct: { type: String, trim: true, default: "" },
  displayOrder: { type: Number, required: true, min: 1, default: 1, index: true },
  active: { type: String, enum: ["Active", "In-Active"], default: "Active", index: true },
  remarks: { type: String, trim: true, default: "" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

gradeSchema.index({ active: 1, displayOrder: 1, minMarkPercentage: -1, minAttendancePercentage: -1 });

const Grade = mongoose.model("Grade", gradeSchema);
export default Grade;
