import mongoose from "mongoose";
import { Schema } from "mongoose";

const accountSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  acYear: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true },
  academicId: { type: Schema.Types.ObjectId, ref: "Academic" },

  receiptNumber: { type: String, required: true },
  type: { type: String, enum: ["fees", "salary", "bonus", "travel", "hostel", ""], },
  fees: { type: Number },
  paid: { type: Number },
  paidDate: { type: Date },
  balance: { type: Number },
  remarks: { type: String },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Account = mongoose.model("Account", accountSchema);
export default Account;