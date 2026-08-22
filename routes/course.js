import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { addCourse, getCourses, getCourse, updateCourse, deleteCourse, getCoursesFromCache } from '../controllers/courseController.js'
import { requireMasterReadRole, requireMasterManageRole } from '../middleware/authorizationMiddleware.js'
import { auditMutation } from '../middleware/auditMiddleware.js'

const router = express.Router()

router.get('/', authMiddleware, requireMasterReadRole, getCourses)
router.post('/add', authMiddleware, requireMasterManageRole, auditMutation({ action: 'COURSE_CREATE', resourceType: 'Course' }), addCourse)

// Broad authenticated lookup is intentionally preserved for existing production forms.
router.get('/fromCache/', authMiddleware, getCoursesFromCache)

router.get('/:id', authMiddleware, requireMasterReadRole, getCourse)
router.put('/:id', authMiddleware, requireMasterManageRole, auditMutation({ action: 'COURSE_UPDATE', resourceType: 'Course' }), updateCourse)
router.delete('/:id', authMiddleware, requireMasterManageRole, auditMutation({ action: 'COURSE_DELETE', resourceType: 'Course' }), deleteCourse)

export default router
