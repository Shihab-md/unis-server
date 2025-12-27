import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true },
    role: {
        type: String, index: true,
        enum: ["superadmin", "hquser", "supervisor", "admin", "employee",
            "teacher", "usthadh", "student", "parent", "warden", "staff"], required: true
    },
    profileImage: { type: String },
    createAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
})

const User = mongoose.model("User", userSchema)
export default User