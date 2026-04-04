import bcrypt from "bcrypt";
import User from "../models/User.js";
import Supervisor from "../models/Supervisor.js";
import Employee from "../models/Employee.js";
import Student from "../models/Student.js";
import { toCamelCase } from "./commonController.js";

const cleanValue = (value) => String(value || "").trim();

const normalizeFoundUser = ({ roleLabel, entity, loginIdField }) => {
    const user = entity?.userId;

    return {
        name: user?.name || "",
        role: roleLabel,
        loginId: entity?.[loginIdField] || user?.email || "",
        userId: user?._id || "",
        email: user?.email || "",
        entityId: entity?._id || "",
    };
};

const findUserByLoginId = async (loginId) => {
    const value = cleanValue(loginId);
    if (!value) return null;

    const supervisor = await Supervisor.findOne({ supervisorId: value }).populate({
        path: "userId",
        select: "name email role",
    });

    if (supervisor?.userId?._id) {
        return normalizeFoundUser({
            roleLabel: "Supervisor",
            entity: supervisor,
            loginIdField: "supervisorId",
        });
    }

    const employee = await Employee.findOne({ employeeId: value }).populate({
        path: "userId",
        select: "name email role",
    });

    if (employee?.userId?._id) {
        return normalizeFoundUser({
            roleLabel: toCamelCase(String(employee?.userId?.role || "").trim()) || "-",
            entity: employee,
            loginIdField: "employeeId",
        });
    }

    const student = await Student.findOne({ rollNumber: value }).populate({
        path: "userId",
        select: "name email role",
    });

    if (student?.userId?._id) {
        return normalizeFoundUser({
            roleLabel: "Student",
            entity: student,
            loginIdField: "rollNumber",
        });
    }

    return null;
};

const findUserForResetPassword = async (req, res) => {
    try {
        const loginId = cleanValue(req.body?.loginId);

        if (!loginId) {
            return res.status(400).json({
                success: false,
                error: "User ID is required.",
            });
        }

        const foundUser = await findUserByLoginId(loginId);

        if (!foundUser) {
            return res.status(404).json({
                success: false,
                error: "User not found.",
            });
        }

        return res.status(200).json({
            success: true,
            user: foundUser,
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            error: "server error in finding user for reset password.",
        });
    }
};

const resetPasswordByLoginId = async (req, res) => {
    try {
        const loginId = cleanValue(req.body?.loginId);
        const newPassword = cleanValue(req.body?.newPassword);
        const confirmPassword = cleanValue(req.body?.confirmPassword);

        if (!loginId) {
            return res.status(400).json({
                success: false,
                error: "User ID is required.",
            });
        }

        if (!newPassword || !confirmPassword) {
            return res.status(400).json({
                success: false,
                error: "New password and confirm password are required.",
            });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({
                success: false,
                error: "Password and confirm password do not match.",
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                error: "Password must be at least 6 characters.",
            });
        }

        const foundUser = await findUserByLoginId(loginId);

        if (!foundUser?.userId) {
            return res.status(404).json({
                success: false,
                error: "User not found.",
            });
        }

        const hashPassword = await bcrypt.hash(newPassword, 10);

        await User.findByIdAndUpdate(
            { _id: foundUser.userId },
            {
                password: hashPassword,
                updatedAt: new Date(),
                // forcePasswordChange: true, // uncomment only if your User model already has this field
            }
        );

        return res.status(200).json({
            success: true,
            message: "Password reset successful.",
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            error: "server error in reset password.",
        });
    }
};

export { findUserForResetPassword, resetPasswordByLoginId };