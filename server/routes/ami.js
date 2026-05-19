/**
 * ami.js — Advanced Market Intelligence routes.
 *
 * POST /api/ami/mtf-signals          — run multi-timeframe analysis
 * GET  /api/ami/mtf-signals/:symbol  — list stored MTF signals
 * GET  /api/ami/summary/:symbol      — AMI summary for a symbol
 * POST /api/ami/upload-statement     — upload + analyse financial statement
 * GET  /api/ami/scenarios/:symbol    — list stored scenarios
 * DELETE /api/ami/scenarios/:symbol/:id — delete a scenario
 * GET  /api/ami/danger-log           — get danger signal log
 */

import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../middleware/auth.js'
import { sanitizeTicker, stripHtml } from '../utils/sanitize.js'
import { fetchOHLCV } from '../services/yahooFinanceService.js'
import { writeAMI, listAMI, getAMISummary, deleteAMI } from '../services/amiStore.js'
import crypto from 'crypto'

const router = Router()
const AI_BACKEND = process.env.AI_BACKEND_URL ?? 'http://localhost:8001'
const TIMEOUT_MS = 15_000

const VALID_TIMEFRAMES = ['5m', '15m', '1h', '1d', '1w', '1mo', '3mo', '1y']

// Timeframe → Yahoo Finance interval + range
const TF_CONFIG = {
  '5m':  { interval: '5m',  range: '5d',  bars: 200 },
  '15m': { interval: '15m', range: '60d', bars: 200 },
  '1h':  { interval: '1h',  range: '60d', bars: 200 },
  '1d':  { interval: '1d',  range: '1y',  bars: 250 },
  '1w':  { interval: '1wk', range: '5y',  bars: 260 },
  '1mo': { interval: '1mo', range: '10y', bars: 120 },
  '3mo': { interval: '3mo', range: '10y', bars: 40  },
  '1y':  { interval: '1mo', range: '10y', bars: 120 },
}

// ── Fetch OHLCV for a specific timeframe ──────────────────────────────────────

async function fetchOHLCVForTimeframe(symbol, exchange, timeframe) {
  const cfg = TF_CONFIG[timeframe] ?? TF_CONFIG['1d']
  try {
    // For intraday timeframes use Yahoo v8 chart API directly
    if (['5m', '15m', '1h'].includes(timeframe)) {
      const { toYahooSymbol } = await import('../services/yahooFinanceService.js')
      const yahooSym = toYahooSymbol(symbol, exchange)
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=${cfg.interval}&range=${cfg.range}`
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) {
        const json = await res.json()
        const result = json?.chart?.result?.[0]
        if (result) {
          const timestamps = result.timestamp ?? []
          const q = result.indicators?.quote?.[0] ?? {}
          const ohlcv = timestamps.map((ts, i) => ({
            date:   new Date(ts * 1000).toISOString(),
            open:   q.open?.[i]   ?? null,
            high:   q.high?.[i]   ?? null,
            low:    q.low?.[i]    ?? null,
            close:  q.close?.[i]  ?? null,
            volume: q.volume?.[i] ?? 0,
          })).filter(r => r.close != null).slice(-cfg.bars)
          if (ohlcv.length >= 10) return ohlcv
        }
      }
    }
    // Daily+ timeframes use existing fetchOHLCV
    return await fetchOHLCV(symbol, exchange, cfg.bars)
  } catch (err) {
    console.warn(`[AMI] OHLCV fetch failed for ${symbol} ${timeframe}: ${err.message}`)
    return null
  }
}

// ── Call AI backend for prediction ───────────────────────────────────────────

async function runPrediction(symbol, exchange, instrType, ohlcv, timeframe) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${AI_BACKEND}/predict`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ symbol, exchange, instrType, ohlcv, timeframe, predictionMode: 'both' }),
      signal:  controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.json()
  } catch {
    clearTimeout(timer)
    return null
  }
}

// ── POST /api/ami/mtf-signals ─────────────────────────────────────────────────

router.post('/mtf-signals', requireAuth, async (req, res) => {
  const { symbol: rawSymbol, exchange = 'NSE', timeframes, instrType = 'spot' } = req.body

  const symbol = sanitizeTicker(rawSymbol)
  if (!symbol) return res.status(400).json({ error: 'Invalid symbol' })

  const tfs = Array.isArray(timeframes) && timeframes.length > 0
    ? timeframes.filter(tf => VALID_TIMEFRAMES.includes(tf))
    : ['1d', '1w', '1mo']

  if (tfs.length === 0) return res.status(400).json({ error: 'No valid timeframes provided' })

  const results = {}
  const errors  = {}

  for (const tf of tfs) {
    try {
      const ohlcv = await fetchOHLCVForTimeframe(symbol, exchange, tf)
      if (!ohlcv || ohlcv.length < 10) {
        errors[tf] = 'Insufficient OHLCV data'
        continue
      }

      const prediction = await runPrediction(symbol, exchange, instrType, ohlcv, tf)

      // Build ranked signals from prediction (top 3 per timeframe)
      const signals = prediction?.signals
        ? prediction.signals.slice(0, 3).map(s => ({
            rank:        s.rank,
            type:        s.type,
            probability: s.probability,
            grade:       s.grade,
            entryPrice:  s.entryPrice,
            stopLoss:    s.stopLoss,
            t1Price:     s.t1Price,
            t2Price:     s.t2Price,
            t3Price:     s.t3Price,
            validity:    s.validity,
          }))
        : []

      const record = {
        id:         crypto.randomUUID(),
        symbol,
        exchange,
        instrType,
        timeframe:  tf,
        signals,
        ohlcvBars:  ohlcv.length,
        generatedAt: Date.now(),
        timestamp:  Date.now(),
      }

      writeAMI(symbol, 'mtf-signals', record)
      results[tf] = record
    } catch (err) {
      console.error(`[AMI] MTF signal error for ${symbol} ${tf}:`, err.message)
      errors[tf] = err.message
    }
  }

  res.json({ ok: true, symbol, timeframes: tfs, results, errors })
})

// ── GET /api/ami/mtf-signals/:symbol ─────────────────────────────────────────

router.get('/mtf-signals/:symbol', requireAuth, (req, res) => {
  const symbol = sanitizeTicker(req.params.symbol)
  if (!symbol) return res.status(400).json({ error: 'Invalid symbol' })

  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  const records = listAMI(symbol, 'mtf-signals', { limit })
  res.json({ symbol, records })
})

// ── GET /api/ami/summary/:symbol ──────────────────────────────────────────────

router.get('/summary/:symbol', requireAuth, (req, res) => {
  const symbol = sanitizeTicker(req.params.symbol)
  if (!symbol) return res.status(400).json({ error: 'Invalid symbol' })

  const summary = getAMISummary(symbol)
  res.json({ symbol, ...summary })
})

export default router

// ── POST /api/ami/upload-statement ───────────────────────────────────────────
// Accepts multipart form data with a PDF or Excel file.
// Extracts text, generates scenarios, stores them, discards the file.

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 25 * 1024 * 1024 },  // 25 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel']
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(pdf|xlsx|xls)$/i)) {
      cb(null, true)
    } else {
      cb(new Error('Only PDF and Excel files are accepted'))
    }
  },
})

router.post('/upload-statement', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const { symbol: rawSymbol, exchange = 'NSE' } = req.body
  const symbol = sanitizeTicker(rawSymbol)
  if (!symbol) return res.status(400).json({ error: 'Invalid symbol' })

  // Generate document reference — SHA-256 hash + timestamp
  const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex').slice(0, 16)
  const docRef   = `${fileHash}-${Date.now()}`

  // Extract text from file (basic extraction — real PDF parsing needs pdfjs-dist or similar)
  let extractedText = ''
  try {
    if (req.file.mimetype === 'application/pdf' || req.file.originalname.match(/\.pdf$/i)) {
      // Basic: extract readable ASCII text from PDF buffer
      const raw = req.file.buffer.toString('latin1')
      extractedText = raw.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').slice(0, 50000)
    } else {
      // Excel: convert buffer to string for basic extraction
      extractedText = req.file.buffer.toString('utf8', 0, Math.min(req.file.buffer.length, 50000))
    }
  } catch (err) {
    console.warn('[AMI] Text extraction error:', err.message)
  }

  // Discard the file buffer immediately after extraction
  req.file.buffer = null

  // Extract key financial metrics using regex patterns
  const safeText = stripHtml(extractedText)

  function extractNumber(text, patterns) {
    for (const pattern of patterns) {
      const m = text.match(pattern)
      if (m) {
        const n = parseFloat(m[1].replace(/,/g, ''))
        if (!isNaN(n)) return n
      }
    }
    return null
  }

  const metrics = {
    revenue:        extractNumber(safeText, [/revenue[:\s]+(?:rs\.?\s*)?([0-9,]+(?:\.[0-9]+)?)/i, /total\s+income[:\s]+([0-9,]+(?:\.[0-9]+)?)/i]),
    netProfit:      extractNumber(safeText, [/net\s+profit[:\s]+(?:rs\.?\s*)?([0-9,]+(?:\.[0-9]+)?)/i, /profit\s+after\s+tax[:\s]+([0-9,]+(?:\.[0-9]+)?)/i]),
    ebitda:         extractNumber(safeText, [/ebitda[:\s]+(?:rs\.?\s*)?([0-9,]+(?:\.[0-9]+)?)/i]),
    eps:            extractNumber(safeText, [/eps[:\s]+(?:rs\.?\s*)?([0-9,]+(?:\.[0-9]+)?)/i, /earnings\s+per\s+share[:\s]+([0-9,]+(?:\.[0-9]+)?)/i]),
    totalAssets:    extractNumber(safeText, [/total\s+assets[:\s]+(?:rs\.?\s*)?([0-9,]+(?:\.[0-9]+)?)/i]),
    totalLiab:      extractNumber(safeText, [/total\s+liabilit[yi][e]?s?[:\s]+(?:rs\.?\s*)?([0-9,]+(?:\.[0-9]+)?)/i]),
    equity:         extractNumber(safeText, [/shareholders['\s]+equity[:\s]+(?:rs\.?\s*)?([0-9,]+(?:\.[0-9]+)?)/i]),
    operatingCF:    extractNumber(safeText, [/operating\s+cash\s+flow[:\s]+(?:rs\.?\s*)?([0-9,]+(?:\.[0-9]+)?)/i]),
    freeCF:         extractNumber(safeText, [/free\s+cash\s+flow[:\s]+(?:rs\.?\s*)?([0-9,]+(?:\.[0-9]+)?)/i]),
    capex:          extractNumber(safeText, [/capital\s+expenditure[:\s]+(?:rs\.?\s*)?([0-9,]+(?:\.[0-9]+)?)/i, /capex[:\s]+([0-9,]+(?:\.[0-9]+)?)/i]),
    debtEquity:     extractNumber(safeText, [/debt[- ]to[- ]equity[:\s]+([0-9,]+(?:\.[0-9]+)?)/i]),
    currentRatio:   extractNumber(safeText, [/current\s+ratio[:\s]+([0-9,]+(?:\.[0-9]+)?)/i]),
    roe:            extractNumber(safeText, [/return\s+on\s+equity[:\s]+([0-9,]+(?:\.[0-9]+)?)/i, /roe[:\s]+([0-9,]+(?:\.[0-9]+)?)/i]),
  }

  // Generate 4 scenarios
  const baseRevenue = metrics.revenue ?? 100
  const scenarios = [
    { name: 'Base Case',   revenueAdj: 1.00, marginAdj: 1.00, debtAdj: 1.00 },
    { name: 'Bull Case',   revenueAdj: 1.15, marginAdj: 1.10, debtAdj: 0.90 },
    { name: 'Bear Case',   revenueAdj: 0.90, marginAdj: 0.95, debtAdj: 1.10 },
    { name: 'Stress Case', revenueAdj: 0.75, marginAdj: 0.85, debtAdj: 1.25 },
  ].map(sc => ({
    scenarioName:    sc.name,
    adjustedRevenue: Math.round(baseRevenue * sc.revenueAdj * 100) / 100,
    adjustedProfit:  metrics.netProfit ? Math.round(metrics.netProfit * sc.marginAdj * 100) / 100 : null,
    adjustedDebt:    metrics.debtEquity ? Math.round(metrics.debtEquity * sc.debtAdj * 100) / 100 : null,
    probability:     sc.name === 'Base Case' ? 50 : sc.name === 'Bull Case' ? 25 : sc.name === 'Bear Case' ? 20 : 5,
  }))

  // Store scenario record
  const scenarioRecord = {
    id:           crypto.randomUUID(),
    symbol,
    exchange,
    docRef,
    fileName:     req.file.originalname,
    fileSize:     req.file.size,
    metrics,
    scenarios,
    createdAt:    Date.now(),
    timestamp:    Date.now(),
  }

  writeAMI(symbol, 'scenarios', scenarioRecord)

  res.json({
    ok:      true,
    symbol,
    docRef,
    metrics,
    scenarios,
    message: `Financial statement processed. Original file discarded. Reference: ${docRef}`,
  })
})

// ── GET /api/ami/scenarios/:symbol ───────────────────────────────────────────

router.get('/scenarios/:symbol', requireAuth, (req, res) => {
  const symbol = sanitizeTicker(req.params.symbol)
  if (!symbol) return res.status(400).json({ error: 'Invalid symbol' })

  const page  = Math.max(1, Number(req.query.page ?? 1))
  const limit = 10
  const all   = listAMI(symbol, 'scenarios', { limit: 1000 })
  const total = all.length
  const items = all.slice((page - 1) * limit, page * limit)

  res.json({ symbol, total, page, limit, scenarios: items })
})

// ── DELETE /api/ami/scenarios/:symbol/:id ─────────────────────────────────────

router.delete('/scenarios/:symbol/:id', requireAuth, async (req, res) => {
  const symbol = sanitizeTicker(req.params.symbol)
  const id     = req.params.id.replace(/[^a-f0-9-]/g, '')
  if (!symbol || !id) return res.status(400).json({ error: 'Invalid params' })

  const { deleteAMI } = await import('../services/amiStore.js')
  const ok = deleteAMI(symbol, 'scenarios', id)
  res.json({ ok })
})

// ── GET /api/ami/danger-log ───────────────────────────────────────────────────

router.get('/danger-log', requireAuth, (req, res) => {
  const symbol = req.query.symbol ? sanitizeTicker(req.query.symbol) : null
  const limit  = Math.min(Number(req.query.limit ?? 50), 200)

  if (symbol) {
    const records = listAMI(symbol, 'danger-log', { limit })
    return res.json({ symbol, records })
  }

  res.json({ message: 'Provide ?symbol= to get danger log for a specific symbol' })
})
