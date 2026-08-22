import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { findUserForResetPassword, resetPasswordByLoginId } from '../controllers/ResetPasswordController.js'
import { requireSuperAdmin } from '../middleware/authorizationMiddleware.js'
import { auditMutation } from '../middleware/auditMiddleware.js'

const router = express.Router()

// The production Web exposes Reset Password only from Superadmin Masters.
router.post('/reset-password/find-user', authMiddleware, requireSuperAdmin, findUserForResetPassword)
router.post('/reset-password/submit', authMiddleware, requireSuperAdmin,
  auditMutation({ action: 'PASSWORD_RESET', resourceType: 'User' }), resetPasswordByLoginId)

export default router
