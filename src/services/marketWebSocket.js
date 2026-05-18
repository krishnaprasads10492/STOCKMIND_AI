/**
 * marketWebSocket.js — Unified live market data feed.
 *
 * Source selection per module:
 *
 *   Crypto      → Binance WebSocket (free, real-time, no key)
 *   Indian      → 0xramm API → Finnhub → Mock  (auto-fallback)
 *   Zerodha     → Zerodha SSE (if VITE_LIVE_FEED=zerodha + token)
 *   Other       → 0xramm → Finnhub → Mock
 *
 * UI badge reflects the ACTUAL source of the last tick (tick.source),
 * not just the configured feed — so you always know what you're seeing.
 *
 * Poll interval: 2.4 seconds for all polling sources.
 */

import { useState, useEffect, useRef } from 'react'
import { createIndianFeed } from './indianMarketFeed.js'

const LIVE_FEED     = import.meta.env.VITE_LIVE_FEED          ?? 'auto'
const BINANCE_WS_ON = import.meta.env.VITE_BINANCE_WS_ENABLED !== 'false'

/** Universal poll interval */
export const POLL_MS = 2_400

// ── Source → display metadata ─────────────────────────────────────────────────

export const SOURCE_META = {
  'yahoo':       { label: 'Yahoo',    color: 'yahoo',   live: true,  desc: 'Yahoo Finance via backend — 2.4s polling, no key needed' },
  'finnhub':     { label: 'Finnhub',  color: 'poll',    live: true,  desc: 'Finnhub REST polling — 2.4s' },
  'binance-ws':  { label: 'Binance',  color: 'ws',      live: true,  desc: 'Binance WebSocket — real-time' },
  'zerodha':     { label: 'Zerodha',  color: 'zerodha', live: true,  desc: 'Zerodha Kite Connect — 1s' },
  'mock':        { label: 'Simulated',color: 'mock',    live: false, desc: 'Simulated data — backend not running or market closed' },
}

export function getSourceMeta(source) {
  return SOURCE_META[source] ?? SOURCE_META['mock']
}

// ── 1. Zerodha SSE ────────────────────────────────────────────────────────────

function createZerodhaFeed(symbol, onTick) {
  let es = null
  let active = true
  let reconnectTimer = null

  function connect() {
    if (!active) return
    const token = sessionStorage.getItem('sm_session')
    if (!token) {
      // No session — fall through to Indian feed
      createIndianFeed(symbol, 'NSE', onTick).connect()
      return
    }
    const url = `/api/zerodha/ticks?symbols=${encodeURIComponent(symbol)}`
    es = new EventSource(url)
    es.addEventListener('connected', () => console.info(`[Zerodha SSE] ${symbol}`))
    es.onmessage = (e) => {
      try {
        const tick = JSON.parse(e.data)
        if (tick.symbol === symbol) onTick({ ...tick, source: 'zerodha' })
      } catch { /* ignore */ }
    }
    es.onerror = () => {
      es?.close()
      if (active) reconnectTimer = setTimeout(connect, 5000)
    }
  }

  function disconnect() {
    active = false
    clearTimeout(reconnectTimer)
    es?.close()
  }

  return { connect, disconnect, type: 'zerodha-sse' }
}

// ── 2. Binance WebSocket (Crypto) ─────────────────────────────────────────────

function createBinanceFeed(symbol, onTick) {
  const sym = symbol.toLowerCase()
  const url = `wss://stream.binance.com:9443/ws/${sym}@ticker`
  let ws = null
  let reconnectTimer = null
  let active = true

  function connect() {
    if (!active) return
    ws = new WebSocket(url)
    ws.onopen  = () => console.info(`[Binance WS] ${symbol}`)
    ws.onerror = () => console.warn(`[Binance WS] Error: ${symbol}`)
    ws.onclose = () => { if (active) reconnectTimer = setTimeout(connect, 3000) }
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)
        onTick({
          symbol,
          price:     parseFloat(d.c),
          change:    parseFloat(d.p),
          changePct: parseFloat(d.P),
          high:      parseFloat(d.h),
          low:       parseFloat(d.l),
          volume:    parseFloat(d.v),
          open:      parseFloat(d.o),
          source:    'binance-ws',
          live:      true,
          ts:        Date.now(),
        })
      } catch { /* ignore */ }
    }
  }

  function disconnect() {
    active = false
    clearTimeout(reconnectTimer)
    ws?.close()
  }

  return { connect, disconnect, type: 'websocket' }
}

// ── Factory ───────────────────────────────────────────────────────────────────

const INDIAN_MODULES = new Set([
  'indices-india', 'equities-india', 'fno-india', 'commodities',
])

/**
 * Create the appropriate feed for a symbol + module.
 * The returned feed's `type` is the configured channel;
 * the actual data source is reflected in tick.source.
 */
export function createMarketFeed(symbol, moduleId, onTick, pollMs = POLL_MS) {
  // Crypto → Binance WS
  if (moduleId === 'crypto' && BINANCE_WS_ON) {
    return createBinanceFeed(symbol, onTick)
  }

  // Zerodha override
  if (LIVE_FEED === 'zerodha') {
    return createZerodhaFeed(symbol, onTick)
  }

  // Indian markets + forex + commodities + global → 0xramm → Finnhub → Mock
  const exchange = moduleId === 'equities-india' || INDIAN_MODULES.has(moduleId) ? 'NSE' : 'GLOBAL'
  return createIndianFeed(symbol, exchange, onTick, pollMs)
}

// ── React hook ────────────────────────────────────────────────────────────────

/**
 * useMarketFeed — subscribe to live price updates.
 *
 * Returns:
 *   tick       — latest price data
 *   isLive     — true if data is from a real source
 *   source     — actual data source ('0xramm' | 'finnhub' | 'binance-ws' | 'zerodha' | 'mock')
 *   sourceMeta — { label, color, desc } for UI rendering
 */
export function useMarketFeed(symbol, moduleId, pollMs = POLL_MS) {
  const [tick,       setTick]       = useState(null)
  const [isLive,     setIsLive]     = useState(false)
  const [source,     setSource]     = useState('mock')
  const feedRef = useRef(null)

  useEffect(() => {
    if (!symbol || !moduleId) return

    feedRef.current?.disconnect()

    const feed = createMarketFeed(symbol, moduleId, (t) => {
      setTick(t)
      setIsLive(t.live ?? false)
      setSource(t.source ?? 'mock')
    }, pollMs)

    feed.connect()
    feedRef.current = feed

    return () => feed.disconnect()
  }, [symbol, moduleId, pollMs])

  const sourceMeta = getSourceMeta(source)

  return {
    tick,
    isLive,
    source,
    sourceMeta,
    // Legacy compat
    feedType: source === 'binance-ws' ? 'websocket' : source === 'zerodha' ? 'zerodha-sse' : 'polling',
    provider: sourceMeta.label,
    pollMs:   POLL_MS,
  }
}
