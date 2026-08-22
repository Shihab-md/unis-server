import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import {addAcademicYear, getAcademicYears, getAcademicYear, updateAcademicYear, deleteAcademicYear, getAcademicYearsFromCache} from '../controllers/academicYearController.js'
import { requireMasterReadRole, requireMasterManageRole } from '../middleware/authorizationMiddleware.js'
import { auditMutation } from '../middleware/auditMiddleware.js'

const router = express.Router()

// V0.6: full master screens are HQ/Guest-read; mutations are HQ-only.
// Keep fromCache authenticated-but-broad because production Student/Employee forms use it.
router.get('/', authMiddleware, requireMasterReadRole, getAcademicYears)
router.post('/add', authMiddleware, requireMasterManageRole, auditMutation({ action: 'ACADEMIC_YEAR_CREATE', resourceType: 'AcademicYear' }), addAcademicYear)

router.get('/fromCache/', authMiddleware, getAcademicYearsFromCache)

router.get('/:id', authMiddleware, requireMasterReadRole, getAcademicYear)
router.put('/:id', authMiddleware, requireMasterManageRole, auditMutation({ action: 'ACADEMIC_YEAR_UPDATE', resourceType: 'AcademicYear' }), updateAcademicYear)
router.delete('/:id', authMiddleware, requireMasterManageRole, auditMutation({ action: 'ACADEMIC_YEAR_DELETE', resourceType: 'AcademicYear' }), deleteAcademicYear)

export default router
