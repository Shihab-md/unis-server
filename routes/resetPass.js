import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import {
    findUserForResetPassword,
    resetPasswordByLoginId,
} from "../controllers/ResetPasswordController.js";

const router = express.Router()

router.post("/reset-password/find-user", authMiddleware, findUserForResetPassword);
router.post("/reset-password/submit", authMiddleware, resetPasswordByLoginId);

export default router 