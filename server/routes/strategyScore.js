/**
 * strategyScore.js — Strategy Intelligence scoring routes.
 *
 * POST /api/strategy-score/single   — score one symbol with all 10 algorithms
 * POST /api/strategy-score/batch    — score multiple symbols, return ranked list
 * GET  /api/strategy-score/history  — user's scoring history
 * GET  /api/strategy-score/export   — export scores as Excel/CSV
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { stripHtml } from '../utils/sanitize.js'
import { fetchOHLCV } from '../services/yahooFinanceService.js'
import { writeSecure, readSecure, listSecure } from '../storage/fileStore.js'
import crypto from 'crypto'

const router = Router()
const AI_URL = process.env.AI_BACKEND_URL ?? 'http://localhost:8001'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function proxyToAI(path, body, timeoutMs = 30_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${AI_URL}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`AI backend: ${res.status}`)
    return await res.json()
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

function sanitizeSymbol(s) {
  return stripHtml(String(s ?? '')).trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 20)
}

// ── POST /api/strategy-score/single ──────────────────────────────────────────

router.post('/single', requireAuth, async (req, res) => {
  const symbol   = sanitizeSymbol(req.body.symbol)
  const exchange = stripHtml(String(req.body.exchange ?? 'NSE')).trim()
  const regime   = stripHtml(String(req.body.regime   ?? 'trending')).trim()

  if (!symbol) return res.status(400).json({ error: 'Symbol required' })

  // Fetch OHLCV from Yahoo Finance
  let ohlcv = null
  try {
    ohlcv = await fetchOHLCV(symbol, exchange, 250)
  } catch { /* non-fatal */ }

  try {
    const result = await proxyToAI('/strategy/score', { symbol, exchange, regime, ohlcv })

    // Save to user history
    const histId = crypto.randomUUID()
    writeSecure(`strategy-scores/${req.user.userId}/${histId}`, {
      id: histId, symbol, exchange, regime,
      compositeScore: result.compositeScore,
      grade: result.grade,
      consensus: result.consensus,
      timestamp: Date.now(),
    })

    res.json(result)
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'AI backend timeout' })
    res.status(503).json({ error: 'AI backend unavailable', fallback: true })
  }
})

// ── POST /api/strategy-score/batch ───────────────────────────────────────────

router.post('/batch', requireAuth, async (req, res) => {
  const rawSymbols = Array.isArray(req.body.symbols) ? req.body.symbols : []
  if (rawSymbols.length === 0) return res.status(400).json({ error: 'symbols array required' })
  if (rawSymbols.length > 20)  return res.status(400).json({ error: 'Max 20 symbols per batch' })

  const symbols = rawSymbols.map(s => ({
    symbol:   sanitizeSymbol(s.symbol ?? s),
    exchange: stripHtml(String(s.exchange ?? 'NSE')).trim(),
    regime:   stripHtml(String(s.regime   ?? 'trending')).trim(),
  })).filter(s => s.symbol)

  // Fetch OHLCV for all symbols in parallel
  const ohlcvMap = {}
  await Promise.allSettled(
    symbols.map(async ({ symbol, exchange }) => {
      try {
        const data = await fetchOHLCV(symbol, exchange, 250)
        if (data) ohlcvMap[symbol] = data
      } catch { /* non-fatal */ }
    })
  )

  try {
    const result = await proxyToAI('/strategy/score/batch', { symbols, ohlcv_map: ohlcvMap }, 60_000)
    res.json(result)
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'AI backend timeout' })
    res.status(503).json({ error: 'AI backend unavailable', fallback: true })
  }
})

// ── GET /api/strategy-score/history ──────────────────────────────────────────

router.get('/history', requireAuth, (req, res) => {
  try {
    const files = listSecure(`strategy-scores/${req.user.userId}`)
    const history = files
      .map(f => readSecure(`strategy-scores/${req.user.userId}/${f}`))
      .filter(Boolean)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 100)
    res.json(history)
  } catch {
    res.json([])
  }
})

// ── GET /api/strategy-score/export ───────────────────────────────────────────
// Returns CSV — Excel export is handled client-side via the frontend

router.get('/export', requireAuth, (req, res) => {
  try {
    const files = listSecure(`strategy-scores/${req.user.userId}`)
    const history = files
      .map(f => readSecure(`strategy-scores/${req.user.userId}/${f}`))
      .filter(Boolean)
      .sort((a, b) => b.timestamp - a.timestamp)

    const rows = [
      ['Symbol', 'Exchange', 'Regime', 'Score', 'Grade', 'Consensus', 'Date'],
      ...history.map(h => [
        h.symbol, h.exchange, h.regime,
        h.compositeScore, h.grade, h.consensus,
        new Date(h.timestamp).toISOString().slice(0, 19).replace('T', ' '),
      ]),
    ]

    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename="strategy-scores.csv"')
    res.send(csv)
  } catch (err) {
    res.status(500).json({ error: 'Export failed' })
  }
})

export default router
