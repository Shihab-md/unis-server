import mongoose from "mongoose";
import { Schema } from "mongoose";

const districtStateSchema = new Schema({
  district: { type: String, required: true, unique: true },
  state: { type: String, required: true },

  _studentsCount: { type: Number },
});

districtStateSchema.virtual('studentsCount').
  get(function () { return this._studentsCount; }).
  set(function (count) { this._studentsCount = count; });

const DistrictState = mongoose.model("DistrictState", districtStateSchema);
export default DistrictState;