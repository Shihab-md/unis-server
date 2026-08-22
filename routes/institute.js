import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { addInstitute, getInstitutes, getInstitute, updateInstitute, deleteInstitute, getInstitutesFromCache } from '../controllers/instituteController.js'
import { requireMasterReadRole, requireMasterManageRole } from '../middleware/authorizationMiddleware.js'
import { auditMutation } from '../middleware/auditMiddleware.js'

const router = express.Router()

router.get('/', authMiddleware, requireMasterReadRole, getInstitutes)
router.post('/add', authMiddleware, requireMasterManageRole, auditMutation({ action: 'INSTITUTE_CREATE', resourceType: 'Institute' }), addInstitute)

// Used as reference data by non-master workflows; keep authenticated lookup compatible.
router.get('/fromCache/', authMiddleware, getInstitutesFromCache)

router.get('/:id', authMiddleware, requireMasterReadRole, getInstitute)
router.put('/:id', authMiddleware, requireMasterManageRole, auditMutation({ action: 'INSTITUTE_UPDATE', resourceType: 'Institute' }), updateInstitute)
router.delete('/:id', authMiddleware, requireMasterManageRole, auditMutation({ action: 'INSTITUTE_DELETE', resourceType: 'Institute' }), deleteInstitute)

export default router
