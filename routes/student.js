import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import {
    addStudent, upload, getStudents, getStudent, updateStudent, deleteStudent, getStudentForEdit,
    getAcademic, getStudentsBySchool, getStudentsBySchoolAndTemplate, getStudentsCount, importStudentsData,
    getStudentForPromote, promoteStudent, getByFilter, markFeesPaid
} from '../controllers/studentController.js'

const router = express.Router()

router.get('/', authMiddleware, getStudents)
router.post('/add', authMiddleware, upload.single('file'), addStudent)
router.get('/:id', authMiddleware, getStudent)
router.get('/edit/:id', authMiddleware, getStudentForEdit)
router.put('/:id', authMiddleware, upload.single('file'), updateStudent)
router.put('/promote/:id', authMiddleware, upload.single('file'), promoteStudent)
router.delete('/:id', authMiddleware, deleteStudent)

router.get('/promote/:id', authMiddleware, getStudentForPromote)
router.get('/bySchoolId/:schoolId', authMiddleware, getStudentsBySchool)
router.get('/bySchoolIdAndCourse/:schoolId/:templateId', authMiddleware, getStudentsBySchoolAndTemplate)
router.get('/:studentId/:acaYear', authMiddleware, getAcademic)
router.get('/studCount', authMiddleware, getStudentsCount)
router.get('/byFilter/:schoolId/:courseId/:status/:acYear/:maritalStatus/:hosteller/:year/:instituteId/:courseStatus', authMiddleware, getByFilter)

router.post('/import', authMiddleware, importStudentsData)
router.post('/markFeesPaid', authMiddleware, markFeesPaid)

export default router