import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { addSupervisor, upload, getSupervisors, getSupervisor, updateSupervisor,
    deleteSupervisor, getSupervisorsFromCache, getBySupFilter } from '../controllers/supervisorController.js'
import { requirePermission } from '../middleware/permissionMiddleware.js'
import { PERMISSIONS } from '../config/permissionCatalog.js'
import { auditMutation } from '../middleware/auditMiddleware.js'
import { notifyOnSuccess } from '../middleware/notificationMiddleware.js'

const router = express.Router()

// Phase 2.1: permission membership is database-managed. Controller data behavior
// remains unchanged, including the existing Muavin directory/detail distinction.
router.get('/', authMiddleware,
  requirePermission(PERMISSIONS.SUPERVISOR_LIST, 'You do not have permission to view the Muavin directory.'),
  getSupervisors)
router.get('/fromCache/', authMiddleware, getSupervisorsFromCache)
router.get('/bySupFilter/:supSchoolId/:supStatus/:supType', authMiddleware,
  requirePermission(PERMISSIONS.SUPERVISOR_LIST, 'You do not have permission to view the Muavin directory.'),
  getBySupFilter)

router.post('/add', authMiddleware,
  auditMutation({ action: 'SUPERVISOR_CREATE', resourceType: 'Supervisor' }),
  notifyOnSuccess({
    type: 'supervisor.created', title: 'Muavin created', message: 'A Muavin record was created successfully.',
    resourceType: 'Supervisor',
    webPath: (_req, payload) => payload?.resourceId ? `/dashboard/supervisors/${payload.resourceId}` : '/dashboard/supervisors',
    mobilePath: (_req, payload) => payload?.resourceId ? `/(app)/supervisors/${payload.resourceId}` : '/(app)/supervisors',
  }),
  requirePermission(PERMISSIONS.SUPERVISOR_CREATE, 'You do not have permission to create Muavins.'),
  upload.single('file'), addSupervisor)

router.get('/:id', authMiddleware,
  requirePermission(PERMISSIONS.SUPERVISOR_VIEW, 'You do not have permission to view Muavin details.'),
  getSupervisor)

router.put('/:id', authMiddleware,
  auditMutation({ action: 'SUPERVISOR_UPDATE', resourceType: 'Supervisor' }),
  notifyOnSuccess({
    type: 'supervisor.updated', title: 'Muavin updated', message: 'A Muavin record was updated successfully.',
    resourceType: 'Supervisor', resourceId: (req) => req.params.id,
    webPath: (req) => `/dashboard/supervisors/${req.params.id}`,
    mobilePath: (req) => `/(app)/supervisors/${req.params.id}`,
  }),
  requirePermission(PERMISSIONS.SUPERVISOR_EDIT, 'You do not have permission to edit Muavins.'),
  upload.single('file'), updateSupervisor)

router.delete('/:id', authMiddleware,
  auditMutation({ action: 'SUPERVISOR_DELETE', resourceType: 'Supervisor' }),
  requirePermission(PERMISSIONS.SUPERVISOR_DELETE, 'You do not have permission to delete Muavins.'),
  deleteSupervisor)

export default router
