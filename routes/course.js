import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { addCourse, getCourses, getCourse, updateCourse, deleteCourse, getCoursesFromCache } from '../controllers/courseController.js'
import { requireMasterReadRole, requireMasterManageRole } from '../middleware/authorizationMiddleware.js'
import { requirePermission } from '../middleware/permissionMiddleware.js'
import { PERMISSIONS } from '../config/permissionCatalog.js'
import { auditMutation } from '../middleware/auditMiddleware.js'

const router = express.Router()

router.get('/', authMiddleware, requirePermission(PERMISSIONS.MASTER_COURSE_VIEW, "You do not have permission to view Courses."), requireMasterReadRole, getCourses)
router.post('/add', authMiddleware, requirePermission(PERMISSIONS.MASTER_COURSE_CREATE, "You do not have permission to create Courses."), requireMasterManageRole, auditMutation({ action: 'COURSE_CREATE', resourceType: 'Course' }), addCourse)

// Broad authenticated lookup is intentionally preserved for existing production forms.
router.get('/fromCache/', authMiddleware, getCoursesFromCache)

router.get('/:id', authMiddleware, requirePermission(PERMISSIONS.MASTER_COURSE_VIEW, "You do not have permission to view Courses."), requireMasterReadRole, getCourse)
router.put('/:id', authMiddleware, requirePermission(PERMISSIONS.MASTER_COURSE_EDIT, "You do not have permission to edit Courses."), requireMasterManageRole, auditMutation({ action: 'COURSE_UPDATE', resourceType: 'Course' }), updateCourse)
router.delete('/:id', authMiddleware, requirePermission(PERMISSIONS.MASTER_COURSE_DELETE, "You do not have permission to delete Courses."), requireMasterManageRole, auditMutation({ action: 'COURSE_DELETE', resourceType: 'Course' }), deleteCourse)

export default router
