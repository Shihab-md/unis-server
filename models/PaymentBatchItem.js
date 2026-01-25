import mongoose from "mongoose";
const { Schema } = mongoose;

const allocationSchema = new Schema(
  {
    headCode: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const paymentBatchItemSchema = new Schema(
  {
    batchId: { type: Schema.Types.ObjectId, ref: "PaymentBatch", required: true, index: true },

    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    acYear: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true, index: true },

    invoiceId: { type: Schema.Types.ObjectId, ref: "FeeInvoice", required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },

    amount: { type: Number, required: true, min: 1 },
    allocations: { type: [allocationSchema], default: [] },

    status: {
      type: String,
      enum: ["PENDING_APPROVAL", "APPLIED", "REJECTED", "FAILED"],
      default: "PENDING_APPROVAL",
      index: true,
    },
    error: { type: String },
  },
  { timestamps: true }
);

paymentBatchItemSchema.index({ batchId: 1 });
paymentBatchItemSchema.index({ schoolId: 1, acYear: 1 });

export default mongoose.model("PaymentBatchItem", paymentBatchItemSchema);
