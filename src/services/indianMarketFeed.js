/**
 * indianMarketFeed.js — Frontend market data client.
 *
 * Calls our own Express backend (/api/market/*) which uses yahoo-finance2
 * server-side. This avoids all CORS issues — Yahoo Finance blocks browsers
 * but allows server-to-server requests.
 *
 * Source chain (all handled server-side, transparent to frontend):
 *   yahoo-finance2 (primary) → mock (fallback if Yahoo unreachable)
 *
 * The frontend just calls /api/market/quote or /api/market/batch.
 * The badge shows 'yahoo' when live, 'mock' when offline.
 */

const POLL_MS = 2_400

// ── Auth header helper ────────────────────────────────────────────────────────

function authHeader() {
  const token = sessionStorage.getItem('sm_session')
  return token ? { 'x-session-token': token } : {}
}

// ── Single quote ──────────────────────────────────────────────────────────────

/**
 * Fetch a single quote via the backend.
 * @param {string} symbol
 * @param {string} [exchange]
 * @returns {Promise<object|null>}
 */
export async function fetchQuote(symbol, exchange = 'NSE') {
  try {
    const res = await fetch(
      `/api/market/quote/${encodeURIComponent(symbol)}?exchange=${exchange}`,
      {
        headers: authHeader(),
        signal:  AbortSignal.timeout(4_000),
      }
    )
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// ── Batch fetch ───────────────────────────────────────────────────────────────

/**
 * Batch fetch multiple symbols in one backend call.
 * @param {string[]} symbols
 * @param {string}   [exchange]
 * @returns {Promise<Map<string, object>>}
 */
export async function batchFetchQuotes(symbols, exchange = 'NSE') {
  if (!symbols.length) return new Map()
  try {
    const res = await fetch(
      `/api/market/batch?symbols=${encodeURIComponent(symbols.join(','))}&exchange=${exchange}`,
      {
        headers: authHeader(),
        signal:  AbortSignal.timeout(6_000),
      }
    )
    if (!res.ok) return new Map()
    const json = await res.json()
    const result = new Map()
    for (const [sym, tick] of Object.entries(json.data ?? {})) {
      result.set(sym, tick)
    }
    return result
  } catch {
    return new Map()
  }
}

// ── Symbol search ─────────────────────────────────────────────────────────────

export async function searchSymbol(query) {
  try {
    const res = await fetch(
      `/api/market/search?q=${encodeURIComponent(query)}`,
      { headers: authHeader(), signal: AbortSignal.timeout(4_000) }
    )
    if (!res.ok) return []
    const json = await res.json()
    return json.results ?? []
  } catch {
    return []
  }
}

// ── Polling feed factory ──────────────────────────────────────────────────────

/**
 * Create a 2.4s polling feed for any symbol.
 * Calls /api/market/quote → yahoo-finance2 → mock fallback.
 *
 * @param {string}   symbol
 * @param {string}   exchange
 * @param {function} onTick
 * @param {number}   [intervalMs]
 */
export function createIndianFeed(symbol, exchange, onTick, intervalMs = POLL_MS) {
  let timer  = null
  let active = true

  async function poll() {
    if (!active) return

    // Try backend (yahoo-finance2)
    const tick = await fetchQuote(symbol, exchange)
    if (tick) {
      onTick({ ...tick, source: tick.source ?? 'yahoo' })
      return
    }

    // Backend unreachable — emit nothing. UI will show loading/empty state.
    // No simulated data is ever shown.
  }

  return {
    connect()    { poll(); timer = setInterval(poll, intervalMs) },
    disconnect() { active = false; clearInterval(timer) },
    type: 'yahoo-poll',
  }
}
