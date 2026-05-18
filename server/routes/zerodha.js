/**
 * Zerodha Kite Connect routes.
 *
 * GET  /api/zerodha/status          — check if token is valid
 * GET  /api/zerodha/login           — redirect to Kite login page
 * GET  /api/zerodha/callback        — handle post-login redirect, exchange token
 * GET  /api/zerodha/ticks           — SSE stream of live ticks for ?symbols=
 * POST /api/zerodha/logout          — invalidate stored token
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import {
  getLoginUrl, exchangeToken, saveToken, getStoredToken,
  addSseClient, removeSseClient, startTickerPolling,
  getInstrumentToken,
} from '../services/zerodhaService.js'

const router = Router()

// GET /api/zerodha/status
router.get('/status', requireAuth, (_req, res) => {
  const token = getStoredToken()
  res.json({
    connected: !!token,
    provider:  'zerodha',
    message:   token
      ? 'Zerodha connected — live feed active'
      : 'Not connected — visit /api/zerodha/login to authenticate',
  })
})

// GET /api/zerodha/login — redirect to Kite login
router.get('/login', (_req, res) => {
  const apiKey = process.env.ZERODHA_API_KEY ?? process.env.VITE_ZERODHA_API_KEY
  if (!apiKey) {
    return res.status(400).send(
      '<h2>Zerodha not configured</h2>' +
      '<p>Set <code>VITE_ZERODHA_API_KEY</code> and <code>ZERODHA_API_SECRET</code> in your <code>.env.local</code> file.</p>'
    )
  }
  res.redirect(getLoginUrl())
})

// GET /api/zerodha/callback — Kite redirects here after login
router.get('/callback', async (req, res) => {
  const { request_token, status } = req.query

  if (status !== 'success' || !request_token) {
    return res.status(400).send(
      '<h2>Login failed</h2><p>Kite login was cancelled or failed. Close this tab and try again.</p>'
    )
  }

  try {
    const accessToken = await exchangeToken(String(request_token))
    saveToken(accessToken)

    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>StockMind AI — Zerodha Connected</title>
      <style>
        body { font-family: system-ui; background: #060b14; color: #e2f0ff;
               display: flex; align-items: center; justify-content: center;
               min-height: 100vh; margin: 0; }
        .card { background: #0d1520; border: 1px solid #1e3a5f; border-radius: 12px;
                padding: 2rem 3rem; text-align: center; max-width: 400px; }
        h2 { color: #00ff88; margin-bottom: 0.5rem; }
        p  { color: #7ba7cc; font-size: 0.9rem; }
        .close { margin-top: 1.5rem; padding: 0.6rem 2rem; background: #00d4ff;
                 color: #060b14; border: none; border-radius: 6px; font-weight: 700;
                 cursor: pointer; font-size: 1rem; }
      </style>
      </head>
      <body>
        <div class="card">
          <h2>✓ Zerodha Connected</h2>
          <p>Live market data is now active.<br>Access token valid until 6:00 AM IST tomorrow.</p>
          <button class="close" onclick="window.close()">Close this tab</button>
        </div>
      </body>
      </html>
    `)
  } catch (err) {
    console.error('[Zerodha] Token exchange failed:', err.message)
    res.status(500).send(`<h2>Token exchange failed</h2><p>${err.message}</p>`)
  }
})

// GET /api/zerodha/ticks?symbols=NIFTY50,BANKNIFTY — SSE stream
router.get('/ticks', requireAuth, (req, res) => {
  const symbols = String(req.query.symbols ?? '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20) // max 20 symbols per connection

  if (!symbols.length) {
    return res.status(400).json({ error: 'symbols query param required' })
  }

  // Validate all symbols have instrument tokens
  const valid = symbols.filter(s => getInstrumentToken(s))
  if (!valid.length) {
    return res.status(400).json({ error: 'No valid instrument tokens for provided symbols' })
  }

  // SSE headers
  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection',    'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  // Send initial connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ symbols: valid })}\n\n`)

  // Register this client for each symbol
  valid.forEach(sym => addSseClient(sym, res))

  // Start polling if not already running
  startTickerPolling(valid)

  // Heartbeat every 15s to keep connection alive
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n') } catch { clearInterval(heartbeat) }
  }, 30_000)  // 30s heartbeat keeps SSE connection alive

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat)
    valid.forEach(sym => removeSseClient(sym, res))
  })
})

// POST /api/zerodha/logout
router.post('/logout', requireAuth, (_req, res) => {
  const { writeSecure } = require('../storage/fileStore.js')
  writeSecure('system/zerodha-token', { accessToken: null, expiresAt: new Date(0).toISOString() })
  res.json({ ok: true, message: 'Zerodha disconnected' })
})

export default router
