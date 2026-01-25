import mongoose from "mongoose";
const { Schema } = mongoose;

const invoiceItemSchema = new Schema(
  {
    headCode: { type: String, required: true },
    headName: { type: String, required: true },

    amount: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    fine: { type: Number, default: 0, min: 0 },

    netAmount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const feeInvoiceSchema = new Schema(
  {
    invoiceNo: { type: String, required: true, unique: true, index: true },

    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true }, // optional

    acYear: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true, index: true },
    academicId: { type: Schema.Types.ObjectId, ref: "Academic", index: true },

    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },

    source: { type: String, enum: ["ADMISSION", "COURSE_CHANGE", "MANUAL"], default: "ADMISSION", index: true },
    dueDate: { type: Date, index: true },

    items: { type: [invoiceItemSchema], required: true },

    total: { type: Number, required: true, min: 0 },
    paidTotal: { type: Number, default: 0, min: 0 },
    balance: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: ["ISSUED", "PARTIAL", "PAID", "CANCELLED"],
      default: "ISSUED",
      index: true,
    },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    notes: { type: String },
  },
  { timestamps: true }
);

feeInvoiceSchema.index({ schoolId: 1, acYear: 1, status: 1 });
feeInvoiceSchema.index({ studentId: 1, acYear: 1, status: 1 });

export default mongoose.model("FeeInvoice", feeInvoiceSchema);