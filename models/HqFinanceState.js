import mongoose from "mongoose";
// A transaction writes this singleton before reading finance data. Concurrent
// approvals/payroll writes conflict and retry from a fresh snapshot.
const schema = new mongoose.Schema({ _id: String, revision: { type: Number, default: 0 }, driveFolderId: String }, { versionKey: false });
export default mongoose.model("HqFinanceState", schema);
