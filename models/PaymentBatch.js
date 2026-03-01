import mongoose from "mongoose";
const { Schema } = mongoose;

const paymentBatchSchema = new Schema(
  {
    batchNo: { type: String, required: true, unique: true, index: true },
    receiptNumber: { type: String, index: true }, // ✅ set on HQ approval

    schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true, index: true },
    acYear: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true, index: true },

    totalAmount: { type: Number, required: true, min: 1 },
    itemCount: { type: Number, required: true, min: 1 },

    mode: { type: String, enum: ["cash", "bank", "upi", "online"], default: "bank", index: true },
    referenceNo: { type: String },
    proofUrl: { type: String },
    paidDate: { type: Date, default: Date.now, index: true },

    status: {
      type: String,
      enum: ["PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"],
      default: "PENDING_APPROVAL",
      index: true,
    },

    proofDriveFileId: { type: String },
    proofDriveViewUrl: { type: String },
    proofDriveDownloadUrl: { type: String },
    proofFileName: { type: String },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
    rejectedReason: { type: String },

    remarks: { type: String },
  },
  { timestamps: true }
);

paymentBatchSchema.index({ schoolId: 1, acYear: 1, status: 1 });
paymentBatchSchema.index({ status: 1, paidDate: -1 });

export default mongoose.model("PaymentBatch", paymentBatchSchema);
