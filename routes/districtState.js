import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import {addDistrictState, getDistrictStates, getDistrictState, 
    updateDistrictState, deleteDistrictState, getDistrictStatesFromCache} from '../controllers/districtStateController.js'

const router = express.Router()

router.get('/', authMiddleware, getDistrictStates)
router.post('/add', authMiddleware, addDistrictState)

router.get('/fromCache/', authMiddleware, getDistrictStatesFromCache)

router.get('/:id', authMiddleware, getDistrictState)
router.put('/:id', authMiddleware, updateDistrictState)
router.delete('/:id', authMiddleware, deleteDistrictState)

export default router