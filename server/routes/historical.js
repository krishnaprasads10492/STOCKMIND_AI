/**
 * historical.js — Historical market data routes.
 *
 * GET /api/historical/ohlcv?symbol=&exchange=&interval=&from=&to=
 * GET /api/historical/macro?indicator=
 * GET /api/historical/fundamentals?symbol=
 * GET /api/historical/earnings?symbol=
 * GET /api/historical/dividends?symbol=
 *
 * All routes require authentication.
 * Data is sourced from free public APIs (Yahoo Finance, Stooq, FRED, Alpha Vantage).
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { sanitizeTicker } from '../utils/sanitize.js'
import {
  fetchHistoricalOHLCV,
  fetchMacroData,
  fetchFundamentals,
  fetchEarningsCalendar,
  fetchDividendHistory,
} from '../services/historicalDataService.js'

const router = Router()

// ── Validation helpers ────────────────────────────────────────────────────────

const VALID_INTERVALS = new Set(['1d', '1wk', '1mo', '1h', '30m', '15m', '5m', 'daily', 'weekly', 'monthly'])
const DATE_REGEX      = /^\d{4}-\d{2}-\d{2}$/

function validateDateParam(val) {
  if (!val) return null
  if (!DATE_REGEX.test(val)) return null
  const d = new Date(val)
  if (isNaN(d.getTime())) return null
  return val
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/historical/ohlcv
 * Query params: symbol, exchange (optional), interval (optional), from (optional), to (optional)
 */
router.get('/ohlcv', requireAuth, async (req, res) => {
  const symbol   = sanitizeTicker(req.query.symbol ?? '')
  const exchange = String(req.query.exchange ?? 'NSE').toUpperCase().replace(/[^A-Z]/g, '')
  const interval = VALID_INTERVALS.has(req.query.interval) ? req.query.interval : '1d'
  const from     = validateDateParam(req.query.from)
  const to       = validateDateParam(req.query.to)

  if (!symbol) {
    return res.status(400).json({ error: 'symbol required' })
  }

  try {
    const data = await fetchHistoricalOHLCV(symbol, exchange, interval, from, to)
    res.json(data)
  } catch (err) {
    res.status(502).json({ error: err.message ?? 'Failed to fetch historical data' })
  }
})

/**
 * GET /api/historical/macro
 * Query params: indicator (FRED series ID, e.g. GDP, CPIAUCSL, FEDFUNDS)
 */
router.get('/macro', requireAuth, async (req, res) => {
  const indicator = String(req.query.indicator ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase()

  if (!indicator) {
    return res.status(400).json({ error: 'indicator required (e.g. GDP, CPIAUCSL, FEDFUNDS)' })
  }

  try {
    const data = await fetchMacroData(indicator)
    res.json(data)
  } catch (err) {
    res.status(502).json({ error: err.message ?? 'Failed to fetch macro data' })
  }
})

/**
 * GET /api/historical/fundamentals
 * Query params: symbol
 */
router.get('/fundamentals', requireAuth, async (req, res) => {
  const symbol = sanitizeTicker(req.query.symbol ?? '')

  if (!symbol) {
    return res.status(400).json({ error: 'symbol required' })
  }

  try {
    const data = await fetchFundamentals(symbol)
    res.json(data)
  } catch (err) {
    res.status(502).json({ error: err.message ?? 'Failed to fetch fundamentals' })
  }
})

/**
 * GET /api/historical/earnings
 * Query params: symbol
 */
router.get('/earnings', requireAuth, async (req, res) => {
  const symbol = sanitizeTicker(req.query.symbol ?? '')

  if (!symbol) {
    return res.status(400).json({ error: 'symbol required' })
  }

  try {
    const data = await fetchEarningsCalendar(symbol)
    res.json(data)
  } catch (err) {
    res.status(502).json({ error: err.message ?? 'Failed to fetch earnings calendar' })
  }
})

/**
 * GET /api/historical/dividends
 * Query params: symbol
 */
router.get('/dividends', requireAuth, async (req, res) => {
  const symbol = sanitizeTicker(req.query.symbol ?? '')

  if (!symbol) {
    return res.status(400).json({ error: 'symbol required' })
  }

  try {
    const data = await fetchDividendHistory(symbol)
    res.json(data)
  } catch (err) {
    res.status(502).json({ error: err.message ?? 'Failed to fetch dividend history' })
  }
})

export default router
