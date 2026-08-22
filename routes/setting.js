import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { changePassword } from '../controllers/settingController.js'
import { auditMutation } from '../middleware/auditMiddleware.js'

const router = express.Router()
router.put('/change-password', authMiddleware, auditMutation({ action: 'PASSWORD_CHANGE', resourceType: 'User' }), changePassword)
export default router
