import mongoose from "mongoose";
const { Schema } = mongoose;
const schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  requestKey: { type: String, required: true }, quoteHash: { type: String, required: true },
  studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
  academicId: { type: Schema.Types.ObjectId, ref: "Academic", required: true },
  schoolId: { type: Schema.Types.ObjectId, ref: "School", required: true },
  slot: { type: Number, required: true, min: 1, max: 5 },
  acYear: String, actorName: String, reason: { type: String, maxlength: 500 },
  oldSlot: { type: Schema.Types.Mixed, required: true }, newSlot: { type: Schema.Types.Mixed, required: true },
  differencePaise: { type: Number, required: true },
  academicBefore: { type: Schema.Types.Mixed, required: true }, academicAfter: { type: Schema.Types.Mixed, required: true },
  notificationUserIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
}, { timestamps: true });
schema.index({ userId: 1, requestKey: 1 }, { unique: true });
schema.index({ studentId: 1, createdAt: -1 });
export default mongoose.model("StudentCourseChange", schema);
