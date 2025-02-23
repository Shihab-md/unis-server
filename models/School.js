import mongoose from "mongoose";
import { Schema } from "mongoose";

const schoolSchema = new Schema({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true, unique: true },
  address: { type: String },
  contactNumber: { type: Number },
  email: { type: String },
  incharge1: { type: String, required: true },
  incharge1Number: { type: Number, required: true },
  incharge2: { type: String },
  incharge2Number: { type: Number },
  active: {
    type: String,
    enum: ["Active", "In-Active"],
    default: "Active",
  },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  updatedAt: { type: Date, default: Date.now },
});

const School = mongoose.model("School", schoolSchema);
export default School;
