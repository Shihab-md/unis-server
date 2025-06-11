import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import {addAcademicYear, getAcademicYears, getAcademicYear, updateAcademicYear, deleteAcademicYear, getAcademicYearsFromCache} from '../controllers/academicYearController.js'

const router = express.Router()

router.get('/', authMiddleware, getAcademicYears)
router.post('/add', authMiddleware, addAcademicYear)

router.get('/fromCache/', authMiddleware, getAcademicYearsFromCache)

router.get('/:id', authMiddleware, getAcademicYear)
router.put('/:id', authMiddleware, updateAcademicYear)
router.delete('/:id', authMiddleware, deleteAcademicYear)

export default router