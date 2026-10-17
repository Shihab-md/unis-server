import mongoose from "mongoose";
import HqFinanceState from "../models/HqFinanceState.js";
import TravelClaim from "../models/TravelClaim.js";
import PayrollRun from "../models/PayrollRun.js";
import { failTa } from "../utils/travelClaimPolicy.js";

let initialized;
export function initializeTaWorkflow() {
  if (!initialized) initialized = (async () => {
    // Provision outside a transaction: the first two requests must never race
    // to insert the finance singleton or build indexes inside their transaction.
    await TravelClaim.createCollection();
    await TravelClaim.createIndexes();
    await PayrollRun.createCollection();
    await HqFinanceState.createCollection();
    try { await HqFinanceState.updateOne({ _id: "HQ_TA_PAYROLL" }, { $setOnInsert: { revision: 0 } }, { upsert: true }); }
    catch (error) { if (error.code !== 11000) throw error; }
  })().catch((error) => { initialized = null; throw error; });
  return initialized;
}

export async function withHqFinanceTransaction(work) {
  await initializeTaWorkflow();
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const state = await HqFinanceState.findOneAndUpdate({ _id: "HQ_TA_PAYROLL" }, { $inc: { revision: 1 } }, { session, new: true, maxTimeMS: 15000 });
      if (!state) failTa("TA_UNAVAILABLE", 503);
      result = await work(session);
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary", maxCommitTimeMS: 15000, timeoutMS: 55000 });
    return result;
  } finally { await session.endSession(); }
}
