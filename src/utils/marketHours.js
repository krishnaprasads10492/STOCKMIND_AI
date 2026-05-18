/**
 * marketHours.js — Market session detection for all supported modules.
 *
 * Returns whether a market is currently in a live trading session,
 * and what the next open time is.
 *
 * All times in IST (UTC+5:30) for Indian markets.
 * Crypto is always open (24/7).
 */

// ── IST helpers ───────────────────────────────────────────────────────────────

function nowIST() {
  const now = new Date()
  // IST = UTC + 5h30m
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
}

function istMinutes(date = nowIST()) {
  return date.getUTCHours() * 60 + date.getUTCMinutes()
}

function isWeekday(date = nowIST()) {
  const d = date.getUTCDay()
  return d >= 1 && d <= 5
}

// ── Session definitions ───────────────────────────────────────────────────────

const SESSIONS = {
  // NSE/BSE: Mon–Fri 09:15–15:30 IST
  'indices-india':  { open: 555, close: 930, tz: 'IST', days: [1,2,3,4,5] },
  'equities-india': { open: 555, close: 930, tz: 'IST', days: [1,2,3,4,5] },
  'fno-india':      { open: 555, close: 930, tz: 'IST', days: [1,2,3,4,5] },

  // MCX: Mon–Fri 09:00–23:30 IST (commodities)
  'commodities':    { open: 540, close: 1410, tz: 'IST', days: [1,2,3,4,5] },

  // Crypto: 24/7
  'crypto':         { open: 0, close: 1440, tz: 'UTC', days: [0,1,2,3,4,5,6] },

  // Forex: Mon 00:00 UTC – Fri 22:00 UTC (approx)
  'forex':          { open: 0, close: 1320, tz: 'UTC', days: [1,2,3,4,5] },

  // Global indices — approximate (US markets 14:30–21:00 IST)
  'global-indices': { open: 870, close: 1260, tz: 'IST', days: [1,2,3,4,5] },
}

/**
 * Check if a market module is currently in a live trading session.
 *
 * @param {string} moduleId
 * @returns {{ isLive: boolean, label: string, nextOpen: string|null }}
 */
export function getMarketSession(moduleId) {
  const session = SESSIONS[moduleId]
  if (!session) return { isLive: false, label: 'Unknown', nextOpen: null }

  const now = session.tz === 'IST' ? nowIST() : new Date()
  const day  = now.getUTCDay()
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes()

  const isOpen = session.days.includes(day) && mins >= session.open && mins < session.close

  if (isOpen) {
    const closeH = Math.floor(session.close / 60)
    const closeM = session.close % 60
    const closeStr = `${String(closeH).padStart(2,'0')}:${String(closeM).padStart(2,'0')} ${session.tz}`
    return { isLive: true, label: 'LIVE', nextOpen: null, closesAt: closeStr }
  }

  // Calculate next open
  const nextOpen = getNextOpen(session, now)
  return { isLive: false, label: 'CLOSED', nextOpen, closesAt: null }
}

function getNextOpen(session, fromDate) {
  const d = new Date(fromDate)
  for (let i = 1; i <= 7; i++) {
    d.setUTCDate(d.getUTCDate() + 1)
    d.setUTCHours(0, 0, 0, 0)
    if (session.days.includes(d.getUTCDay())) {
      const openH = Math.floor(session.open / 60)
      const openM = session.open % 60
      d.setUTCHours(openH, openM, 0, 0)
      // Convert back to local for display
      return d.toLocaleString('en-IN', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      })
    }
  }
  return null
}

/**
 * Determine if a Yahoo Finance tick represents live or EOD data.
 * Yahoo returns `marketState` in the quote: 'REGULAR' | 'PRE' | 'POST' | 'CLOSED'
 *
 * @param {object} tick — tick from yahoo-finance2
 * @param {string} moduleId
 * @returns {{ isLive: boolean, isEOD: boolean, marketState: string }}
 */
export function classifyTick(tick, moduleId) {
  // Crypto is always live
  if (moduleId === 'crypto') return { isLive: true, isEOD: false, marketState: 'REGULAR' }

  const session = getMarketSession(moduleId)

  // If market is open and data is fresh (< 30s old), it's live
  if (session.isLive && tick?.ts && Date.now() - tick.ts < 30_000) {
    return { isLive: true, isEOD: false, marketState: 'REGULAR' }
  }

  // Market is closed — data is EOD (last close)
  return { isLive: false, isEOD: true, marketState: 'CLOSED' }
}

/**
 * Get the next trading day for a module (for "next day" prediction labelling).
 * @param {string} moduleId
 * @returns {string} — e.g. "Mon, 5 May"
 */
export function getNextTradingDay(moduleId) {
  const session = SESSIONS[moduleId] ?? SESSIONS['indices-india']
  const now = new Date()
  const d = new Date(now)
  for (let i = 1; i <= 7; i++) {
    d.setDate(d.getDate() + 1)
    if (session.days.includes(d.getDay())) {
      return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
    }
  }
  return 'Next trading day'
}

/**
 * Format a "last updated" timestamp for EOD display.
 * @param {number} ts — Unix ms
 * @returns {string}
 */
export function formatEODTime(ts) {
  if (!ts) return 'EOD'
  return new Date(ts).toLocaleString('en-IN', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }) + ' (EOD)'
}
