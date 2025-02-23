import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import {addSchool, upload, getSchools, getSchool, updateSchool} from '../controllers/SchoolController.js'

const router = express.Router()

router.get('/', authMiddleware, getSchools)
router.post('/add', authMiddleware, upload.single('image'), addSchool)
router.get('/:id', authMiddleware, getSchool)
router.put('/:id', authMiddleware, updateSchool)
// router.get('/department/:id', authMiddleware, fetchSchoolsByDepId)

export default router