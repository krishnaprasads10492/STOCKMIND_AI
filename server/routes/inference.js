/**
 * inference.js — Proxy to Python AI backend (FastAPI on :8001).
 *
 * If the Python backend is not running, falls back to the JS engine.
 * Enriches requests with:
 *   - OHLCV data from Yahoo Finance (real features instead of mock)
 *   - Adaptive weight from learning history
 *   - Prediction mode (learning / realworld / both)
 *   - Futures meta (basis, lot size, expiry)
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { sanitizeTicker } from '../utils/sanitize.js'
import { fetchOHLCV, fetchQuote } from '../services/yahooFinanceService.js'
import { computeAdaptiveWeight } from '../services/predictionStore.js'

const router = Router()
const AI_BACKEND = process.env.AI_BACKEND_URL ?? 'http://localhost:8001'
const TIMEOUT_MS = 12_000

// ── Proxy helper ──────────────────────────────────────────────────────────────

async function proxyToAI(path, body, res) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(`${AI_BACKEND}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    })
    clearTimeout(timer)

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'AI backend error' }))
      return res.status(response.status).json({ error: err.detail ?? 'AI backend error' })
    }

    const data = await response.json()
    res.json(data)
  } catch (err) {
    clearTimeout(timer)
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'AI backend timeout — using JS fallback', fallback: true })
    }
    res.status(503).json({
      error:    'AI backend unavailable',
      fallback: true,
      message:  'Start the Python backend: cd ai_backend && uvicorn main:app --port 8001',
    })
  }
}

// ── POST /api/inference/predict ───────────────────────────────────────────────

router.post('/predict', requireAuth, async (req, res) => {
  const body = req.body

  // Validate symbol
  const ticker = sanitizeTicker(body.symbol)
  if (!ticker) return res.status(400).json({ error: 'Invalid symbol' })

  // Enrich with real OHLCV data (AI backend uses this for real features)
  let ohlcv = null
  let basePrice = body.basePrice ?? null

  try {
    ohlcv = await fetchOHLCV(ticker, body.exchange ?? 'NSE', 750)  // 3 years
  } catch {
    // Non-fatal — AI backend will use mock OHLCV if not provided
  }

  // Fetch live price if basePrice not provided
  if (!basePrice) {
    try {
      const quote = await fetchQuote(ticker, body.exchange ?? 'NSE')
      basePrice = quote?.close ?? quote?.price ?? ohlcv?.[ohlcv.length - 1]?.close ?? 100
    } catch {
      // Use last OHLCV close as fallback
      basePrice = ohlcv?.[ohlcv.length - 1]?.close ?? 100
    }
  }

  // Compute adaptive weight from learning history
  const instrType     = body.instrType ?? 'spot'
  const adaptiveWeight = body.adaptiveWeight ?? computeAdaptiveWeight(ticker, instrType)

  // Build enriched request
  const enriched = {
    ...body,
    symbol:          ticker,
    basePrice:       basePrice,
    adaptiveWeight,
    ohlcv:           ohlcv ?? null,
    predictionMode:  body.predictionMode ?? 'both',
    futuresMeta:     body.futuresMeta ?? null,
    optionMeta:      body.optionMeta ?? null,
  }

  await proxyToAI('/predict', enriched, res)
})

// ── GET /api/inference/health ─────────────────────────────────────────────────

router.get('/health', requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${AI_BACKEND}/health`, { signal: AbortSignal.timeout(3000) })
    const data = await r.json()
    res.json({ ...data, pythonBackendAvailable: true })
  } catch {
    res.json({
      pythonBackendAvailable: false,
      level: 'heuristics_only',
      message: 'Python AI backend not running — using JS prediction engine',
    })
  }
})

// ── GET /api/inference/models/status ─────────────────────────────────────────

router.get('/models/status', requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${AI_BACKEND}/models/status`, { signal: AbortSignal.timeout(3000) })
    res.json(await r.json())
  } catch {
    res.json({ available: false, message: 'Python backend not running' })
  }
})

// ── POST /api/inference/backtest ──────────────────────────────────────────────
// Trigger a backtest run on the AI backend for a symbol

router.post('/backtest', requireAuth, async (req, res) => {
  const body   = req.body
  const ticker = sanitizeTicker(body.symbol)
  if (!ticker) return res.status(400).json({ error: 'Invalid symbol' })

  // Fetch 3 years of OHLCV for backtest
  let ohlcv = null
  try {
    ohlcv = await fetchOHLCV(ticker, body.exchange ?? 'NSE', 750)
  } catch { /* non-fatal */ }

  await proxyToAI('/backtest', { ...body, symbol: ticker, ohlcv }, res)
})

// ── POST /api/inference/calibrate ────────────────────────────────────────────
// Manually trigger recalibration for a symbol

router.post('/calibrate', requireAuth, async (req, res) => {
  const body   = req.body
  const ticker = sanitizeTicker(body.symbol)
  if (!ticker) return res.status(400).json({ error: 'Invalid symbol' })

  await proxyToAI('/calibrate', { ...body, symbol: ticker }, res)
})

export default router
