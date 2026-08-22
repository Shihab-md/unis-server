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
  requireStudentReadRole,
  requireStudentManageRole,
  requireGlobalStudentRead,
  requireSchoolParamReadAccess,
  requireSchoolParamAccess,
  requireBodySchoolAccess,
  requireStudentReadAccess,
  requireStudentAccess,
} from '../middleware/authorizationMiddleware.js'
import { auditMutation } from '../middleware/auditMiddleware.js'
import { notifyOnSuccess } from '../middleware/notificationMiddleware.js'

const router = express.Router()

// IMPORTANT: keep static/multi-segment routes before /:id routes.
// Existing production compatibility:
// - HQ: global Student read/write.
// - Guest: global/Niswan Student read-only, matching current web screens.
// - Admin: read/write only within the active Employee->schoolId Niswan scope.
router.get('/', authMiddleware, requireStudentReadRole, requireGlobalStudentRead, getStudents)
router.post('/add', authMiddleware,
  auditMutation({ action: 'STUDENT_CREATE', resourceType: 'Student' }),
  notifyOnSuccess({
    type: 'student.created', title: 'Student admission completed',
    message: 'Student admission was completed successfully.',
    resourceType: 'Student',
    webPath: (_req, payload) => payload?.resourceId ? `/dashboard/students/${payload.resourceId}` : '/dashboard/students',
    mobilePath: (_req, payload) => payload?.resourceId ? `/(app)/students/${payload.resourceId}` : '/(app)/(tabs)/students',
  }),
  requireStudentManageRole, upload.single('file'), requireBodySchoolAccess('schoolId'), addStudent)

router.get('/edit/:id', authMiddleware, requireStudentManageRole, requireStudentAccess('id'), getStudentForEdit)
router.get('/promote/:id', authMiddleware, requireStudentManageRole, requireStudentAccess('id'), getStudentForPromote)
router.put('/promote/:id', authMiddleware,
  auditMutation({ action: 'STUDENT_PROMOTE_SINGLE', resourceType: 'Student' }),
  notifyOnSuccess({
    type: 'student.promoted', title: 'Student promotion updated', message: 'A student promotion action completed successfully.',
    resourceType: 'Student', resourceId: (req) => req.params.id,
    webPath: (req) => `/dashboard/students/${req.params.id}`,
    mobilePath: (req) => `/(app)/students/${req.params.id}`,
  }),
  requireStudentManageRole, upload.single('file'), requireStudentAccess('id'), requireBodySchoolAccess('schoolId'), promoteStudent)

router.get('/bySchoolId/:schoolId', authMiddleware, requireStudentReadRole, requireSchoolParamReadAccess('schoolId'), getStudentsBySchool)
router.get('/bySchoolIdAndCourse/:schoolId/:templateId', authMiddleware, requireStudentReadRole, requireSchoolParamReadAccess('schoolId'), getStudentsBySchoolAndTemplate)
router.get('/studCount', authMiddleware, requireStudentReadRole, requireGlobalStudentRead, getStudentsCount)
router.get('/byFilter/:schoolId/:courseId/:status/:acYear/:maritalStatus/:hosteller/:year/:instituteId/:courseStatus', authMiddleware, requireStudentReadRole, requireSchoolParamReadAccess('schoolId'), getByFilter)
router.get('/promote/candidates/:schoolId/:targetAcYear/:courseId', authMiddleware, requireStudentManageRole, requireSchoolParamAccess('schoolId'), listPromoteCandidates)

// Import/remove/fees utilities remain HQ-only. Bulk promotion remains available to Admin
// for its own Niswan, preserving the existing web workflow while preventing forged schoolId.
const notifyStudentImportComplete = notifyOnSuccess({
  type: 'student.import', title: 'Student import completed', message: 'A Student Excel import batch completed successfully.',
  resourceType: 'StudentImport', webPath: () => '/dashboard/students', mobilePath: () => '/(app)/bulk/student-import',
})
const notifyOnlyOnMobileFinalChunk = (notifier) => (req, res, next) =>
  String(req.headers['x-unis-final-chunk'] || '').toLowerCase() === 'true' ? notifier(req, res, next) : next()

router.post('/import', authMiddleware,
  auditMutation({ action: 'STUDENT_IMPORT', resourceType: 'StudentImport' }),
  notifyOnlyOnMobileFinalChunk(notifyStudentImportComplete),
  requireStudentManageRole, requireHQ, importStudentsData)
router.post('/markFeesPaid', authMiddleware, requireStudentManageRole, requireHQ, markFeesPaid)
router.post('/removeStudents', authMiddleware,
  auditMutation({ action: 'STUDENT_BULK_REMOVE', resourceType: 'StudentCleanup' }),
  notifyOnSuccess({
    type: 'student.cleanup', title: 'Student cleanup completed', message: 'A bulk Student cleanup operation completed successfully.',
    resourceType: 'StudentCleanup', webPath: () => '/dashboard/students', mobilePath: () => '/(app)/bulk/student-cleanup',
  }),
  requireStudentManageRole, requireHQ, removeStudents)
router.post('/promote/bulk', authMiddleware,
  auditMutation({ action: 'STUDENT_PROMOTE_BULK', resourceType: 'Student' }),
  notifyOnSuccess({
    type: 'student.promotion.batch', title: 'Student promotion completed', message: 'A student promotion batch completed successfully.',
    resourceType: 'Student',
    webPath: () => '/dashboard/students',
    mobilePath: () => '/(app)/students/promotion',
  }),
  requireStudentManageRole, requireBodySchoolAccess('schoolId'), promoteStudentsBulkByCourse)

router.get('/:studentId/:acaYear', authMiddleware, requireStudentReadRole, requireStudentReadAccess('studentId'), getAcademic)
router.get('/:id', authMiddleware, requireStudentReadRole, requireStudentReadAccess('id'), getStudent)
router.put('/:id', authMiddleware,
  auditMutation({ action: 'STUDENT_UPDATE', resourceType: 'Student' }),
  notifyOnSuccess({
    type: 'student.updated', title: 'Student record updated', message: 'Student details were updated successfully.',
    resourceType: 'Student', resourceId: (req) => req.params.id,
    webPath: (req) => `/dashboard/students/${req.params.id}`,
    mobilePath: (req) => `/(app)/students/${req.params.id}`,
  }),
  requireStudentManageRole, upload.single('file'), requireStudentAccess('id'), requireBodySchoolAccess('schoolId'), updateStudent)
// Preserve production Admin delete behavior, but enforce own-Niswan ownership on the server.
router.delete('/:id', authMiddleware, auditMutation({ action: 'STUDENT_DELETE', resourceType: 'Student' }), requireStudentManageRole, requireStudentAccess('id'), deleteStudent)

export default router
