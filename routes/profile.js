import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { getProfile, updatePassword } from '../controllers/profileController.js';

const router = express.Router()

router.get('/', authMiddleware, getProfile)
router.put('/updatePassword', authMiddleware, updatePassword)

export default router;