import mongoose from "mongoose";
import { Schema } from "mongoose";

const templateSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: "Course", index: true, required: true, unique: true  },
  details: { type: String, required: true },
  template: { type: String, required: true },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Template = mongoose.model("Template", templateSchema);
export default Template;
