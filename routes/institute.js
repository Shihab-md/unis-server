import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { addInstitute, getInstitutes, getInstitute, updateInstitute, deleteInstitute, getInstitutesFromCache } from '../controllers/instituteController.js'

const router = express.Router()

router.get('/', authMiddleware, getInstitutes)
router.post('/add', authMiddleware, addInstitute)

router.get('/fromCache/', authMiddleware, getInstitutesFromCache) 

router.get('/:id', authMiddleware, getInstitute)
router.put('/:id', authMiddleware, updateInstitute)
router.delete('/:id', authMiddleware, deleteInstitute)

export default router