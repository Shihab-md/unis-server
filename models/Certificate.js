import mongoose from "mongoose";
import { Schema } from "mongoose";

const certificateSchema = new Schema({
  code: { type: String, required: true, index: true, unique: true },
  templateId: { type: Schema.Types.ObjectId, ref: "Template", required: true },
  studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true },
  certificate: { type: String, required: true },
 
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Certificate = mongoose.model("Certificate", certificateSchema);
export default Certificate;
