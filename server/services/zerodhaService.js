/**
 * zerodhaService.js — Zerodha Kite Connect integration.
 *
 * Handles:
 *   1. Login flow  — redirect to Kite login, exchange request_token for access_token
 *   2. Token store — saves access_token to data/system/zerodha-token.json (encrypted)
 *   3. Instrument map — maps symbol names to Kite instrument tokens
 *   4. WebSocket proxy — server-side KiteTicker → broadcasts ticks to frontend via SSE
 *
 * WHY server-side WebSocket?
 *   Kite's WebSocket requires the access_token which must stay server-side.
 *   We use Server-Sent Events (SSE) to push ticks from server → browser.
 *   SSE is one-way (server→client), lightweight, and works through Vite's proxy.
 *
 * COST: Kite Connect requires ₹2000/month developer subscription.
 *       Free for your own trading account usage (personal app).
 */

import crypto from 'crypto'
import https from 'https'
import { writeSecure, readSecure } from '../storage/fileStore.js'

const API_KEY      = process.env.ZERODHA_API_KEY      ?? process.env.VITE_ZERODHA_API_KEY ?? ''
const API_SECRET   = process.env.ZERODHA_API_SECRET   ?? ''
const REDIRECT_URL = process.env.ZERODHA_REDIRECT_URL ?? 'http://localhost:5000/api/zerodha/callback'

// ── Token management ──────────────────────────────────────────────────────────

export function getStoredToken() {
  const data = readSecure('system/zerodha-token')
  if (!data) return null
  // Kite access tokens expire at 6:00 AM IST daily
  const expiry = new Date(data.expiresAt)
  if (expiry < new Date()) {
    console.warn('[Zerodha] Access token expired — re-login required')
    return null
  }
  return data.accessToken
}

export function saveToken(accessToken) {
  // Token expires next day at 6:00 AM IST
  const now = new Date()
  const expiry = new Date()
  expiry.setDate(expiry.getDate() + 1)
  expiry.setHours(6, 0, 0, 0)
  // If it's already past 6 AM today, expiry is today at 6 AM (already expired — shouldn't happen)
  if (expiry < now) expiry.setDate(expiry.getDate() + 1)

  writeSecure('system/zerodha-token', {
    accessToken,
    savedAt:   now.toISOString(),
    expiresAt: expiry.toISOString(),
  })
  console.log(`[Zerodha] Access token saved. Expires: ${expiry.toISOString()}`)
}

// ── Login URL ─────────────────────────────────────────────────────────────────

export function getLoginUrl() {
  return `https://kite.zerodha.com/connect/login?api_key=${API_KEY}&v=3`
}

// ── Exchange request_token for access_token ───────────────────────────────────

export async function exchangeToken(requestToken) {
  if (!API_KEY || !API_SECRET) {
    throw new Error('ZERODHA_API_KEY and ZERODHA_API_SECRET must be set in .env.local')
  }

  // Checksum = SHA-256(api_key + request_token + api_secret)
  const checksum = crypto
    .createHash('sha256')
    .update(API_KEY + requestToken + API_SECRET)
    .digest('hex')

  const body = new URLSearchParams({
    api_key:       API_KEY,
    request_token: requestToken,
    checksum,
  }).toString()

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.kite.trade',
      path:     '/session/token',
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'X-Kite-Version': '3',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.status === 'success') {
            resolve(json.data.access_token)
          } else {
            reject(new Error(json.message ?? 'Token exchange failed'))
          }
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ── Instrument token map ──────────────────────────────────────────────────────
// Kite uses numeric instrument tokens, not symbol names.
// These are the NSE instrument tokens for common indices and stocks.
// Full list: https://api.kite.trade/instruments (download CSV)

export const INSTRUMENT_TOKENS = {
  // Indices
  'NIFTY50':    256265,
  'BANKNIFTY':  260105,
  'SENSEX':     265,
  'NIFTYIT':    259849,
  'FINNIFTY':   257801,
  'NIFTYMID':   288009,
  'NIFTYNXT50': 270857,

  // Equities (NSE)
  'RELIANCE':   738561,
  'TCS':        2953217,
  'HDFCBANK':   341249,
  'INFY':       408065,
  'ICICIBANK':  1270529,
  'HINDUNILVR': 356865,
  'ITC':        424961,
  'SBIN':       779521,
  'BAJFINANCE': 81153,
  'WIPRO':      3787777,
  'AXISBANK':   1510401,
  'MARUTI':     2815745,
  'TATAMOTORS': 884737,
  'SUNPHARMA':  857857,
  'ADANIENT':   25,

  // F&O underlyings (same tokens as above for spot reference)
  'NIFTY':      256265,
  'BANKNIFTY':  260105,
  'FINNIFTY':   257801,
  'MIDCPNIFTY': 288009,
}

export function getInstrumentToken(symbol) {
  return INSTRUMENT_TOKENS[symbol.toUpperCase()] ?? null
}

// ── SSE tick broadcaster ──────────────────────────────────────────────────────
// Clients subscribe via GET /api/zerodha/ticks?symbols=NIFTY50,BANKNIFTY
// Server pushes ticks as SSE events.

const sseClients = new Map() // symbol → Set<res>

export function addSseClient(symbol, res) {
  if (!sseClients.has(symbol)) sseClients.set(symbol, new Set())
  sseClients.get(symbol).add(res)
}

export function removeSseClient(symbol, res) {
  sseClients.get(symbol)?.delete(res)
}

export function broadcastTick(symbol, tick) {
  const clients = sseClients.get(symbol)
  if (!clients?.size) return
  const data = `data: ${JSON.stringify(tick)}\n\n`
  for (const res of clients) {
    try { res.write(data) } catch { clients.delete(res) }
  }
}

// ── KiteTicker WebSocket (server-side) ───────────────────────────────────────
// Kite's binary WebSocket protocol — we use the REST quote API as a simpler
// alternative that doesn't require the kiteconnect npm package.
// For full tick-by-tick data, install: npm install kiteconnect

let tickerActive = false
let tickerInterval = null

export function startTickerPolling(symbols) {
  if (tickerActive) return
  tickerActive = true

  const token = getStoredToken()
  if (!token) {
    console.warn('[Zerodha] No access token — ticker not started')
    return
  }

  const tokens = symbols
    .map(s => getInstrumentToken(s))
    .filter(Boolean)
    .join(',')

  if (!tokens) return

  console.log(`[Zerodha] Starting quote polling for: ${symbols.join(', ')}`)

  async function fetchQuotes() {
    try {
      const res = await fetch(
        `https://api.kite.trade/quote?i=${tokens.split(',').map(t => `NSE:${t}`).join('&i=')}`,
        {
          headers: {
            'X-Kite-Version': '3',
            'Authorization':  `token ${API_KEY}:${token}`,
          },
          signal: AbortSignal.timeout(4000),
        }
      )
      if (!res.ok) return
      const json = await res.json()
      if (json.status !== 'success') return

      for (const [key, q] of Object.entries(json.data ?? {})) {
        const symbol = key.replace('NSE:', '')
        const tick = {
          symbol,
          price:     q.last_price,
          change:    q.net_change,
          changePct: q.ohlc?.close ? ((q.last_price - q.ohlc.close) / q.ohlc.close * 100) : 0,
          open:      q.ohlc?.open,
          high:      q.ohlc?.high ?? q.upper_circuit_limit,
          low:       q.ohlc?.low  ?? q.lower_circuit_limit,
          volume:    q.volume_traded,
          oi:        q.oi,
          source:    'zerodha',
          live:      true,
          ts:        Date.now(),
        }
        broadcastTick(symbol, tick)
      }
    } catch (e) {
      console.warn('[Zerodha] Quote fetch error:', e.message)
    }
  }

  fetchQuotes()
  tickerInterval = setInterval(fetchQuotes, 1000) // 1-second polling (Kite allows this)
}

export function stopTicker() {
  tickerActive = false
  clearInterval(tickerInterval)
}
