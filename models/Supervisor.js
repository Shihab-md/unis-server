import mongoose from "mongoose";
import { Schema } from "mongoose";

const supervisorSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  supervisorId: { type: String, required: true, unique: true },
  routeName: { type: String },
  qualification: { type: String },
  dob: { type: Date },
  gender: { type: String, enum: ["Male", "Female"], default: "ActiMaleve", },
  maritalStatus: { type: String, enum: ["Married", "Single"], },
  doj: { type: Date },
  designation: { type: String },
  salary: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Supervisor = mongoose.model("Supervisor", supervisorSchema);
export default Supervisor;
