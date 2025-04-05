import mongoose from "mongoose";
import { Schema } from "mongoose";

const schoolSchema = new Schema({
  code: { type: String, required: true, unique: true },
  nameEnglish: { type: String, required: true },
  nameArabic: { type: String },
  nameNative: { type: String },
  address: { type: String, required: true },
  district: { type: String, required: true },
  contactNumber: { type: Number },
  email: { type: String },
  incharge1: { type: String, required: true },
  incharge1Number: { type: Number, required: true },
  incharge2: { type: String },
  incharge2Number: { type: Number },
  incharge3: { type: String },
  incharge3Number: { type: Number },
  incharge4: { type: String },
  incharge4Number: { type: Number },
  incharge5: { type: String },
  incharge5Number: { type: Number },
  active: {
    type: String,
    enum: ["Active", "In-Active"],
    default: "Active",
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const School = mongoose.model("School", schoolSchema);
export default School;
