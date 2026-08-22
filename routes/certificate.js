import express from 'express'
import authMiddleware from '../middleware/authMiddlware.js'
import {
    addCertificate, upload, getCertificates, getCertificate, getByCertFilter,
    reprintCertificate, duplicatePrintCertificate
} from '../controllers/certificateController.js'
import {
    requireCertificateReadRole,
    requireCertificateManageRole,
    requireCertificateReadAccess,
    requireCertificateManageAccess,
    requireCertificateCreateAccess,
} from '../middleware/authorizationMiddleware.js'
import { auditMutation } from '../middleware/auditMiddleware.js'
import { notifyOnSuccess } from '../middleware/notificationMiddleware.js'

const router = express.Router()

// V0.5 Certificate security model:
// - Super Admin / HQ User: list, view, create, reprint, duplicate-print.
// - Guest: list and view only, matching the explicit production Web permission map.
// - Reprint and duplicate-print now require JWT authentication (legacy routes were unauthenticated).
router.get('/', authMiddleware, requireCertificateReadRole, getCertificates)
router.post(
    '/add',
    authMiddleware,
    requireCertificateManageRole,
    auditMutation({ action: 'CERTIFICATE_CREATE', resourceType: 'Certificate' }),
    notifyOnSuccess({
      type: 'certificate.created', title: 'Certificate generated',
      message: 'Certificate generation completed successfully.',
      resourceType: 'Certificate',
      webPath: (_req, payload) => payload?.resourceId ? `/dashboard/certificates/${payload.resourceId}` : '/dashboard/certificates',
      mobilePath: (_req, payload) => payload?.resourceId ? `/(app)/certificates/${payload.resourceId}` : '/(app)/(tabs)/certificates',
    }),
    upload.single('file'),
    requireCertificateCreateAccess,
    addCertificate
)

router.get('/byCertFilter/:certSchoolId/:certCourseId/:certACYearId', authMiddleware, requireCertificateReadRole, getByCertFilter)

router.post(
    '/reprint/:id',
    authMiddleware,
    requireCertificateManageRole,
    auditMutation({ action: 'CERTIFICATE_REPRINT', resourceType: 'Certificate' }),
    notifyOnSuccess({
      type: 'certificate.reprinted', title: 'Certificate reprinted',
      message: 'Certificate reprint completed successfully.',
      resourceType: 'Certificate', resourceId: (req) => req.params.id,
      webPath: (req) => `/dashboard/certificates/${req.params.id}`,
      mobilePath: (req) => `/(app)/certificates/${req.params.id}`,
    }),
    requireCertificateManageAccess('id'),
    reprintCertificate
)
router.post(
    '/duplicate-print/:id',
    authMiddleware,
    requireCertificateManageRole,
    auditMutation({ action: 'CERTIFICATE_DUPLICATE_PRINT', resourceType: 'Certificate' }),
    notifyOnSuccess({
      type: 'certificate.duplicate', title: 'Duplicate certificate ready', message: 'Duplicate certificate PDF was generated successfully.',
      resourceType: 'Certificate', resourceId: (req) => req.params.id,
      webPath: (req) => `/dashboard/certificates/${req.params.id}`,
      mobilePath: (req) => `/(app)/certificates/${req.params.id}`,
    }),
    requireCertificateManageAccess('id'),
    duplicatePrintCertificate
)

router.get('/:id', authMiddleware, requireCertificateReadRole, requireCertificateReadAccess('id'), getCertificate)

export default router
