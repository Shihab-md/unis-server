import mongoose from "mongoose";
import { Schema } from "mongoose";

const courseSchema = new Schema({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  type: { type: String, enum: ["Deeniyath Education", "School Education", "College Education", "Vocational Courses"], },
  remarks: { type: String },
  fees: { type: Number, required: true },

  subject1: { type: String, required: true },
  subject1MaxMark: { type: Number, required: true },
  subject1PassMark: { type: Number, required: true },

  subject2: { type: String, required: true },
  subject2MaxMark: { type: Number, required: true },
  subject2PassMark: { type: Number, required: true },

  subject3: { type: String, required: true },
  subject3MaxMark: { type: Number, required: true },
  subject3PassMark: { type: Number, required: true },

  subject4: { type: String, required: true },
  subject4MaxMark: { type: Number },
  subject4PassMark: { type: Number },

  subject5: { type: String, required: true },
  subject5MaxMark: { type: Number },
  subject5PassMark: { type: Number },

  subject6: { type: String },
  subject6MaxMark: { type: Number },
  subject6PassMark: { type: Number },

  subject7: { type: String },
  subject7MaxMark: { type: Number },
  subject7PassMark: { type: Number },

  subject8: { type: String },
  subject8MaxMark: { type: Number },
  subject8PassMark: { type: Number },

  subject9: { type: String },
  subject9MaxMark: { type: Number },
  subject9PassMark: { type: Number },

  subject10: { type: String },
  subject10MaxMark: { type: Number },
  subject10PassMark: { type: Number },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Course = mongoose.model("Course", courseSchema);
export default Course;
