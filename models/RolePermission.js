import mongoose from "mongoose";

const rolePermissionSchema = new mongoose.Schema({
  role: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true,
    index: true,
  },
  permissions: {
    type: [String],
    default: [],
  },
  revision: {
    type: Number,
    default: 1,
    min: 1,
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const RolePermission = mongoose.model("RolePermission", rolePermissionSchema);
export default RolePermission;
