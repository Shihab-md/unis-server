import mongoose from "mongoose";

const helpDeskReplySchema = new mongoose.Schema(
  {
    message: { type: String, required: true, trim: true, maxlength: 2500 },
    repliedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    repliedByName: { type: String, default: "", trim: true, maxlength: 120 },
    repliedByRole: { type: String, default: "", trim: true, maxlength: 40, index: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true, versionKey: false }
);

const helpDeskQuerySchema = new mongoose.Schema(
  {
    subject: { type: String, required: true, trim: true, maxlength: 160, index: true },
    category: {
      type: String,
      enum: [
        "General",
        "Student",
        "Employee",
        "Fees / Invoice / Payment",
        "Certificate",
        "Report",
        "Account",
        "Login / Access",
        "Mobile App",
        "Bug / Issue",
        "Suggestion",
        "Other",
      ],
      default: "General",
      index: true,
    },
    priority: {
      type: String,
      enum: ["Low", "Normal", "High", "Urgent"],
      default: "Normal",
      index: true,
    },
    message: { type: String, required: true, trim: true, maxlength: 2500 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    createdByName: { type: String, default: "", trim: true, maxlength: 120 },
    createdByRole: { type: String, default: "", trim: true, maxlength: 40, index: true },

    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", default: null, index: true },
    schoolCode: { type: String, default: "", trim: true, maxlength: 40, index: true },
    schoolName: { type: String, default: "", trim: true, maxlength: 180 },

    status: {
      type: String,
      enum: ["Open", "In Progress", "Answered", "Closed"],
      default: "Open",
      index: true,
    },

    replies: { type: [helpDeskReplySchema], default: [] },

    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessageBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    lastMessageByRole: { type: String, default: "", trim: true, maxlength: 40, index: true },

    readBySuperadminAt: { type: Date, default: null, index: true },
    readByUserAt: { type: Date, default: null, index: true },

    active: { type: Boolean, default: true, index: true },
    closedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);

helpDeskQuerySchema.index({ status: 1, priority: 1, lastMessageAt: -1 });
helpDeskQuerySchema.index({ createdBy: 1, lastMessageAt: -1 });
helpDeskQuerySchema.index({ schoolId: 1, lastMessageAt: -1 });
helpDeskQuerySchema.index({ active: 1, lastMessageAt: -1 });

const HelpDeskQuery = mongoose.model("HelpDeskQuery", helpDeskQuerySchema);
export default HelpDeskQuery;
