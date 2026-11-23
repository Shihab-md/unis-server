import mongoose from "mongoose";

const idText = (value) => String(value?._id ?? value ?? "");

// Invoice year is authoritative. The item snapshot supports legacy/orphan records.
export const itemAcademicYearId = (item) =>
  idText(item.invoiceId?.acYear) || idText(item.acYear);

export const findAcademicYearBatchIds = async ({ FeeInvoice, PaymentBatchItem, acYear, schoolId }) => {
  const yearId = new mongoose.Types.ObjectId(acYear);
  const scope = schoolId ? { schoolId: new mongoose.Types.ObjectId(schoolId) } : {};
  const itemBatchIds = await PaymentBatchItem.distinct("batchId", { ...scope, acYear: yearId });
  // Also find older items whose stored year is absent or differs from their invoice.
  const invoiceBatches = await FeeInvoice.aggregate([
    { $match: { ...scope, acYear: yearId } },
    { $lookup: {
      from: PaymentBatchItem.collection.name,
      localField: "_id",
      foreignField: "invoiceId",
      as: "batchItems",
    } },
    { $unwind: "$batchItems" },
    { $match: { $expr: { $eq: ["$schoolId", "$batchItems.schoolId"] } } },
    { $group: { _id: "$batchItems.batchId" } },
  ]);
  return [...new Map([...itemBatchIds, ...invoiceBatches.map((row) => row._id)]
    .filter(Boolean).map((id) => [String(id), id])).values()];
};

export const scopeBatchesToAcademicYear = (batches, items, acYear) => {
  const grouped = new Map();
  for (const item of items) {
    const key = idText(item.batchId);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  return batches.flatMap((batch) => {
    const allItems = grouped.get(idText(batch._id)) || [];
    const yearItems = allItems.filter((item) => itemAcademicYearId(item) === String(acYear));
    if (!yearItems.length) return [];
    const yearTotalAmount = yearItems.reduce((paise, item) =>
      paise + Math.round(Number(item.amount || 0) * 100), 0) / 100;
    return [{
      ...batch,
      items: yearItems,
      yearTotalAmount,
      yearItemCount: yearItems.length,
      isPartialAcademicYear: yearItems.length < Math.max(allItems.length, Number(batch.itemCount || 0)),
    }];
  });
};
