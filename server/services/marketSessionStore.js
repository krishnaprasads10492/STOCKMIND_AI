/**
 * marketSessionStore.js — Daily market session snapshot storage.
 *
 * Captures and persists three session states per symbol per day:
 *   pre_market   — before regular trading (e.g. 9:00–9:15 IST for NSE)
 *   regular      — during regular trading hours
 *   post_market  — after close (e.g. 15:30–15:45 IST for NSE)
 *
 * Why store this?
 *   1. Previous-day close is the baseline for all intraday change calculations
 *   2. Pre-market price gaps are strong signal inputs for opening predictions
 *   3. Post-market moves predict next-day open direction
 *   4. Stored data feeds the ML models as additional features
 *
 * Storage: data/market-sessions/YYYY-MM-DD/{symbol}.enc
 * Each file contains the full day's session timeline.
 * Retention: 90 days (configurable via MARKET_SESSION_RETENTION_DAYS env var)
 */

import { writeSecure, readSecure, listSecure, deleteSecure } from '../storage/fileStore.js'
import { CACHE } from '../storage/memCache.js'

const RETENTION_DAYS = Number(process.env.MARKET_SESSION_RETENTION_DAYS ?? 90)

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayKey() {
  return new Date().toISOString().slice(0, 10)  // YYYY-MM-DD
}

function sessionPath(symbol, date = todayKey()) {
  return `market-sessions/${date}/${symbol.toUpperCase()}`
}

// ── Read/write a session record ───────────────────────────────────────────────

export function getSessionRecord(symbol, date = todayKey()) {
  const cacheKey = `session:${symbol}:${date}`
  const cached   = CACHE.get(cacheKey)
  if (cached) return cached
  const data = readSecure(sessionPath(symbol, date))
  if (data) CACHE.set(cacheKey, data, 60_000)
  return data
}

function _saveSession(symbol, record, date = todayKey()) {
  writeSecure(sessionPath(symbol, date), record)
  CACHE.set(`session:${symbol}:${date}`, record, 60_000)
}

// ── Update helpers ────────────────────────────────────────────────────────────

/**
 * Record a price snapshot at any point in the day.
 * Automatically classifies into pre/regular/post market based on marketState.
 */
export function recordSnapshot(tick) {
  if (!tick?.symbol || !tick?.price) return

  const symbol = tick.symbol.toUpperCase()
  const date   = todayKey()
  const existing = getSessionRecord(symbol, date) ?? _emptyRecord(symbol, date)

  const snap = {
    price:     tick.price,
    change:    tick.change    ?? null,
    changePct: tick.changePct ?? null,
    volume:    tick.volume    ?? null,
    ts:        tick.ts ?? Date.now(),
  }

  const state = (tick.marketState ?? 'CLOSED').toUpperCase()

  if (state === 'PRE' || state === 'PREPRE') {
    // Pre-market snapshot — update if newer
    if (!existing.preMarket.price || snap.ts > (existing.preMarket.ts ?? 0)) {
      existing.preMarket = { ...snap, marketState: state }
    }
    // Track pre-market high/low
    if (existing.preMarket.priceHigh == null || snap.price > existing.preMarket.priceHigh)
      existing.preMarket.priceHigh = snap.price
    if (existing.preMarket.priceLow == null || snap.price < existing.preMarket.priceLow)
      existing.preMarket.priceLow = snap.price

  } else if (state === 'REGULAR') {
    // Regular session — track open, high, low, last
    if (!existing.regular.open) existing.regular.open = snap.price
    existing.regular.price = snap.price
    existing.regular.change    = snap.change
    existing.regular.changePct = snap.changePct
    existing.regular.volume    = snap.volume
    existing.regular.ts        = snap.ts
    if (existing.regular.high == null || snap.price > existing.regular.high)
      existing.regular.high = snap.price
    if (existing.regular.low == null || snap.price < existing.regular.low)
      existing.regular.low = snap.price

  } else if (state === 'POST' || state === 'POSTPOST') {
    // Post-market
    if (!existing.postMarket.price || snap.ts > (existing.postMarket.ts ?? 0)) {
      existing.postMarket = { ...snap, marketState: state }
    }
    if (existing.postMarket.priceHigh == null || snap.price > existing.postMarket.priceHigh)
      existing.postMarket.priceHigh = snap.price
    if (existing.postMarket.priceLow == null || snap.price < existing.postMarket.priceLow)
      existing.postMarket.priceLow = snap.price
  }

  // Update pre/post market data from tick (Yahoo provides this in the meta even during regular)
  if (tick.preMarketPrice != null) {
    existing.preMarket.price     = tick.preMarketPrice
    existing.preMarket.change    = tick.preMarketChange    ?? null
    existing.preMarket.changePct = tick.preMarketChangePct ?? null
    if (tick.preMarketTime) existing.preMarket.ts = new Date(tick.preMarketTime).getTime()
  }
  if (tick.postMarketPrice != null) {
    existing.postMarket.price     = tick.postMarketPrice
    existing.postMarket.change    = tick.postMarketChange    ?? null
    existing.postMarket.changePct = tick.postMarketChangePct ?? null
    if (tick.postMarketTime) existing.postMarket.ts = new Date(tick.postMarketTime).getTime()
  }

  // Always keep prevDayClose from today's data
  if (tick.prevDayClose ?? tick.close) {
    existing.prevDayClose = tick.prevDayClose ?? tick.close
  }

  existing.updatedAt = Date.now()
  _saveSession(symbol, existing, date)
}

function _emptyRecord(symbol, date) {
  return {
    symbol,
    date,
    prevDayClose: null,
    preMarket:  { price: null, change: null, changePct: null, priceHigh: null, priceLow: null, ts: null, marketState: null },
    regular:    { price: null, open: null, high: null, low: null, change: null, changePct: null, volume: null, ts: null },
    postMarket: { price: null, change: null, changePct: null, priceHigh: null, priceLow: null, ts: null, marketState: null },
    createdAt:  Date.now(),
    updatedAt:  Date.now(),
  }
}

// ── Historical session lookup ─────────────────────────────────────────────────

export function getPreviousDaySession(symbol, daysBack = 1) {
  const date = new Date()
  date.setDate(date.getDate() - daysBack)
  // Skip weekends
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() - 1)
  }
  const dateKey = date.toISOString().slice(0, 10)
  return getSessionRecord(symbol, dateKey)
}

export function getSessionHistory(symbol, days = 5) {
  const records = []
  for (let i = 1; i <= days * 2 && records.length < days; i++) {
    const rec = getPreviousDaySession(symbol, i)
    if (rec) records.push(rec)
  }
  return records
}

// ── Full market context (for prediction engine) ───────────────────────────────
/**
 * Returns enriched context for a symbol including:
 * - today's session so far
 * - previous day's close
 * - pre/post market gaps
 * - multi-day trend summary
 */
export function getMarketContext(symbol) {
  const today    = getSessionRecord(symbol)
  const prevDay  = getPreviousDaySession(symbol, 1)
  const history  = getSessionHistory(symbol, 5)

  const preGap   = today?.preMarket?.price && today?.prevDayClose
    ? ((today.preMarket.price - today.prevDayClose) / today.prevDayClose * 100)
    : null

  const postGap  = prevDay?.postMarket?.price && prevDay?.prevDayClose
    ? ((prevDay.postMarket.price - prevDay.prevDayClose) / prevDay.prevDayClose * 100)
    : null

  // Multi-day close trend
  const closes = history.map(r => r.regular?.price ?? r.prevDayClose).filter(Boolean)
  const trend5d = closes.length >= 2
    ? ((closes[0] - closes[closes.length - 1]) / closes[closes.length - 1] * 100)
    : null

  return {
    symbol,
    today,
    prevDay,
    preMarketGapPct:  preGap  != null ? Math.round(preGap  * 100) / 100 : null,
    postMarketGapPct: postGap != null ? Math.round(postGap * 100) / 100 : null,
    trend5dPct:       trend5d != null ? Math.round(trend5d * 100) / 100 : null,
    historyDays:      history.length,
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

export function cleanupOldSessions() {
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000
  const dates  = listSecure('market-sessions').sort()
  let deleted  = 0

  for (const date of dates) {
    if (new Date(date).getTime() < cutoff) {
      const symbols = listSecure(`market-sessions/${date}`)
      for (const sym of symbols) {
        deleteSecure(`market-sessions/${date}/${sym}`)
        deleted++
      }
    }
  }
  if (deleted > 0) console.log(`[MarketSessions] Cleaned up ${deleted} old session records`)
  return deleted
}
