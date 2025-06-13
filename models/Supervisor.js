import mongoose from "mongoose";
import { Schema } from "mongoose";

const supervisorSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  supervisorId: { type: String, required: true, unique: true },
  address: { type: String, required: true },
  contactNumber: { type: Number, required: true },
  routeName: { type: String },
  qualification: { type: String },
  dob: { type: Date },
  gender: { type: String, enum: ["Male", "Female"], default: "Male", },
  maritalStatus: { type: String, enum: ["Married", "Single"], },
  doj: { type: Date },
  salary: { type: Number, required: true },
  jobType: { type: String, enum: ["Full-Time", "Part-Time"], },

  active: { type: String, index: true, enum: ["Active", "In-Active"], default: "Active" },
  remarks: { type: String },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },

  _schoolsCount: { type: Number },
});

supervisorSchema.virtual('schoolsCount').
  get(function () { return this._schoolsCount; }).
  set(function (count) { this._schoolsCount = count; });

const Supervisor = mongoose.model("Supervisor", supervisorSchema);
export default Supervisor;
