import mongoose from "mongoose";
import { Schema } from "mongoose";

const academicSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
 
  acYear: { type: String, required: true },
 
  instituteId1: { type: Schema.Types.ObjectId, ref: "Institute", required: true },
  courseId1: { type: Schema.Types.ObjectId, ref: "Course", required: true },
  refNumber1: { type: String, required: true },

  instituteId2: { type: Schema.Types.ObjectId, ref: "Institute" },
  courseId2: { type: Schema.Types.ObjectId, ref: "Course" },
  refNumber2: { type: String, unique: true },

  instituteId3: { type: Schema.Types.ObjectId, ref: "Institute" },
  courseId3: { type: Schema.Types.ObjectId, ref: "Course" },
  refNumber3: { type: String, unique: true },

  instituteId4: { type: Schema.Types.ObjectId, ref: "Institute" },
  courseId4: { type: Schema.Types.ObjectId, ref: "Course" },
  refNumber4: { type: String, unique: true },

  instituteId5: { type: Schema.Types.ObjectId, ref: "Institute" },
  courseId5: { type: Schema.Types.ObjectId, ref: "Course" },
  refNumber5: { type: String, unique: true },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Academic = mongoose.model("Academic", academicSchema);
export default Academic;