import mongoose from "mongoose";

const numberingSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, index: true },
  currentNumber: { type: Number, required: true, default: 0 },

  createAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Numbering = mongoose.model("Numbering", numberingSchema);
export default Numbering;