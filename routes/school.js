import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { addSchool, upload, getSchools, getSchool, updateSchool, deleteSchool, getSchoolsFromCache, getBySchFilter } from '../controllers/schoolController.js'
import { requireSchoolReadScope, requireSchoolReadAccess } from '../middleware/authorizationMiddleware.js'
import { requirePermission } from '../middleware/permissionMiddleware.js'
import { PERMISSIONS } from '../config/permissionCatalog.js'
import { auditMutation } from '../middleware/auditMiddleware.js'
import { notifyOnSuccess } from '../middleware/notificationMiddleware.js'

const router = express.Router()

// Phase 2.1: role -> permission assignment is database-managed. Existing Niswan
// scope remains enforced independently by authorization middleware/controllers.
router.get('/', authMiddleware,
  requirePermission(PERMISSIONS.NISWAN_VIEW, 'You do not have permission to view Niswans.'),
  requireSchoolReadScope,
  getSchools)

// Cache lookup remains an authenticated shared lookup used by multiple existing forms.
router.get('/fromCache/', authMiddleware, getSchoolsFromCache)

router.get('/bySchFilter/:supervisorId/:districtStateId/:schStatus', authMiddleware,
  requirePermission(PERMISSIONS.NISWAN_VIEW, 'You do not have permission to view Niswans.'),
  requireSchoolReadScope,
  getBySchFilter)

router.post('/add', authMiddleware,
  auditMutation({ action: 'SCHOOL_CREATE', resourceType: 'School' }),
  notifyOnSuccess({
    type: 'school.created', title: 'Niswan created', message: 'A Niswan record was created successfully.',
    resourceType: 'School',
    webPath: (_req, payload) => payload?.resourceId ? `/dashboard/schools/${payload.resourceId}` : '/dashboard/schools',
    mobilePath: (_req, payload) => payload?.resourceId ? `/(app)/schools/${payload.resourceId}` : '/(app)/(tabs)/schools',
  }),
  requirePermission(PERMISSIONS.NISWAN_CREATE, 'You do not have permission to create Niswans.'),
  upload.single('file'), addSchool)

router.get('/:id', authMiddleware,
  requirePermission(PERMISSIONS.NISWAN_VIEW, 'You do not have permission to view Niswans.'),
  requireSchoolReadScope,
  requireSchoolReadAccess('id'), getSchool)

router.put('/:id', authMiddleware,
  auditMutation({ action: 'SCHOOL_UPDATE', resourceType: 'School' }),
  notifyOnSuccess({
    type: 'school.updated', title: 'Niswan updated', message: 'A Niswan record was updated successfully.',
    resourceType: 'School', resourceId: (req) => req.params.id,
    webPath: (req) => `/dashboard/schools/${req.params.id}`,
    mobilePath: (req) => `/(app)/schools/${req.params.id}`,
  }),
  requirePermission(PERMISSIONS.NISWAN_EDIT, 'You do not have permission to edit Niswans.'),
  updateSchool)

router.delete('/:id', authMiddleware,
  auditMutation({ action: 'SCHOOL_DELETE', resourceType: 'School' }),
  requirePermission(PERMISSIONS.NISWAN_DELETE, 'You do not have permission to delete Niswans.'),
  deleteSchool)

export default router
