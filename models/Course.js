import mongoose from "mongoose";
import { Schema } from "mongoose";

const courseSchema = new Schema({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  type: { type: String, enum: ["Deeniyath Education", "Teacher Training", "School Education", "College Education", "Islamic Home Science", "Vocational Courses"], },
  remarks: { type: String },
  fees: { type: Number, required: true },
  years: { type: Number, required: true },

  promotionOrder: { type: Number, index: true },
  
  subject1Code: { type: String, required: true },
  subject1: { type: String, required: true },
  subject1MaxMark: { type: Number, required: true },
  subject1PassMark: { type: Number, required: true },

  subject2Code: { type: String },
  subject2: { type: String },
  subject2MaxMark: { type: Number },
  subject2PassMark: { type: Number },

  subject3Code: { type: String },
  subject3: { type: String },
  subject3MaxMark: { type: Number },
  subject3PassMark: { type: Number },

  subject4Code: { type: String },
  subject4: { type: String },
  subject4MaxMark: { type: Number },
  subject4PassMark: { type: Number },

  subject5Code: { type: String },
  subject5: { type: String },
  subject5MaxMark: { type: Number },
  subject5PassMark: { type: Number },

  subject6Code: { type: String },
  subject6: { type: String },
  subject6MaxMark: { type: Number },
  subject6PassMark: { type: Number },

  subject7Code: { type: String },
  subject7: { type: String },
  subject7MaxMark: { type: Number },
  subject7PassMark: { type: Number },

  subject8Code: { type: String },
  subject8: { type: String },
  subject8MaxMark: { type: Number },
  subject8PassMark: { type: Number },

  subject9Code: { type: String },
  subject9: { type: String },
  subject9MaxMark: { type: Number },
  subject9PassMark: { type: Number },

  subject10Code: { type: String },
  subject10: { type: String },
  subject10MaxMark: { type: Number },
  subject10PassMark: { type: Number },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },

  _subjectsCount: { type: Number },
});

courseSchema.virtual('subjectsCount').
  get(function () { return this._subjectsCount; }).
  set(function (count) { this._subjectsCount = count; });

const Course = mongoose.model("Course", courseSchema);
export default Course;
