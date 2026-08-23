import express from 'express'
import { login, verify, refresh } from '../controllers/authController.js'
import authMiddleware from '../middleware/authMiddlware.js'

const router = express.Router()

router.post('/login', login)
router.get('/verify', authMiddleware, verify)
router.post('/refresh', authMiddleware, refresh)

export default router;
