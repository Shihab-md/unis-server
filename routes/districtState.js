import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import {addDistrictState, getDistrictStates, getDistrictState, updateDistrictState, deleteDistrictState, getDistrictStatesFromCache} from '../controllers/districtStateController.js'
import { requireMasterReadRole, requireMasterManageRole } from '../middleware/authorizationMiddleware.js'
import { requirePermission } from '../middleware/permissionMiddleware.js'
import { PERMISSIONS } from '../config/permissionCatalog.js'
import { auditMutation } from '../middleware/auditMiddleware.js'

const router = express.Router()

router.get('/', authMiddleware, requirePermission(PERMISSIONS.MASTER_DISTRICT_STATE_VIEW, "You do not have permission to view District / State."), requireMasterReadRole, getDistrictStates)
router.post('/add', authMiddleware, requirePermission(PERMISSIONS.MASTER_DISTRICT_STATE_CREATE, "You do not have permission to create District / State."), requireMasterManageRole, auditMutation({ action: 'DISTRICT_STATE_CREATE', resourceType: 'DistrictState' }), addDistrictState)

// Student/Employee forms use this lookup for every authorized role.
router.get('/fromCache/', authMiddleware, getDistrictStatesFromCache)

router.get('/:id', authMiddleware, requirePermission(PERMISSIONS.MASTER_DISTRICT_STATE_VIEW, "You do not have permission to view District / State."), requireMasterReadRole, getDistrictState)
router.put('/:id', authMiddleware, requirePermission(PERMISSIONS.MASTER_DISTRICT_STATE_EDIT, "You do not have permission to edit District / State."), requireMasterManageRole, auditMutation({ action: 'DISTRICT_STATE_UPDATE', resourceType: 'DistrictState' }), updateDistrictState)
router.delete('/:id', authMiddleware, requirePermission(PERMISSIONS.MASTER_DISTRICT_STATE_DELETE, "You do not have permission to delete District / State."), requireMasterManageRole, auditMutation({ action: 'DISTRICT_STATE_DELETE', resourceType: 'DistrictState' }), deleteDistrictState)

export default router
