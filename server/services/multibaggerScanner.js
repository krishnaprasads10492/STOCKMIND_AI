/**
 * multibaggerScanner.js — NSE large/mid-cap multibagger screener.
 *
 * Screens a curated universe of 50 NSE stocks.
 * Scores each stock: fundamental (0-50) + technical (0-50) = composite (0-100).
 * Caches results for 24 hours.
 */

import { fetchQuote, fetchOHLCV } from './yahooFinanceService.js'
import yahooFinance from 'yahoo-finance2'

yahooFinance.suppressNotices(['yahooSurvey'])

// ── Universe ──────────────────────────────────────────────────────────────────

export const UNIVERSE = [
  'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'WIPRO',
  'AXISBANK', 'KOTAKBANK', 'LT', 'HINDUNILVR', 'BAJFINANCE', 'BHARTIARTL',
  'ASIANPAINT', 'MARUTI', 'TITAN', 'NESTLEIND', 'ULTRACEMCO', 'POWERGRID',
  'NTPC', 'ONGC', 'COALINDIA', 'JSWSTEEL', 'TATASTEEL', 'HINDALCO',
  'VEDL', 'GRASIM', 'TECHM', 'HCLTECH', 'SUNPHARMA', 'DRREDDY', 'CIPLA',
  'DIVISLAB', 'APOLLOHOSP', 'ADANIPORTS', 'ADANIENT', 'BAJAJFINSV',
  'BAJAJ-AUTO', 'HEROMOTOCO', 'EICHERMOT', 'TATACONSUM', 'BRITANNIA',
  'DABUR', 'MARICO', 'PIDILITIND', 'BERGEPAINT', 'HAVELLS', 'VOLTAS',
  'MUTHOOTFIN', 'CHOLAFIN',
]

// ── Cache ─────────────────────────────────────────────────────────────────────

const CACHE_TTL = 24 * 60 * 60 * 1000  // 24 hours
let _cache = null
let _lastScanTime = null
let _scanning = false

// ── Scoring helpers ───────────────────────────────────────────────────────────

function fundamentalScore(fundamentals) {
  let score = 0
  const { revenueGrowthYoY, netMargin, roe, debtEquity, pe } = fundamentals

  if (typeof revenueGrowthYoY === 'number' && revenueGrowthYoY > 20) score += 15
  if (typeof netMargin        === 'number' && netMargin > 10)         score += 10
  if (typeof roe              === 'number' && roe > 15)               score += 10
  if (typeof debtEquity       === 'number' && debtEquity < 1.0)       score += 10
  if (typeof pe               === 'number' && pe > 0 && pe < 40)      score += 5

  return Math.min(50, score)
}

function computeEMA(closes, period) {
  if (closes.length < period) return null
  const k = 2 / (period + 1)
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k)
  }
  return ema
}

function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return null
  let gains = 0, losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains  += diff
    else          losses -= diff
  }
  const avgGain = gains  / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

function technicalScore(quote, ohlcv) {
  let score = 0
  if (!quote || !ohlcv || ohlcv.length < 20) return score

  const closes = ohlcv.map(c => c.close).filter(Boolean)
  const currentPrice = quote.price

  // Price > 200d EMA
  const ema200 = computeEMA(closes, Math.min(200, closes.length))
  if (ema200 && currentPrice > ema200) score += 15

  // 52w high within 30%
  const week52High = quote.week52High
  if (week52High && currentPrice >= week52High * 0.70) score += 15

  // Volume > 50k avg
  const avgVol = ohlcv.slice(-20).reduce((s, c) => s + (c.volume ?? 0), 0) / 20
  if (avgVol > 50_000) score += 10

  // RSI 40-70
  const rsi = computeRSI(closes)
  if (rsi !== null && rsi >= 40 && rsi <= 70) score += 10

  return Math.min(50, score)
}

// ── Fetch fundamentals from Yahoo Finance ─────────────────────────────────────

async function fetchFundamentals(symbol) {
  try {
    const yahooSym = `${symbol}.NS`
    const q = await yahooFinance.quoteSummary(yahooSym, {
      modules: ['financialData', 'defaultKeyStatistics', 'summaryDetail'],
    }, { validateResult: false })

    const fd = q?.financialData ?? {}
    const ks = q?.defaultKeyStatistics ?? {}
    const sd = q?.summaryDetail ?? {}

    return {
      revenueGrowthYoY: fd.revenueGrowth != null ? fd.revenueGrowth * 100 : null,
      netMargin:        fd.profitMargins  != null ? fd.profitMargins  * 100 : null,
      roe:              fd.returnOnEquity != null ? fd.returnOnEquity * 100 : null,
      debtEquity:       fd.debtToEquity   ?? null,
      pe:               sd.trailingPE     ?? ks.forwardPE ?? null,
      sector:           null,  // not in quoteSummary easily
      marketCap:        ks.enterpriseValue ?? null,
    }
  } catch {
    return { revenueGrowthYoY: null, netMargin: null, roe: null, debtEquity: null, pe: null }
  }
}

// ── Scan a single symbol ──────────────────────────────────────────────────────

async function scanSymbol(symbol) {
  try {
    const [quote, ohlcv, fundamentals] = await Promise.all([
      fetchQuote(symbol, 'NSE'),
      fetchOHLCV(symbol, 'NSE', 250),
      fetchFundamentals(symbol),
    ])

    if (!quote) return null

    const fundScore = fundamentalScore(fundamentals)
    const techScore = technicalScore(quote, ohlcv)
    const composite = fundScore + techScore

    return {
      symbol,
      companyName:      quote.companyName ?? symbol,
      sector:           quote.sector ?? fundamentals.sector ?? 'Unknown',
      price:            quote.price,
      change:           quote.change,
      changePct:        quote.changePct,
      week52High:       quote.week52High,
      week52Low:        quote.week52Low,
      volume:           quote.volume,
      marketCap:        quote.marketCap ?? fundamentals.marketCap,
      fundamentals,
      fundamentalScore: fundScore,
      technicalScore:   techScore,
      compositeScore:   composite,
      scannedAt:        Date.now(),
    }
  } catch (err) {
    console.warn(`[MultibaggerScanner] Error scanning ${symbol}: ${err.message}`)
    return null
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run a full scan of the universe.
 * @returns {Promise<object[]>}
 */
export async function runScan() {
  if (_scanning) {
    console.warn('[MultibaggerScanner] Scan already in progress')
    return _cache?.candidates ?? []
  }

  _scanning = true
  console.log(`[MultibaggerScanner] Starting scan of ${UNIVERSE.length} symbols…`)

  const results = []
  for (const symbol of UNIVERSE) {
    const result = await scanSymbol(symbol)
    if (result) results.push(result)
    // Throttle to avoid rate limiting
    await new Promise(r => setTimeout(r, 400))
  }

  results.sort((a, b) => b.compositeScore - a.compositeScore)

  _cache = { candidates: results, scannedAt: Date.now() }
  _lastScanTime = Date.now()
  _scanning = false

  console.log(`[MultibaggerScanner] Scan complete — ${results.length} candidates`)
  return results
}

/**
 * Get candidates with optional filters.
 * @param {{ sector?: string, minScore?: number, minRevGrowth?: number, sortBy?: string }} filters
 * @returns {object[]}
 */
export function getCandidates(filters = {}) {
  if (!_cache) return []

  const { sector, minScore = 0, minRevGrowth = 0, sortBy = 'compositeScore' } = filters

  let candidates = _cache.candidates.filter(c => {
    if (sector && c.sector !== sector) return false
    if (c.compositeScore < minScore) return false
    if (typeof c.fundamentals?.revenueGrowthYoY === 'number' && c.fundamentals.revenueGrowthYoY < minRevGrowth) return false
    return true
  })

  const sortFns = {
    compositeScore:   (a, b) => b.compositeScore - a.compositeScore,
    revenueCagr:      (a, b) => (b.fundamentals?.revenueGrowthYoY ?? 0) - (a.fundamentals?.revenueGrowthYoY ?? 0),
    roe:              (a, b) => (b.fundamentals?.roe ?? 0) - (a.fundamentals?.roe ?? 0),
    relativeStrength: (a, b) => (b.technicalScore ?? 0) - (a.technicalScore ?? 0),
  }

  const sortFn = sortFns[sortBy] ?? sortFns.compositeScore
  candidates.sort(sortFn)

  return candidates
}

/**
 * Get last scan time.
 * @returns {{ lastScanTime: number|null, scanning: boolean, candidateCount: number }}
 */
export function getLastScanTime() {
  return {
    lastScanTime:   _lastScanTime,
    scanning:       _scanning,
    candidateCount: _cache?.candidates?.length ?? 0,
    cacheAge:       _lastScanTime ? Date.now() - _lastScanTime : null,
    cacheValid:     _lastScanTime ? (Date.now() - _lastScanTime) < CACHE_TTL : false,
  }
}
