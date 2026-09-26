import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { addInstitute, getInstitutes, getInstitute, updateInstitute, deleteInstitute, getInstitutesFromCache } from '../controllers/instituteController.js'
import { requireMasterReadRole, requireMasterManageRole } from '../middleware/authorizationMiddleware.js'
import { requirePermission } from '../middleware/permissionMiddleware.js'
import { PERMISSIONS } from '../config/permissionCatalog.js'
import { auditMutation } from '../middleware/auditMiddleware.js'

const router = express.Router()

router.get('/', authMiddleware, requirePermission(PERMISSIONS.MASTER_INSTITUTE_VIEW, "You do not have permission to view Institutes."), requireMasterReadRole, getInstitutes)
router.post('/add', authMiddleware, requirePermission(PERMISSIONS.MASTER_INSTITUTE_CREATE, "You do not have permission to create Institutes."), requireMasterManageRole, auditMutation({ action: 'INSTITUTE_CREATE', resourceType: 'Institute' }), addInstitute)

// Used as reference data by non-master workflows; keep authenticated lookup compatible.
router.get('/fromCache/', authMiddleware, getInstitutesFromCache)

router.get('/:id', authMiddleware, requirePermission(PERMISSIONS.MASTER_INSTITUTE_VIEW, "You do not have permission to view Institutes."), requireMasterReadRole, getInstitute)
router.put('/:id', authMiddleware, requirePermission(PERMISSIONS.MASTER_INSTITUTE_EDIT, "You do not have permission to edit Institutes."), requireMasterManageRole, auditMutation({ action: 'INSTITUTE_UPDATE', resourceType: 'Institute' }), updateInstitute)
router.delete('/:id', authMiddleware, requirePermission(PERMISSIONS.MASTER_INSTITUTE_DELETE, "You do not have permission to delete Institutes."), requireMasterManageRole, auditMutation({ action: 'INSTITUTE_DELETE', resourceType: 'Institute' }), deleteInstitute)

export default router
