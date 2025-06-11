import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { addCourse, getCourses, getCourse, updateCourse, deleteCourse, getCoursesFromCache } from '../controllers/courseController.js'

const router = express.Router()

router.get('/', authMiddleware, getCourses)
router.post('/add', authMiddleware, addCourse)

router.get('/fromCache/', authMiddleware, getCoursesFromCache)

router.get('/:id', authMiddleware, getCourse)
router.put('/:id', authMiddleware, updateCourse)
router.delete('/:id', authMiddleware, deleteCourse)

export default router