import mongoose from "mongoose";
import { Schema } from "mongoose";

const classSectionSchema = new Schema({
  classs: { type: String, required: true, unique: true },
  section: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const classSection = mongoose.model("ClassSection", classSectionSchema);
export default classSection;
