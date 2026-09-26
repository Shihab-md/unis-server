import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import {
    addStudent, upload, getStudents, getStudent, updateStudent, deleteStudent, getStudentForEdit,
    getAcademic, getStudentsBySchool, getStudentsBySchoolAndTemplate, getStudentsCount, importStudentsData,
    getStudentForPromote, promoteStudent, getByFilter, markFeesPaid, removeStudents,
    listPromoteCandidates, promoteStudentsBulkByCourse
} from '../controllers/studentController.js'
import {
  requireHQ,
  requireStudentManageRole,
  requireGlobalStudentRead,
  requireSchoolParamReadAccess,
  requireSchoolParamAccess,
  requireBodySchoolAccess,
  requireStudentReadAccess,
  requireStudentAccess,
} from '../middleware/authorizationMiddleware.js'
import { requirePermission } from '../middleware/permissionMiddleware.js'
import { PERMISSIONS } from '../config/permissionCatalog.js'
import { auditMutation } from '../middleware/auditMiddleware.js'
import { notifyOnSuccess } from '../middleware/notificationMiddleware.js'

const router = express.Router()

// IMPORTANT: keep static/multi-segment routes before /:id routes.
// Phase 2.1 moves core Student operations to DB-managed permissions while retaining
// all existing global/assigned/own-Niswan access checks. Bulk import/cleanup and
// finance utilities remain on their legacy guards until their later subphases.
router.get('/', authMiddleware,
  requirePermission(PERMISSIONS.STUDENT_VIEW, 'You do not have permission to view Students.'),
  requireGlobalStudentRead, getStudents)

router.post('/add', authMiddleware,
  auditMutation({ action: 'STUDENT_CREATE', resourceType: 'Student' }),
  notifyOnSuccess({
    type: 'student.created', title: 'Student admission completed',
    message: 'Student admission was completed successfully.',
    resourceType: 'Student',
    webPath: (_req, payload) => payload?.resourceId ? `/dashboard/students/${payload.resourceId}` : '/dashboard/students',
    mobilePath: (_req, payload) => payload?.resourceId ? `/(app)/students/${payload.resourceId}` : '/(app)/(tabs)/students',
  }),
  requirePermission(PERMISSIONS.STUDENT_CREATE, 'You do not have permission to create Students.'),
  upload.single('file'), requireBodySchoolAccess('schoolId'), addStudent)

router.get('/edit/:id', authMiddleware,
  requirePermission(PERMISSIONS.STUDENT_EDIT, 'You do not have permission to edit Students.'),
  requireStudentAccess('id'), getStudentForEdit)

router.get('/promote/:id', authMiddleware,
  requirePermission(PERMISSIONS.STUDENT_PROMOTE, 'You do not have permission to promote Students.'),
  requireStudentAccess('id'), getStudentForPromote)

router.put('/promote/:id', authMiddleware,
  auditMutation({ action: 'STUDENT_PROMOTE_SINGLE', resourceType: 'Student' }),
  notifyOnSuccess({
    type: 'student.promoted', title: 'Student promotion updated', message: 'A student promotion action completed successfully.',
    resourceType: 'Student', resourceId: (req) => req.params.id,
    webPath: (req) => `/dashboard/students/${req.params.id}`,
    mobilePath: (req) => `/(app)/students/${req.params.id}`,
  }),
  requirePermission(PERMISSIONS.STUDENT_PROMOTE, 'You do not have permission to promote Students.'),
  upload.single('file'), requireStudentAccess('id'), requireBodySchoolAccess('schoolId'), promoteStudent)

router.get('/bySchoolId/:schoolId', authMiddleware,
  requirePermission(PERMISSIONS.STUDENT_VIEW, 'You do not have permission to view Students.'),
  requireSchoolParamReadAccess('schoolId'), getStudentsBySchool)

router.get('/bySchoolIdAndCourse/:schoolId/:templateId', authMiddleware,
  requirePermission(PERMISSIONS.STUDENT_VIEW, 'You do not have permission to view Students.'),
  requireSchoolParamReadAccess('schoolId'), getStudentsBySchoolAndTemplate)

router.get('/studCount', authMiddleware,
  requirePermission(PERMISSIONS.STUDENT_VIEW, 'You do not have permission to view Students.'),
  requireGlobalStudentRead, getStudentsCount)

router.get('/byFilter/:schoolId/:courseId/:status/:acYear/:maritalStatus/:hosteller/:year/:instituteId/:courseStatus', authMiddleware,
  requirePermission(PERMISSIONS.STUDENT_VIEW, 'You do not have permission to view Students.'),
  requireSchoolParamReadAccess('schoolId'), getByFilter)

router.get('/promote/candidates/:schoolId/:targetAcYear/:courseId', authMiddleware,
  requirePermission(PERMISSIONS.STUDENT_PROMOTE, 'You do not have permission to promote Students.'),
  requireSchoolParamAccess('schoolId'), listPromoteCandidates)

// Phase 2.5.2 puts Student import/cleanup behind database-managed permissions while
// preserving the existing HQ-only business boundary. The finance utility remains unchanged.
const notifyStudentImportComplete = notifyOnSuccess({
  type: 'student.import', title: 'Student import completed', message: 'A Student Excel import batch completed successfully.',
  resourceType: 'StudentImport', webPath: () => '/dashboard/students', mobilePath: () => '/(app)/bulk/student-import',
})
const notifyOnlyOnMobileFinalChunk = (notifier) => (req, res, next) =>
  String(req.headers['x-unis-final-chunk'] || '').toLowerCase() === 'true' ? notifier(req, res, next) : next()

router.post('/import', authMiddleware,
  auditMutation({ action: 'STUDENT_IMPORT', resourceType: 'StudentImport' }),
  notifyOnlyOnMobileFinalChunk(notifyStudentImportComplete),
  requirePermission(PERMISSIONS.STUDENT_IMPORT, 'You do not have permission to import Students.'),
  requireStudentManageRole, requireHQ, importStudentsData)
router.post('/markFeesPaid', authMiddleware, requireStudentManageRole, requireHQ, markFeesPaid)
router.post('/removeStudents', authMiddleware,
  auditMutation({ action: 'STUDENT_BULK_REMOVE', resourceType: 'StudentCleanup' }),
  notifyOnSuccess({
    type: 'student.cleanup', title: 'Student cleanup completed', message: 'A bulk Student cleanup operation completed successfully.',
    resourceType: 'StudentCleanup', webPath: () => '/dashboard/students', mobilePath: () => '/(app)/bulk/student-cleanup',
  }),
  requirePermission(PERMISSIONS.STUDENT_CLEANUP, 'You do not have permission to remove Students in bulk.'),
  requireStudentManageRole, requireHQ, removeStudents)

router.post('/promote/bulk', authMiddleware,
  auditMutation({ action: 'STUDENT_PROMOTE_BULK', resourceType: 'Student' }),
  notifyOnSuccess({
    type: 'student.promotion.batch', title: 'Student promotion completed', message: 'A student promotion batch completed successfully.',
    resourceType: 'Student',
    webPath: () => '/dashboard/students',
    mobilePath: () => '/(app)/students/promotion',
  }),
  requirePermission(PERMISSIONS.STUDENT_PROMOTE, 'You do not have permission to promote Students.'),
  requireBodySchoolAccess('schoolId'), promoteStudentsBulkByCourse)

router.get('/:studentId/:acaYear', authMiddleware,
  requirePermission(PERMISSIONS.STUDENT_VIEW, 'You do not have permission to view Students.'),
  requireStudentReadAccess('studentId'), getAcademic)

router.get('/:id', authMiddleware,
  requirePermission(PERMISSIONS.STUDENT_VIEW, 'You do not have permission to view Students.'),
  requireStudentReadAccess('id'), getStudent)

router.put('/:id', authMiddleware,
  auditMutation({ action: 'STUDENT_UPDATE', resourceType: 'Student' }),
  notifyOnSuccess({
    type: 'student.updated', title: 'Student record updated', message: 'Student details were updated successfully.',
    resourceType: 'Student', resourceId: (req) => req.params.id,
    webPath: (req) => `/dashboard/students/${req.params.id}`,
    mobilePath: (req) => `/(app)/students/${req.params.id}`,
  }),
  requirePermission(PERMISSIONS.STUDENT_EDIT, 'You do not have permission to edit Students.'),
  upload.single('file'), requireStudentAccess('id'), requireBodySchoolAccess('schoolId'), updateStudent)

router.delete('/:id', authMiddleware,
  auditMutation({ action: 'STUDENT_DELETE', resourceType: 'Student' }),
  requirePermission(PERMISSIONS.STUDENT_DELETE, 'You do not have permission to delete Students.'),
  requireStudentAccess('id'), deleteStudent)

export default router
