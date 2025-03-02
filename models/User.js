import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    name: {type: String, required: true},
    email: {type: String, required: true},
    password: {type: String, required: true},
    role: {type: String, enum: ["admin", "employee", "supervisor", "teacher", "student", "parent"], required: true},
    profileImage: {type: Blob},
    createAt: {type: Date, default: Date.now},
    updatedAt: {type: Date, default: Date.now},
})

const User = mongoose.model("User", userSchema)
export default User