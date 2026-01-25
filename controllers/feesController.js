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

// School side: list due invoices
export const listDueInvoicesForSchool = async (req, res) => {
  try {
    console.log("listDueInvoicesForSchool called")
    requireRole(req.user?.role, ["superadmin", "hquser", "admin"]);

    const { schoolId, acYear, status } = req.query;

    const q = {};
    if (schoolId) q.schoolId = schoolId;
    if (acYear) q.acYear = acYear;

    q.status = status ? status : { $in: ["ISSUED", "PARTIAL"] };
    console.log(q)
    const invoices = await FeeInvoice.find(q)
      .select("invoiceNo schoolId studentId acYear courseId total paidTotal balance status createdAt")
      .sort({ createdAt: -1 })
      .lean();
    console.log(invoices)
    return res.status(200).json({ success: true, invoices });
  } catch (e) {
    console.log(e);
    return res.status(e.status || 500).json({ success: false, error: e.message || "server error" });
  }
};

// School side: create ONE batch for MANY invoices
export const createPaymentBatch = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    requireRole(req.user?.role, ["admin", "superadmin", "hquser"]);

    const {
      schoolId,
      acYear,
      mode = "bank",
      referenceNo = "",
      proofUrl = "",
      paidDate,
      remarks = "",
      items,
    } = req.body || {};

    if (!isObjectId(schoolId) || !isObjectId(acYear)) {
      return res.status(400).json({ success: false, error: "Invalid schoolId/acYear" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: "items required" });
    }

    let totalAmount = 0;
    const invoiceIds = [];
    const normalizedItems = [];

    for (const it of items) {
      if (!it) continue;

      if (!isObjectId(it.invoiceId) || !isObjectId(it.studentId)) {
        return res.status(400).json({ success: false, error: "Invalid invoiceId/studentId in items" });
      }

      const amt = Number(it.amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return res.status(400).json({ success: false, error: "Invalid amount in items" });
      }

      const allocations = Array.isArray(it.allocations) ? it.allocations : [];
      if (allocations.length > 0) {
        const sumAlloc = allocations.reduce((s, a) => s + Number(a?.amount || 0), 0);
        if (Math.round(sumAlloc * 100) !== Math.round(amt * 100)) {
          return res.status(400).json({
            success: false,
            error: `Allocations must sum to amount for invoice ${it.invoiceId}`,
          });
        }
      }

      totalAmount += amt;
      invoiceIds.push(it.invoiceId);
      normalizedItems.push({ invoiceId: it.invoiceId, studentId: it.studentId, amount: amt, allocations });
    }

    const invoices = await FeeInvoice.find({ _id: { $in: invoiceIds } })
      .select("_id schoolId acYear studentId balance status")
      .lean();

    const invMap = new Map(invoices.map((x) => [String(x._id), x]));

    for (const it of normalizedItems) {
      const inv = invMap.get(String(it.invoiceId));
      if (!inv) return res.status(400).json({ success: false, error: `Invoice not found: ${it.invoiceId}` });

      if (String(inv.schoolId) !== String(schoolId))
        return res.status(400).json({ success: false, error: "All invoices must belong to the same school" });

      if (String(inv.acYear) !== String(acYear))
        return res.status(400).json({ success: false, error: "Invoice academic year mismatch" });

      if (inv.status === "CANCELLED")
        return res.status(400).json({ success: false, error: `Invoice cancelled: ${inv._id}` });

      if (Number(inv.balance) <= 0)
        return res.status(400).json({ success: false, error: `Invoice already paid: ${inv._id}` });

      if (Number(it.amount) > Number(inv.balance))
        return res.status(400).json({ success: false, error: `Amount exceeds invoice balance: ${inv._id}` });

      if (String(inv.studentId) !== String(it.studentId))
        return res.status(400).json({ success: false, error: `Student mismatch for invoice: ${inv._id}` });
    }

    let batchDoc;

    await session.withTransaction(async () => {
      const batchNo = await getNextNumber({
        name: "Batch",
        prefix: "BAT",
        pad: 9
      });

      const created = await PaymentBatch.create(
        [
          {
            batchNo,
            schoolId,
            acYear,
            totalAmount,
            itemCount: normalizedItems.length,
            mode,
            referenceNo: referenceNo.trim(),
            proofUrl: proofUrl.trim(),
            paidDate: paidDate ? new Date(paidDate) : new Date(),
            status: "PENDING_APPROVAL",
            createdBy: req.user._id,
            remarks: remarks.trim(),
          },
        ],
        { session }
      );

      batchDoc = created[0];

      const itemDocs = normalizedItems.map((it) => ({
        batchId: batchDoc._id,
        schoolId,
        acYear,
        invoiceId: it.invoiceId,
        studentId: it.studentId,
        amount: it.amount,
        allocations: it.allocations,
        status: "PENDING_APPROVAL",
      }));

      await PaymentBatchItem.insertMany(itemDocs, { session });
    });

    return res.status(200).json({
      success: true,
      batchId: batchDoc._id,
      batchNo: batchDoc.batchNo,
      message: "Batch submitted to HQ for approval",
    });
  } catch (e) {
    console.log(e);
    return res.status(e.status || 500).json({ success: false, error: e.message || "server error" });
  } finally {
    await session.endSession();
  }
};

// School dashboard
export const schoolFeesDashboard = async (req, res) => {
  try {
    const { schoolId, acYear } = req.query;
    if (!schoolId || !acYear) {
      return res.status(400).json({ success: false, error: "schoolId/acYear required" });
    }

    const invAgg = await FeeInvoice.aggregate([
      {
        $match: {
          schoolId: new mongoose.Types.ObjectId(schoolId),
          acYear: new mongoose.Types.ObjectId(acYear),
        },
      },
      {
        $group: {
          _id: null,
          totalBilled: { $sum: "$total" },
          totalPaid: { $sum: "$paidTotal" },
          totalBalance: { $sum: "$balance" },
          dueCount: { $sum: { $cond: [{ $gt: ["$balance", 0] }, 1, 0] } },
        },
      },
    ]);

    const pendingBatchesCount = await PaymentBatch.countDocuments({
      schoolId,
      acYear,
      status: "PENDING_APPROVAL",
    });

    const s = invAgg[0] || { totalBilled: 0, totalPaid: 0, totalBalance: 0, dueCount: 0 };

    return res.status(200).json({
      success: true,
      dashboard: {
        totalBilled: s.totalBilled,
        totalPaid: s.totalPaid,
        totalBalance: s.totalBalance,
        dueCount: s.dueCount,
        pendingBatchesCount,
      },
    });
  } catch (e) {
    console.log(e);
    return res.status(500).json({ success: false, error: "school dashboard error" });
  }
};

