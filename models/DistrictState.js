import mongoose from "mongoose";
import { Schema } from "mongoose";

const districtStateSchema = new Schema({
  district: { type: String, required: true, unique: true },
  state: { type: String, required: true },
});

const DistrictState = mongoose.model("DistrictState", districtStateSchema);
export default DistrictState;