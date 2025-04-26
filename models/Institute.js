import mongoose from "mongoose";
import { Schema } from "mongoose";

const instituteSchema = new Schema({
  iCode: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  type: { type: String, enum: ["Deeniyath Education", "School Education", "College Education", "Vocational Courses"], },
  contactNumber: { type: Number },
  email: { type: String },
  address: { type: String, required: true },
  district: { type: String, required: true },
  incharge1: { type: String, required: true },
  incharge1Number: { type: Number, required: true },
  incharge2: { type: String },
  incharge2Number: { type: Number },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Institute = mongoose.model("Institute", instituteSchema);
export default Institute;
