import express from 'express'

const router = express.Router()

// Public, non-sensitive mobile release metadata. This endpoint intentionally does not require auth
// so an outdated client can learn that an update is required before login.
router.get('/version', (req, res) => {
  const latestVersion = process.env.UNIS_MOBILE_LATEST_VERSION || '0.12.0'
  const minimumVersion = process.env.UNIS_MOBILE_MIN_VERSION || '0.8.0'
  const forceUpdate = String(process.env.UNIS_MOBILE_FORCE_UPDATE || 'false').toLowerCase() === 'true'
  const updateUrl = process.env.UNIS_MOBILE_ANDROID_UPDATE_URL || ''
  const message = process.env.UNIS_MOBILE_UPDATE_MESSAGE || ''

  res.status(200).json({
    success: true,
    latestVersion,
    minimumVersion,
    forceUpdate,
    updateUrl,
    message,
  })
})

export default router
