import mongoose from "mongoose";
const { Schema } = mongoose;

const feeHeadSchema = new Schema(
  {
    headCode: { type: String, required: true }, // TUITION, EXAM
    headName: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    isOptional: { type: Boolean, default: false },
  },
  { _id: false }
);

const feeStructureSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: "School", index: true }, // null => global
    acYear: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true, index: true },
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },

    heads: { type: [feeHeadSchema], required: true },
    active: { type: String, enum: ["Active", "In-Active"], default: "Active", index: true },
    remarks: { type: String },
  },
  { timestamps: true }
);

feeStructureSchema.index({ schoolId: 1, acYear: 1, courseId: 1 }, { unique: true });

export default mongoose.model("FeeStructure", feeStructureSchema);
