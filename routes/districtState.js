import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import {addDistrictState, getDistrictStates, getDistrictState, updateDistrictState, deleteDistrictState, getDistrictStatesFromCache} from '../controllers/districtStateController.js'
import { requireMasterReadRole, requireMasterManageRole } from '../middleware/authorizationMiddleware.js'
import { auditMutation } from '../middleware/auditMiddleware.js'

const router = express.Router()

router.get('/', authMiddleware, requireMasterReadRole, getDistrictStates)
router.post('/add', authMiddleware, requireMasterManageRole, auditMutation({ action: 'DISTRICT_STATE_CREATE', resourceType: 'DistrictState' }), addDistrictState)

// Student/Employee forms use this lookup for every authorized role.
router.get('/fromCache/', authMiddleware, getDistrictStatesFromCache)

router.get('/:id', authMiddleware, requireMasterReadRole, getDistrictState)
router.put('/:id', authMiddleware, requireMasterManageRole, auditMutation({ action: 'DISTRICT_STATE_UPDATE', resourceType: 'DistrictState' }), updateDistrictState)
router.delete('/:id', authMiddleware, requireMasterManageRole, auditMutation({ action: 'DISTRICT_STATE_DELETE', resourceType: 'DistrictState' }), deleteDistrictState)

export default router
