import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { addSupervisor, upload, getSupervisors, getSupervisor, updateSupervisor } from '../controllers/supervisorController.js'

const router = express.Router()

router.get('/', authMiddleware, getSupervisors)
router.post('/add12', authMiddleware, upload.single('image'), addSupervisor)
router.get('/:id', authMiddleware, getSupervisor)
router.put('/:id', authMiddleware, updateSupervisor)
//router.get('/department/:id', authMiddleware, fetchSupervisorsByDepId)

export default router