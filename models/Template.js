import mongoose from "mongoose";
import { Schema } from "mongoose";

const templateSchema = new Schema({
  courseId: { type: Schema.Types.ObjectId, ref: "Course", index: true, required: true },
  details: { type: String, required: true },
  template: { type: String, required: true },
  // Incremented when a marksheet template PDF file is replaced.
  // Generated marksheets store the version used so historical outputs stay traceable.
  version: { type: Number, default: 1, min: 1 },

  // CERTIFICATE is the default so all existing templates continue to work.
  templateModule: {
    type: String,
    enum: ["CERTIFICATE", "MARKSHEET"],
    default: "CERTIFICATE",
    index: true,
  },

  // Used only when templateModule = MARKSHEET.
  // NORMAL = Quarterly / Half Yearly / Annual marksheet.
  // CONSOLIDATED = completed student consolidated marksheet.
  marksheetType: {
    type: String,
    enum: ["", "NORMAL", "CONSOLIDATED"],
    default: "",
    index: true,
  },

  certificateFees: { type: Number, default: 75, min: 0 },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// One certificate template per course, one normal marksheet template per course,
// and one consolidated marksheet template per course.
templateSchema.index(
  { courseId: 1, templateModule: 1, marksheetType: 1 },
  { unique: true }
);

const Template = mongoose.model("Template", templateSchema);
export default Template;
