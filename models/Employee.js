import mongoose from "mongoose";
import { Schema } from "mongoose";

const employeeSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
  employeeId: { type: String, required: true, unique: true, index: true },
  contactNumber: { type: Number, required: true },
  address: { type: String, required: true },
  designation: { type: String },
  qualification: { type: String },
  dob: { type: Date },
  gender: { type: String, enum: ["Male", "Female"], },
  maritalStatus: { type: String, enum: ["Married", "Single"], },
  doj: { type: Date },
  salary: { type: Number, required: true },

  active: { type: String, index: true, enum: ["Active", "In-Active"], default: "Active" },
  remarks: { type: String },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Employee = mongoose.model("Employee", employeeSchema);
export default Employee;