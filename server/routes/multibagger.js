/**
 * multibagger.js — Multibagger scanner routes.
 *
 * GET  /api/multibagger/candidates — filtered candidate list
 * POST /api/multibagger/scan       — trigger fresh scan (admin, rate-limited)
 * GET  /api/multibagger/status     — last scan time + candidate count
 */

import { Router } from 'express'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { stripHtml } from '../utils/sanitize.js'
import { runScan, getCandidates, getLastScanTime } from '../services/multibaggerScanner.js'

const router = Router()

const SCAN_COOLDOWN_MS = 24 * 60 * 60 * 1000  // 24 hours
let lastScanTriggeredAt = null

// ── GET /api/multibagger/candidates ──────────────────────────────────────────

router.get('/candidates', requireAuth, (req, res) => {
  const sector      = req.query.sector      ? stripHtml(String(req.query.sector))      : undefined
  const minScore    = req.query.minScore    ? Number(req.query.minScore)                : 0
  const minRevGrowth = req.query.minRevGrowth ? Number(req.query.minRevGrowth)          : 0
  const sortBy      = req.query.sortBy      ? stripHtml(String(req.query.sortBy))      : 'compositeScore'

  const candidates = getCandidates({ sector, minScore, minRevGrowth, sortBy })
  res.json({ ok: true, count: candidates.length, candidates })
})

// ── POST /api/multibagger/scan ────────────────────────────────────────────────

router.post('/scan', requireAdmin, async (req, res) => {
  const status = getLastScanTime()

  // Rate-limit: once per 24h
  if (lastScanTriggeredAt && (Date.now() - lastScanTriggeredAt) < SCAN_COOLDOWN_MS) {
    const nextAllowed = new Date(lastScanTriggeredAt + SCAN_COOLDOWN_MS).toISOString()
    return res.status(429).json({
      error: 'Scan rate-limited — once per 24 hours',
      nextAllowedAt: nextAllowed,
    })
  }

  if (status.scanning) {
    return res.status(409).json({ error: 'Scan already in progress' })
  }

  lastScanTriggeredAt = Date.now()

  // Fire and forget — scan runs in background
  res.json({ ok: true, message: 'Scan started', startedAt: new Date().toISOString() })

  try {
    await runScan()
  } catch (err) {
    console.error('[Multibagger] Scan error:', err.message)
  }
})

// ── GET /api/multibagger/status ───────────────────────────────────────────────

router.get('/status', requireAuth, (_req, res) => {
  const status = getLastScanTime()
  res.json({
    ok: true,
    ...status,
    lastScanTime: status.lastScanTime ? new Date(status.lastScanTime).toISOString() : null,
  })
})

export default router
