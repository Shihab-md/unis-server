import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { addInstitute, upload, getInstitutes, getInstitute, updateInstitute, deleteInstitute } from '../controllers/instituteController.js'

const router = express.Router()

router.get('/', authMiddleware, getInstitutes)
router.post('/add', authMiddleware, upload.single('image'), addInstitute)
router.get('/:id', authMiddleware, getInstitute)
router.put('/:id', authMiddleware, updateInstitute)
router.delete('/:id', authMiddleware, deleteInstitute)
//router.get('/department/:id', authMiddleware, fetchInstitutesByDepId)

export default router