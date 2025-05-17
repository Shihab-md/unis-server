import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import { addCertificate, upload, getCertificates, getCertificate } from '../controllers/certificateController.js'

const router = express.Router()

router.get('/', authMiddleware, getCertificates)
router.post('/add', authMiddleware, upload.single('file'), addCertificate)
router.get('/:id', authMiddleware, getCertificate)

export default router