import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { addTemplate, upload, getTemplates, getTemplate, updateTemplate, deleteTemplate } from '../controllers/templateController.js'

const router = express.Router()

router.get('/', authMiddleware, getTemplates)
router.post('/add', authMiddleware, upload.single('file'), addTemplate)
router.get('/:id', authMiddleware, getTemplate)
router.put('/:id', authMiddleware, upload.single('file'), updateTemplate)
router.delete('/:id', authMiddleware, deleteTemplate)

export default router