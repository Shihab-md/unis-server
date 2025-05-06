import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { addSupervisor, upload, getSupervisors, getSupervisor, updateSupervisor, deleteSupervisor } from '../controllers/supervisorController.js'

const router = express.Router()

router.get('/', authMiddleware, getSupervisors)
router.post('/add', authMiddleware, upload.single('file'), addSupervisor)
router.get('/:id', authMiddleware, getSupervisor)
router.put('/:id', authMiddleware, upload.single('file'), updateSupervisor)
router.delete('/:id', authMiddleware, deleteSupervisor)

export default router