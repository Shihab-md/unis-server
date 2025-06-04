import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { getSummary, getMasterSummary } from '../controllers/dashboardController.js';

const router = express.Router()

router.get('/summary', authMiddleware, getSummary)
router.get('/masterSummary', authMiddleware, getMasterSummary)

export default router;