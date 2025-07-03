import mongoose from "mongoose";
import { Schema } from "mongoose";

const schoolSchema = new Schema({
  code: { type: String, required: true, unique: true },
  nameEnglish: { type: String, required: true },
  nameArabic: { type: String },
  nameNative: { type: String },

  address: { type: String, required: true },
  city: { type: String },
  landmark: { type: String },
  pincode: { type: Number },
  districtStateId: { type: Schema.Types.ObjectId, ref: "DistrictState", required: true },

  contactNumber: { type: Number },
  doe: { type: Date },
  email: { type: String },
  supervisorId: { type: Schema.Types.ObjectId, ref: "Supervisor", required: true, index: true },

  incharge1: { type: String, required: true },
  incharge1Number: { type: Number, required: true },
  designation1: { type: String },

  incharge2: { type: String },
  incharge2Number: { type: Number },
  designation2: { type: String },

  incharge3: { type: String },
  incharge3Number: { type: Number },
  designation3: { type: String },

  incharge4: { type: String },
  incharge4Number: { type: Number },
  designation4: { type: String },

  incharge5: { type: String },
  incharge5Number: { type: Number },
  designation5: { type: String },

  incharge6: { type: String },
  incharge6Number: { type: Number },
  designation6: { type: String },

  incharge7: { type: String },
  incharge7Number: { type: Number },
  designation7: { type: String },

  active: {
    type: String,
    enum: ["Active", "In-Active"],
    default: "Active",
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },

  _studentsCount: { type: Number },
});

schoolSchema.virtual('studentsCount').
  get(function () { return this._studentsCount; }).
  set(function (count) { this._studentsCount = count; });

const School = mongoose.model("School", schoolSchema);
export default School;
