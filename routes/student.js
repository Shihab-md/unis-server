import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import {
    addStudent, upload, getStudents, getStudent, updateStudent, deleteStudent,
    getAcademic, getStudentsBySchool, getStudentsBySchoolAndTemplate, getStudentsCount, importStudentsData
} from '../controllers/studentController.js'

const router = express.Router()

router.get('/', authMiddleware, getStudents)
router.post('/add', authMiddleware, upload.single('file'), addStudent)
router.get('/:id', authMiddleware, getStudent)
router.put('/:id', authMiddleware, upload.single('file'), updateStudent)
router.delete('/:id', authMiddleware, deleteStudent)

router.get('/bySchoolId/:schoolId', authMiddleware, getStudentsBySchool)
router.get('/bySchoolIdAndCourse/:schoolId/:templateId', authMiddleware, getStudentsBySchoolAndTemplate)
router.get('/:studentId/:acaYear', authMiddleware, getAcademic)
router.get('/studCount', authMiddleware, getStudentsCount)

router.post('/import', authMiddleware, importStudentsData)

export default router