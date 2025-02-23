import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import {addSchool, upload, getSchools, getSchool, updateSchool} from '../controllers/schoolController.js'

const router = express.Router()

router.get('/', authMiddleware, getSchools)
router.post('/add', authMiddleware, upload.single('image'), addSchool)
router.get('/:id', authMiddleware, getSchool)
router.put('/:id', authMiddleware, updateSchool)
router.delete('/:id', authMiddleware, deleteSchool)
// router.get('/department/:id', authMiddleware, fetchSchoolsByDepId)

export default router