import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { addSupervisor, upload, getSupervisors, getSupervisor, updateSupervisor,
    deleteSupervisor, getSupervisorsFromCache, getBySupFilter } from '../controllers/supervisorController.js'
import { requireSupervisorListRole, requireSupervisorDetailRole, requireSupervisorManageRole } from '../middleware/authorizationMiddleware.js'
import { auditMutation } from '../middleware/auditMiddleware.js'
import { notifyOnSuccess } from '../middleware/notificationMiddleware.js'

const router = express.Router()

// Preserve the existing Web list visibility (HQ / Guest / Muavin) while limiting detail
// and all mutations to the roles that the Web UI actually authorizes.
router.get('/', authMiddleware, requireSupervisorListRole, getSupervisors)
router.get('/fromCache/', authMiddleware, getSupervisorsFromCache)
router.get('/bySupFilter/:supSchoolId/:supStatus/:supType', authMiddleware, requireSupervisorListRole, getBySupFilter)

router.post('/add', authMiddleware,
  auditMutation({ action: 'SUPERVISOR_CREATE', resourceType: 'Supervisor' }),
  notifyOnSuccess({
    type: 'supervisor.created', title: 'Muavin created', message: 'A Muavin record was created successfully.',
    resourceType: 'Supervisor',
    webPath: (_req, payload) => payload?.resourceId ? `/dashboard/supervisors/${payload.resourceId}` : '/dashboard/supervisors',
    mobilePath: (_req, payload) => payload?.resourceId ? `/(app)/supervisors/${payload.resourceId}` : '/(app)/supervisors',
  }),
  requireSupervisorManageRole, upload.single('file'), addSupervisor)

router.get('/:id', authMiddleware, requireSupervisorDetailRole, getSupervisor)
router.put('/:id', authMiddleware,
  auditMutation({ action: 'SUPERVISOR_UPDATE', resourceType: 'Supervisor' }),
  notifyOnSuccess({
    type: 'supervisor.updated', title: 'Muavin updated', message: 'A Muavin record was updated successfully.',
    resourceType: 'Supervisor', resourceId: (req) => req.params.id,
    webPath: (req) => `/dashboard/supervisors/${req.params.id}`,
    mobilePath: (req) => `/(app)/supervisors/${req.params.id}`,
  }),
  requireSupervisorManageRole, upload.single('file'), updateSupervisor)
router.delete('/:id', authMiddleware, auditMutation({ action: 'SUPERVISOR_DELETE', resourceType: 'Supervisor' }), requireSupervisorManageRole, deleteSupervisor)

export default router
