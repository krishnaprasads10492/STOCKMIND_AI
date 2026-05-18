/**
 * market.js — Market data routes backed by yahoo-finance2.
 *
 * GET  /api/market/quote/:symbol          — single quote
 * GET  /api/market/batch?symbols=A,B,C    — batch quotes
 * GET  /api/market/ohlcv/:symbol          — OHLCV history (for AI features)
 * GET  /api/market/search?q=query         — symbol search
 * GET  /api/market/status                 — feed health
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { sanitizeTicker } from '../utils/sanitize.js'
import {
  fetchQuote, batchFetchQuotes, searchSymbol, fetchOHLCV,
} from '../services/yahooFinanceService.js'

const router = Router()

// GET /api/market/quote/:symbol?exchange=NSE
router.get('/quote/:symbol', requireAuth, async (req, res) => {
  const symbol   = sanitizeTicker(req.params.symbol)
  const exchange = String(req.query.exchange ?? 'NSE').toUpperCase()

  if (!symbol) return res.status(400).json({ error: 'Invalid symbol' })

  const tick = await fetchQuote(symbol, exchange)
  if (!tick) return res.status(404).json({ error: `No data for ${symbol}`, source: 'yahoo' })

  res.json(tick)
})

// GET /api/market/batch?symbols=NIFTY50,BANKNIFTY,RELIANCE&exchange=NSE
router.get('/batch', requireAuth, async (req, res) => {
  const raw      = String(req.query.symbols ?? '')
  const exchange = String(req.query.exchange ?? 'NSE').toUpperCase()

  const symbols = raw.split(',')
    .map(s => sanitizeTicker(s.trim()))
    .filter(Boolean)
    .slice(0, 30)

  if (!symbols.length) return res.status(400).json({ error: 'No valid symbols' })

  const items  = symbols.map(s => ({ symbol: s, exchange }))
  const result = await batchFetchQuotes(items)

  const data = {}
  for (const [sym, tick] of result) data[sym] = tick

  res.json({
    count:  Object.keys(data).length,
    data,
    source: 'yahoo',
    ts:     Date.now(),
  })
})

// GET /api/market/ohlcv/:symbol?exchange=NSE&bars=250
// Returns daily OHLCV bars — used by AI backend for feature engineering
router.get('/ohlcv/:symbol', requireAuth, async (req, res) => {
  const symbol   = sanitizeTicker(req.params.symbol)
  const exchange = String(req.query.exchange ?? 'NSE').toUpperCase()
  const bars     = Math.min(Number(req.query.bars ?? 250), 1000)

  if (!symbol) return res.status(400).json({ error: 'Invalid symbol' })

  const ohlcv = await fetchOHLCV(symbol, exchange, bars)
  if (!ohlcv || !ohlcv.length) {
    return res.status(404).json({ error: `No OHLCV data for ${symbol}` })
  }

  res.json({
    symbol,
    exchange,
    bars:   ohlcv.length,
    data:   ohlcv,
    source: 'yahoo',
    ts:     Date.now(),
  })
})

// GET /api/market/search?q=reliance
router.get('/search', requireAuth, async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  if (!q || q.length < 2) return res.status(400).json({ error: 'Query too short' })

  const results = await searchSymbol(q)
  res.json({ results, source: 'yahoo' })
})

// GET /api/market/status
router.get('/status', requireAuth, async (req, res) => {
  const tick = await fetchQuote('NIFTY50', 'NSE')
  res.json({
    available: !!tick,
    source:    'yahoo-finance2',
    note:      tick ? 'Yahoo Finance reachable' : 'Yahoo Finance unavailable',
    ts:        Date.now(),
  })
})

export default router
