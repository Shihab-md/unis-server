import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import {
    addCertificate, upload, getCertificates, getCertificate, getByCertFilter,
    reprintCertificate, duplicatePrintCertificate
} from '../controllers/certificateController.js'

const router = express.Router()

router.get('/', authMiddleware, getCertificates)
router.post('/add', authMiddleware, upload.single('file'), addCertificate)
router.get('/:id', authMiddleware, getCertificate)

router.get('/byCertFilter/:certSchoolId/:certCourseId/:certACYearId', authMiddleware, getByCertFilter)

router.post("/reprint/:id", reprintCertificate);
router.post("/duplicate-print/:id", duplicatePrintCertificate);

export default router