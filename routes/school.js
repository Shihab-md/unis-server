import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { addSchool, upload, getSchools, getSchool, updateSchool, deleteSchool, getSchoolsFromCache, getBySchFilter } from '../controllers/schoolController.js'
import { requireSchoolReadRole, requireSchoolManageRole, requireSchoolReadAccess } from '../middleware/authorizationMiddleware.js'
import { auditMutation } from '../middleware/auditMiddleware.js'
import { notifyOnSuccess } from '../middleware/notificationMiddleware.js'

const router = express.Router()

// V0.11: preserve Web read compatibility while enforcing mutations at the server.
router.get('/', authMiddleware, requireSchoolReadRole, getSchools)
router.get('/fromCache/', authMiddleware, getSchoolsFromCache)
router.get('/bySchFilter/:supervisorId/:districtStateId/:schStatus', authMiddleware, requireSchoolReadRole, getBySchFilter)

router.post('/add', authMiddleware,
  auditMutation({ action: 'SCHOOL_CREATE', resourceType: 'School' }),
  notifyOnSuccess({
    type: 'school.created', title: 'Niswan created', message: 'A Niswan record was created successfully.',
    resourceType: 'School',
    webPath: (_req, payload) => payload?.resourceId ? `/dashboard/schools/${payload.resourceId}` : '/dashboard/schools',
    mobilePath: (_req, payload) => payload?.resourceId ? `/(app)/schools/${payload.resourceId}` : '/(app)/(tabs)/schools',
  }),
  requireSchoolManageRole, upload.single('file'), addSchool)

router.get('/:id', authMiddleware, requireSchoolReadRole, requireSchoolReadAccess('id'), getSchool)
router.put('/:id', authMiddleware,
  auditMutation({ action: 'SCHOOL_UPDATE', resourceType: 'School' }),
  notifyOnSuccess({
    type: 'school.updated', title: 'Niswan updated', message: 'A Niswan record was updated successfully.',
    resourceType: 'School', resourceId: (req) => req.params.id,
    webPath: (req) => `/dashboard/schools/${req.params.id}`,
    mobilePath: (req) => `/(app)/schools/${req.params.id}`,
  }),
  requireSchoolManageRole, updateSchool)
router.delete('/:id', authMiddleware, auditMutation({ action: 'SCHOOL_DELETE', resourceType: 'School' }), requireSchoolManageRole, deleteSchool)

export default router
