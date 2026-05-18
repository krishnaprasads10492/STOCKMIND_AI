/**
 * Prediction routes — save, retrieve, resolve outcomes, accuracy, backtest.
 *
 * POST   /api/predictions                        — save a batch
 * GET    /api/predictions/:symbol                — recent predictions
 * GET    /api/predictions/:symbol/accuracy       — rolling accuracy
 * GET    /api/predictions/:symbol/backtest       — backtest results
 * GET    /api/predictions/:symbol/versions       — model version history
 * GET    /api/predictions/:symbol/deviations     — learning deviation history
 * GET    /api/predictions/:symbol/adaptive-weight — adaptive weight for instrType
 * PATCH  /api/predictions/:symbol/:id/outcome    — resolve outcome
 * POST   /api/predictions/cleanup                — run cleanup (admin)
 */

import { Router } from 'express'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { sanitizeTicker } from '../utils/sanitize.js'
import {
  savePredictionBatch, getRecentPredictions,
  resolveOutcome, computeAccuracy,
  saveBacktestResult, getBacktestResult, listBacktestResults,
  getModelVersionHistory, getDeviationHistory, computeAdaptiveWeight,
  cleanupOldPredictions,
} from '../services/predictionStore.js'

const router = Router()

// POST /api/predictions — save a batch
router.post('/', requireAuth, (req, res) => {
  const batch = req.body
  if (!batch?.symbol || !Array.isArray(batch.signals)) {
    return res.status(400).json({ error: 'Invalid prediction batch' })
  }
  const ticker = sanitizeTicker(batch.symbol)
  if (!ticker) return res.status(400).json({ error: 'Invalid symbol' })

  savePredictionBatch({ ...batch, symbol: ticker })
  res.status(201).json({ ok: true })
})

// GET /api/predictions/:symbol — recent predictions
router.get('/:symbol', requireAuth, (req, res) => {
  const symbol = sanitizeTicker(req.params.symbol)
  if (!symbol) return res.status(400).json({ error: 'Invalid symbol' })

  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  const preds = getRecentPredictions(symbol, limit)
  res.json(preds)
})

// GET /api/predictions/:symbol/accuracy — rolling accuracy
router.get('/:symbol/accuracy', requireAuth, (req, res) => {
  const symbol = sanitizeTicker(req.params.symbol)
  if (!symbol) return res.status(400).json({ error: 'Invalid symbol' })

  const days = Number(req.query.days ?? 30)
  const acc  = computeAccuracy(symbol, days)
  res.json(acc)
})

// GET /api/predictions/:symbol/backtest — get cached backtest results
router.get('/:symbol/backtest', requireAuth, (req, res) => {
  const symbol = sanitizeTicker(req.params.symbol)
  if (!symbol) return res.status(400).json({ error: 'Invalid symbol' })

  const version = req.query.version
  if (version) {
    const result = getBacktestResult(symbol, version)
    if (!result) return res.status(404).json({ error: 'No backtest result for this version' })
    return res.json(result)
  }

  const results = listBacktestResults(symbol)
  res.json({ symbol, results })
})

// POST /api/predictions/:symbol/backtest — save a backtest result (from AI backend)
router.post('/:symbol/backtest', requireAuth, (req, res) => {
  const symbol = sanitizeTicker(req.params.symbol)
  if (!symbol) return res.status(400).json({ error: 'Invalid symbol' })

  const { modelVersion, ...result } = req.body
  if (!modelVersion) return res.status(400).json({ error: 'modelVersion required' })

  saveBacktestResult(symbol, modelVersion, result)
  res.status(201).json({ ok: true })
})

// GET /api/predictions/:symbol/versions — model version history
router.get('/:symbol/versions', requireAuth, (req, res) => {
  const symbol = sanitizeTicker(req.params.symbol)
  if (!symbol) return res.status(400).json({ error: 'Invalid symbol' })

  res.json(getModelVersionHistory(symbol))
})

// GET /api/predictions/:symbol/deviations — learning deviation history
router.get('/:symbol/deviations', requireAuth, (req, res) => {
  const symbol = sanitizeTicker(req.params.symbol)
  if (!symbol) return res.status(400).json({ error: 'Invalid symbol' })

  const limit = Math.min(Number(req.query.limit ?? 100), 500)
  res.json(getDeviationHistory(symbol, limit))
})

// GET /api/predictions/:symbol/adaptive-weight?instrType=spot
router.get('/:symbol/adaptive-weight', requireAuth, (req, res) => {
  const symbol    = sanitizeTicker(req.params.symbol)
  const instrType = String(req.query.instrType ?? 'spot')
  if (!symbol) return res.status(400).json({ error: 'Invalid symbol' })

  const weight = computeAdaptiveWeight(symbol, instrType)
  res.json({ symbol, instrType, weight })
})

// PATCH /api/predictions/:symbol/:id/outcome — resolve outcome
router.patch('/:symbol/:id/outcome', requireAuth, (req, res) => {
  const symbol = sanitizeTicker(req.params.symbol)
  if (!symbol) return res.status(400).json({ error: 'Invalid symbol' })

  const { yearMonth, outcome } = req.body
  if (!yearMonth || !outcome) return res.status(400).json({ error: 'yearMonth and outcome required' })

  const result = resolveOutcome(req.params.id, symbol, yearMonth, outcome)
  if (!result.ok) return res.status(404).json({ error: result.error })
  res.json({ ok: true })
})

// POST /api/predictions/cleanup — run cleanup (admin only)
router.post('/cleanup', requireAdmin, (req, res) => {
  const retentionDays = Number(req.body.retentionDays ?? 30)
  const result = cleanupOldPredictions(retentionDays)
  res.json({ ok: true, ...result })
})

export default router
