import mongoose from "mongoose";
import { Schema } from "mongoose";

const academicSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
  acYear: { type: Schema.Types.ObjectId, ref: "Academic", required: true },

  instituteId1: { type: Schema.Types.ObjectId, ref: "Institute", required: true },
  courseId1: { type: Schema.Types.ObjectId, ref: "Course", required: true },
  refNumber1: { type: String, required: true },
  fees1: { type: Number },
  discount1: { type: Number },
  finalFees1: { type: Number },
  paid1: { type: Number },
  paidDate1: { type: Date },
  balance1: { type: Number },

  instituteId2: { type: Schema.Types.ObjectId, ref: "Institute" },
  courseId2: { type: Schema.Types.ObjectId, ref: "Course" },
  refNumber2: { type: String, unique: true },
  fees2: { type: Number },
  discount2: { type: Number },
  finalFees2: { type: Number },
  paid2: { type: Number },
  paidDate2: { type: Date },
  balance2: { type: Number },

  instituteId3: { type: Schema.Types.ObjectId, ref: "Institute" },
  courseId3: { type: Schema.Types.ObjectId, ref: "Course" },
  refNumber3: { type: String, unique: true },
  fees3: { type: Number },
  discount3: { type: Number },
  finalFees3: { type: Number },
  paid3: { type: Number },
  paidDate3: { type: Date },
  balance3: { type: Number },

  instituteId4: { type: Schema.Types.ObjectId, ref: "Institute" },
  courseId4: { type: Schema.Types.ObjectId, ref: "Course" },
  refNumber4: { type: String, unique: true },
  fees4: { type: Number },
  discount4: { type: Number },
  finalFees4: { type: Number },
  paid4: { type: Number },
  paidDate4: { type: Date },
  balance4: { type: Number },

  instituteId5: { type: Schema.Types.ObjectId, ref: "Institute" },
  courseId5: { type: Schema.Types.ObjectId, ref: "Course" },
  refNumber5: { type: String, unique: true },
  fees5: { type: Number },
  discount5: { type: Number },
  finalFees5: { type: Number },
  paid5: { type: Number },
  paidDate5: { type: Date },
  balance5: { type: Number },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Academic = mongoose.model("Academic", academicSchema);
export default Academic;