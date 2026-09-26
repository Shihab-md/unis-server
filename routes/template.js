import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { addTemplate, upload, getTemplates, getTemplate, updateTemplate, deleteTemplate, getTemplatesFromCache } from '../controllers/templateController.js'
import { requireMasterReadRole, requireMasterManageRole } from '../middleware/authorizationMiddleware.js'
import { requirePermission } from '../middleware/permissionMiddleware.js'
import { PERMISSIONS } from '../config/permissionCatalog.js'
import { auditMutation } from '../middleware/auditMiddleware.js'

const router = express.Router()

router.get('/', authMiddleware, requirePermission(PERMISSIONS.MASTER_TEMPLATE_VIEW, "You do not have permission to view Templates."), requireMasterReadRole, getTemplates)
router.post('/add', authMiddleware, requirePermission(PERMISSIONS.MASTER_TEMPLATE_CREATE, "You do not have permission to create Templates."), requireMasterManageRole, auditMutation({ action: 'TEMPLATE_CREATE', resourceType: 'Template' }), upload.single('file'), addTemplate)

// Certificate creation uses this authenticated lookup outside the Masters module.
router.get('/fromCache/', authMiddleware, getTemplatesFromCache)

router.get('/:id', authMiddleware, requirePermission(PERMISSIONS.MASTER_TEMPLATE_VIEW, "You do not have permission to view Templates."), requireMasterReadRole, getTemplate)
router.put('/:id', authMiddleware, requirePermission(PERMISSIONS.MASTER_TEMPLATE_EDIT, "You do not have permission to edit Templates."), requireMasterManageRole, auditMutation({ action: 'TEMPLATE_UPDATE', resourceType: 'Template' }), upload.single('file'), updateTemplate)
router.delete('/:id', authMiddleware, requirePermission(PERMISSIONS.MASTER_TEMPLATE_DELETE, "You do not have permission to delete Templates."), requireMasterManageRole, auditMutation({ action: 'TEMPLATE_DELETE', resourceType: 'Template' }), deleteTemplate)

export default router
