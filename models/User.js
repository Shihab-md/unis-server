import mongoose from "mongoose";
import { USER_ROLE_KEYS } from "../config/rolePolicy.js";

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true },
    role: {
        type: String, index: true,
        enum: USER_ROLE_KEYS, required: true
    },
    profileImage: { type: String },
    preferredLanguage: {
        type: String,
        enum: ["en", "ta", "ur", "ar", "ml", "kn", "te"],
        default: "en",
    },
    createAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
})

const User = mongoose.model("User", userSchema)
export default User