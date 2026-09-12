import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { getProfile, updateLanguage, updatePassword } from '../controllers/profileController.js';

const router = express.Router()

router.get('/', authMiddleware, getProfile)
router.put('/language', authMiddleware, updateLanguage)
router.put('/updatePassword', authMiddleware, updatePassword)

export default router;