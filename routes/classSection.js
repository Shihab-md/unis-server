import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import {addClassSection, upload, getClassSections, getClassSection, updateClassSection, deleteClassSection} from '../controllers/classSectionController.js'

const router = express.Router()

router.get('/', authMiddleware, getClassSections)
router.post('/add', authMiddleware, upload.single('image'), addClassSection)
router.get('/:id', authMiddleware, getClassSection)
router.put('/:id', authMiddleware, updateClassSection)
router.delete('/:id', authMiddleware, deleteClassSection)
// router.get('/department/:id', authMiddleware, fetchClassSectionsByDepId)

export default router