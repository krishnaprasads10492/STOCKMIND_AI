/**
 * strategies.js — Strategy CRUD + NLP parser routes.
 *
 * POST   /api/strategies/parse          — parse plain-English strategy
 * GET    /api/strategies                — list user's strategies
 * POST   /api/strategies                — save a strategy
 * DELETE /api/strategies/:id            — delete a strategy
 * GET    /api/strategies/:id/backtest   — run backtest for a strategy
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { stripHtml } from '../utils/sanitize.js'
import {
  parseStrategyText, saveStrategy, getStrategies,
  getStrategy, deleteStrategy,
} from '../services/strategyService.js'
import { fetchOHLCV } from '../services/yahooFinanceService.js'

const router = Router()

// POST /api/strategies/parse — NLP strategy parser
router.post('/parse', requireAuth, (req, res) => {
  const text = stripHtml(String(req.body.text ?? '')).trim()
  if (!text || text.length < 5) {
    return res.status(400).json({ error: 'Strategy description too short' })
  }
  if (text.length > 500) {
    return res.status(400).json({ error: 'Strategy description too long (max 500 chars)' })
  }

  try {
    const result = parseStrategyText(text)
    res.json(result)
  } catch (err) {
    console.error('[Strategies] Parse error:', err.message)
    res.status(500).json({ error: 'Failed to parse strategy' })
  }
})

// GET /api/strategies — list user's strategies
router.get('/', requireAuth, (req, res) => {
  const strategies = getStrategies(req.user.userId)
  res.json(strategies)
})

// POST /api/strategies — save a strategy
router.post('/', requireAuth, (req, res) => {
  const strategy = req.body
  if (!strategy?.name) return res.status(400).json({ error: 'Strategy name required' })

  const result = saveStrategy(req.user.userId, strategy)
  res.status(201).json(result)
})

// DELETE /api/strategies/:id — delete a strategy
router.delete('/:id', requireAuth, (req, res) => {
  const result = deleteStrategy(req.user.userId, req.params.id)
  if (!result.ok) return res.status(404).json({ error: result.error })
  res.json({ ok: true })
})

// GET /api/strategies/:id/backtest — run backtest for a saved strategy
router.get('/:id/backtest', requireAuth, async (req, res) => {
  const strategy = getStrategy(req.user.userId, req.params.id)
  if (!strategy) return res.status(404).json({ error: 'Strategy not found' })

  // Fetch OHLCV and proxy to AI backend
  const symbol = strategy.symbol ?? 'NIFTY50'
  let ohlcv = null
  try {
    ohlcv = await fetchOHLCV(symbol, 'NSE', 750)
  } catch { /* non-fatal */ }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)

    const aiUrl = process.env.AI_BACKEND_URL ?? 'http://localhost:8001'
    const response = await fetch(`${aiUrl}/backtest`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        symbol,
        exchange:     'NSE',
        modelVersion: 'v0.2.0',
        ohlcv,
        strategyFilters: strategy.filters ?? [],
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!response.ok) {
      return res.status(response.status).json({ error: 'AI backend error' })
    }

    const result = await response.json()
    // Save backtest result to strategy
    saveStrategy(req.user.userId, { ...strategy, backtestResult: result })
    res.json(result)
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Backtest timeout' })
    }
    res.status(503).json({ error: 'AI backend unavailable', fallback: true })
  }
})

export default router
