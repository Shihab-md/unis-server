import mongoose from "mongoose";
import FeeInvoice from "../models/FeeInvoice.js";
import PaymentBatch from "../models/PaymentBatch.js";
import PaymentBatchItem from "../models/PaymentBatchItem.js";
import { getNextNumber } from "./commonController.js";

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v));

const requireRole = (role, allowed) => {
  if (!allowed.includes(role)) {
    const err = new Error("Forbidden");
    err.status = 403;
    throw err;
  }
};

export const listPendingBatches = async (req, res) => {
  try {
    requireRole(req.user?.role, ["superadmin", "hquser"]);

    const { schoolId, acYear, status = "PENDING_APPROVAL" } = req.query;
    const q = { status };
    if (schoolId) q.schoolId = schoolId;
    if (acYear) q.acYear = acYear;

    const batches = await PaymentBatch.find(q)
      .select("batchNo receiptNumber schoolId acYear totalAmount itemCount mode referenceNo proofUrl paidDate status createdBy createdAt")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, batches });
  } catch (e) {
    console.log(e);
    return res.status(e.status || 500).json({ success: false, error: e.message || "server error" });
  }
};

export const getBatchDetails = async (req, res) => {
  try {
    requireRole(req.user?.role, ["superadmin", "hquser"]);

    const { batchId } = req.params;
    const batch = await PaymentBatch.findById(batchId).lean();
    if (!batch) return res.status(404).json({ success: false, error: "Batch not found" });

    const items = await PaymentBatchItem.find({ batchId })
      .select("invoiceId studentId amount allocations status error")
      .lean();

    return res.status(200).json({ success: true, batch, items });
  } catch (e) {
    console.log(e);
    return res.status(e.status || 500).json({ success: false, error: e.message || "server error" });
  }
};

export const approveBatch = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    requireRole(req.user?.role, ["superadmin", "hquser"]);

    const { batchId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(batchId)) {
      return res.status(400).json({ success: false, error: "Invalid batchId" });
    }

    const result = { applied: 0, failed: 0 };

    await session.withTransaction(async () => {
      const batch = await PaymentBatch.findById(batchId).session(session);
      if (!batch) throw new Error("Batch not found");
      if (batch.status !== "PENDING_APPROVAL") throw new Error("Batch is not pending");

      const receiptNumber = await getNextNumber({
        name: "Receipt",
        prefix: "RCPT",
        pad: 9
      });

      batch.status = "APPROVED";
      batch.approvedBy = req.user._id;
      batch.approvedAt = new Date();
      batch.receiptNumber = receiptNumber;
      await batch.save({ session });

      const items = await PaymentBatchItem.find({ batchId }).session(session);

      for (const it of items) {
        try {
          const invoice = await FeeInvoice.findById(it.invoiceId).session(session);
          if (!invoice) throw new Error("Invoice not found");
          if (invoice.status === "CANCELLED") throw new Error("Invoice cancelled");

          if (String(invoice.schoolId) !== String(batch.schoolId)) throw new Error("School mismatch");
          if (String(invoice.acYear) !== String(batch.acYear)) throw new Error("Academic year mismatch");
          if (Number(invoice.balance) <= 0) throw new Error("Invoice already paid");

          const payAmount = Math.min(Number(it.amount), Number(invoice.balance));

          if (Array.isArray(it.allocations) && it.allocations.length > 0) {
            for (const a of it.allocations) {
              const headCode = a?.headCode;
              const amt = Number(a?.amount || 0);
              if (!headCode || !Number.isFinite(amt) || amt <= 0) continue;

              const item = invoice.items.find((x) => x.headCode === headCode);
              if (!item) continue;

              const canPay = Math.max(0, Number(item.netAmount) - Number(item.paidAmount));
              const payNow = Math.min(canPay, amt);
              item.paidAmount = Number(item.paidAmount) + payNow;
            }
          } else {
            let remaining = payAmount;
            for (const item of invoice.items) {
              if (remaining <= 0) break;
              const canPay = Math.max(0, Number(item.netAmount) - Number(item.paidAmount));
              const payNow = Math.min(canPay, remaining);
              item.paidAmount = Number(item.paidAmount) + payNow;
              remaining -= payNow;
            }
          }

          invoice.paidTotal = invoice.items.reduce((s, x) => s + Number(x.paidAmount || 0), 0);
          invoice.balance = Math.max(0, Number(invoice.total) - Number(invoice.paidTotal));
          invoice.status = invoice.balance === 0 ? "PAID" : "PARTIAL";

          await invoice.save({ session });

          it.status = "APPLIED";
          it.error = "";
          await it.save({ session });

          result.applied += 1;
        } catch (errItem) {
          it.status = "FAILED";
          it.error = errItem?.message || "Failed";
          await it.save({ session });
          result.failed += 1;
        }
      }
    });

    return res.status(200).json({ success: true, message: "Batch approved", result });
  } catch (e) {
    console.log(e);
    return res.status(500).json({ success: false, error: e.message || "server error" });
  } finally {
    await session.endSession();
  }
};

export const rejectBatch = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    requireRole(req.user?.role, ["superadmin", "hquser"]);

    const { batchId } = req.params;
    const { reason } = req.body || {};

    await session.withTransaction(async () => {
      const batch = await PaymentBatch.findById(batchId).session(session);
      if (!batch) throw new Error("Batch not found");
      if (batch.status !== "PENDING_APPROVAL") throw new Error("Batch is not pending");

      batch.status = "REJECTED";
      batch.rejectedReason = reason || "Rejected";
      batch.approvedBy = req.user._id;
      batch.approvedAt = new Date();
      await batch.save({ session });

      await PaymentBatchItem.updateMany(
        { batchId },
        { $set: { status: "REJECTED", error: reason || "Rejected" } },
        { session }
      );
    });

    return res.status(200).json({ success: true, message: "Batch rejected" });
  } catch (e) {
    console.log(e);
    return res.status(500).json({ success: false, error: e.message || "server error" });
  } finally {
    await session.endSession();
  }
};

// HQ dashboard
export const hqFeesDashboard = async (req, res) => {
  try {
    requireRole(req.user?.role, ["superadmin", "hquser"]);

    const { acYear } = req.query;
    const match = { status: "PENDING_APPROVAL" };
    if (acYear) match.acYear = new mongoose.Types.ObjectId(acYear);

    const batchAgg = await PaymentBatch.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          pendingBatches: { $sum: 1 },
          pendingAmount: { $sum: "$totalAmount" },
        },
      },
    ]);

    const failedItemsCount = await PaymentBatchItem.countDocuments({ status: "FAILED" });

    const s = batchAgg[0] || { pendingBatches: 0, pendingAmount: 0 };

    return res.status(200).json({
      success: true,
      dashboard: {
        pendingBatches: s.pendingBatches,
        pendingAmount: s.pendingAmount,
        failedItemsCount,
      },
    });
  } catch (e) {
    console.log(e);
    return res.status(500).json({ success: false, error: "hq dashboard error" });
  }
};
