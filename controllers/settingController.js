import User from "../models/User.js";
import bcrypt from "bcrypt";

// Same rule as frontend: 8–64 chars, 1 upper, 1 lower, 1 number, 1 special, no spaces
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s])\S{8,64}$/;

const validateNewPassword = (pw) => {
    if (!pw) return "New password is required";
    if (typeof pw !== "string") return "New password must be a string";
    if (pw.length < 8) return "Password must be at least 8 characters";
    if (pw.length > 64) return "Password must be at most 64 characters";
    if (/\s/.test(pw)) return "Password must not contain spaces";
    if (!PASSWORD_REGEX.test(pw))
        return "Password must include uppercase, lowercase, number, and special character";
    return "";
};

const changePassword = async (req, res) => {
    try {
        // NOTE: Better approach is to take userId from JWT middleware: req.user._id
        // For now, keep your current contract.
        //const { userId, oldPassword, newPassword } = req.body;

        const userId = req.user?._id;
        const { oldPassword, newPassword } = req.body;

        if (!userId) {
            return res.status(400).json({ success: false, error: "userId is required" });
        }
        if (!oldPassword) {
            return res.status(400).json({ success: false, error: "Old password is required" });
        }

        const pwErr = validateNewPassword(newPassword);
        if (pwErr) {
            return res.status(400).json({ success: false, error: pwErr });
        }

        // Fetch only password (smaller payload)
        const user = await User.findById(userId).select("password");
        if (!user) {
            return res.status(404).json({ success: false, error: "User not found" });
        }

        // Check old password
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) {
            // 401 is more correct than 404 here
            return res.status(401).json({ success: false, error: "Wrong old password" });
        }

        // Optional: prevent setting same password again
        const isSameAsOld = await bcrypt.compare(newPassword, user.password);
        if (isSameAsOld) {
            return res.status(400).json({
                success: false,
                error: "New password must be different from old password",
            });
        }

        // Hash and save
        const hashPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashPassword;
        await user.save();

        return res.status(200).json({ success: true });
    } catch (error) {
        console.log("[changePassword] error:", error);
        return res.status(500).json({ success: false, error: "setting error" });
    }
};

export { changePassword };