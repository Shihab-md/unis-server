import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import {addStudent, upload, getStudents, getStudent, updateStudent, deleteStudent} from '../controllers/studentController.js'

const router = express.Router()

router.get('/', authMiddleware, getStudents)
router.post('/add', authMiddleware, upload.single('image'), addStudent)
router.get('/:id', authMiddleware, getStudent)
router.put('/:id', authMiddleware, updateStudent)
router.delete('/:id', authMiddleware, deleteStudent)

export default router