import mongoose from "mongoose";
import { Schema } from "mongoose";

const academicSchema = new Schema({
  studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
  acYear: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true },

  instituteId1: { type: Schema.Types.ObjectId, ref: "Institute", required: true },
  courseId1: { type: Schema.Types.ObjectId, ref: "Course", required: true },
  refNumber1: { type: String, required: true },
  year1: { type: Number },
  fees1: { type: Number },
  discount1: { type: Number },
  finalFees1: { type: Number },
  status1: { type: String },

  instituteId2: { type: Schema.Types.ObjectId, ref: "Institute" },
  courseId2: { type: Schema.Types.ObjectId, ref: "Course" },
  refNumber2: { type: String },
  year2: { type: Number },
  fees2: { type: Number },
  discount2: { type: Number },
  finalFees2: { type: Number },
  status2: { type: String },

  instituteId3: { type: Schema.Types.ObjectId, ref: "Institute" },
  courseId3: { type: Schema.Types.ObjectId, ref: "Course" },
  refNumber3: { type: String },
  year3: { type: Number },
  fees3: { type: Number },
  discount3: { type: Number },
  finalFees3: { type: Number },
  status3: { type: String },

  instituteId4: { type: Schema.Types.ObjectId, ref: "Institute" },
  courseId4: { type: Schema.Types.ObjectId, ref: "Course" },
  refNumber4: { type: String },
  year4: { type: Number },
  fees4: { type: Number },
  discount4: { type: Number },
  finalFees4: { type: Number },
  status4: { type: String },

  instituteId5: { type: Schema.Types.ObjectId, ref: "Institute" },
  courseId5: { type: Schema.Types.ObjectId, ref: "Course" },
  refNumber5: { type: String },
  year5: { type: Number },
  fees5: { type: Number },
  discount5: { type: Number },
  finalFees5: { type: Number },
  status5: { type: String },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Academic = mongoose.model("Academic", academicSchema);
export default Academic;