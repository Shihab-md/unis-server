import mongoose from "mongoose";
import { Schema } from "mongoose";

const employeeSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  schoold: { type: Schema.Types.ObjectId, ref: "School", required: true },
  employeeId: { type: String, required: true, unique: true },
  role: { type: String, enum: ["admin", "teacher"], },
  address: { type: String, required: true },
  contactNumber: { type: Number, required: true },
  designation: { type: String },
  qualification: { type: String },
  dob: { type: Date },
  gender: { type: String, enum: ["Male", "Female"], default: "Female", },
  maritalStatus: { type: String, enum: ["Married", "Single"], },
  doj: { type: Date },
  salary: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Employee = mongoose.model("Employee", employeeSchema);
export default Employee;
