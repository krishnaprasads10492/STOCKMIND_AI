import { Router } from 'express'
const router = Router()

router.get('/', (_req, res) => {
  res.json({
    level:              'full',
    ece:                0,
    brierScore:         0,
    dataFeedHealthy:    true,
    aiInferenceHealthy: true,
    storageHealthy:     true,
    activeFeeds:        3,
    totalFeeds:         3,
    lastUpdated:        new Date().toISOString(),
  })
})

export default router
