import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import {addAcademicYear, getAcademicYears, getAcademicYear, updateAcademicYear, deleteAcademicYear, getAcademicYearsFromCache} from '../controllers/academicYearController.js'
import { requireMasterReadRole, requireMasterManageRole } from '../middleware/authorizationMiddleware.js'
import { requirePermission } from '../middleware/permissionMiddleware.js'
import { PERMISSIONS } from '../config/permissionCatalog.js'
import { auditMutation } from '../middleware/auditMiddleware.js'

const router = express.Router()

// V0.6: full master screens are HQ/Guest-read; mutations are HQ-only.
// Keep fromCache authenticated-but-broad because production Student/Employee forms use it.
router.get('/', authMiddleware, requirePermission(PERMISSIONS.MASTER_ACADEMIC_YEAR_VIEW, "You do not have permission to view Academic Years."), requireMasterReadRole, getAcademicYears)
router.post('/add', authMiddleware, requirePermission(PERMISSIONS.MASTER_ACADEMIC_YEAR_CREATE, "You do not have permission to create Academic Years."), requireMasterManageRole, auditMutation({ action: 'ACADEMIC_YEAR_CREATE', resourceType: 'AcademicYear' }), addAcademicYear)

router.get('/fromCache/', authMiddleware, getAcademicYearsFromCache)

router.get('/:id', authMiddleware, requirePermission(PERMISSIONS.MASTER_ACADEMIC_YEAR_VIEW, "You do not have permission to view Academic Years."), requireMasterReadRole, getAcademicYear)
router.put('/:id', authMiddleware, requirePermission(PERMISSIONS.MASTER_ACADEMIC_YEAR_EDIT, "You do not have permission to edit Academic Years."), requireMasterManageRole, auditMutation({ action: 'ACADEMIC_YEAR_UPDATE', resourceType: 'AcademicYear' }), updateAcademicYear)
router.delete('/:id', authMiddleware, requirePermission(PERMISSIONS.MASTER_ACADEMIC_YEAR_DELETE, "You do not have permission to delete Academic Years."), requireMasterManageRole, auditMutation({ action: 'ACADEMIC_YEAR_DELETE', resourceType: 'AcademicYear' }), deleteAcademicYear)

export default router
