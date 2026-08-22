import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { addTemplate, upload, getTemplates, getTemplate, updateTemplate, deleteTemplate, getTemplatesFromCache } from '../controllers/templateController.js'
import { requireMasterReadRole, requireMasterManageRole } from '../middleware/authorizationMiddleware.js'
import { auditMutation } from '../middleware/auditMiddleware.js'

const router = express.Router()

router.get('/', authMiddleware, requireMasterReadRole, getTemplates)
router.post('/add', authMiddleware, requireMasterManageRole, auditMutation({ action: 'TEMPLATE_CREATE', resourceType: 'Template' }), upload.single('file'), addTemplate)

// Certificate creation uses this authenticated lookup outside the Masters module.
router.get('/fromCache/', authMiddleware, getTemplatesFromCache)

router.get('/:id', authMiddleware, requireMasterReadRole, getTemplate)
router.put('/:id', authMiddleware, requireMasterManageRole, auditMutation({ action: 'TEMPLATE_UPDATE', resourceType: 'Template' }), upload.single('file'), updateTemplate)
router.delete('/:id', authMiddleware, requireMasterManageRole, auditMutation({ action: 'TEMPLATE_DELETE', resourceType: 'Template' }), deleteTemplate)

export default router
