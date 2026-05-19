/**
 * imageAnalysis.js — Image analysis proxy routes.
 *
 * POST /api/image/analyse        — analyse image via AI backend (async, cloud vision)
 * POST /api/image/analyse-sync   — analyse image via OCR only (fast, no cloud)
 * GET  /api/image/capabilities   — what analysis capabilities are available
 *
 * Accepts multipart/form-data with an image file OR JSON with base64 image.
 * Proxies to the Python AI backend which runs OCR + cloud vision pipeline.
 * The image buffer is NEVER written to disk — processed in memory only.
 */

import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../middleware/auth.js'

const router     = Router()
const AI_BACKEND = process.env.AI_BACKEND_URL ?? 'http://localhost:8001'
const TIMEOUT_MS = 45_000

// Multer: memory storage, 20 MB limit, images only
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only image files are accepted'))
  },
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function callAIBackend(endpoint, payload, timeoutMs = TIMEOUT_MS) {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${AI_BACKEND}${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  ctrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      const err = await res.text().catch(() => 'AI backend error')
      throw new Error(err)
    }
    return await res.json()
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

function fileToBase64(buffer, mimetype) {
  return `data:${mimetype};base64,${buffer.toString('base64')}`
}

// ── POST /api/image/analyse ───────────────────────────────────────────────────
// Accepts: multipart with 'image' field OR JSON { image_b64, context, symbol }

router.post('/analyse', requireAuth, upload.single('image'), async (req, res) => {
  try {
    let image_b64, context, symbol, use_cloud

    if (req.file) {
      // Multipart upload
      image_b64 = fileToBase64(req.file.buffer, req.file.mimetype)
      context   = req.body.context   ?? ''
      symbol    = req.body.symbol    ?? ''
      use_cloud = req.body.use_cloud !== 'false'
      // Discard buffer immediately
      req.file.buffer = null
    } else if (req.body?.image_b64) {
      // JSON body
      image_b64 = req.body.image_b64
      context   = req.body.context   ?? ''
      symbol    = req.body.symbol    ?? ''
      use_cloud = req.body.use_cloud !== false
    } else {
      return res.status(400).json({ error: 'No image provided. Send multipart with "image" field or JSON with "image_b64".' })
    }

    const result = await callAIBackend('/image/analyse', { image_b64, context, symbol, use_cloud })
    res.json(result)
  } catch (err) {
    console.error('[ImageAnalysis] Error:', err.message)
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'AI backend timeout — try /analyse-sync for faster OCR-only analysis' })
    }
    res.status(502).json({ error: `AI backend unavailable: ${err.message}` })
  }
})

// ── POST /api/image/analyse-sync ─────────────────────────────────────────────
// Fast OCR-only analysis, no cloud vision

router.post('/analyse-sync', requireAuth, upload.single('image'), async (req, res) => {
  try {
    let image_b64, context, symbol

    if (req.file) {
      image_b64 = fileToBase64(req.file.buffer, req.file.mimetype)
      context   = req.body.context ?? ''
      symbol    = req.body.symbol  ?? ''
      req.file.buffer = null
    } else if (req.body?.image_b64) {
      image_b64 = req.body.image_b64
      context   = req.body.context ?? ''
      symbol    = req.body.symbol  ?? ''
    } else {
      return res.status(400).json({ error: 'No image provided' })
    }

    const result = await callAIBackend('/image/analyse-sync', { image_b64, context, symbol }, 15_000)
    res.json(result)
  } catch (err) {
    console.error('[ImageAnalysis] Sync error:', err.message)
    res.status(502).json({ error: `AI backend unavailable: ${err.message}` })
  }
})

// ── GET /api/image/capabilities ──────────────────────────────────────────────

router.get('/capabilities', requireAuth, async (req, res) => {
  try {
    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    const r = await fetch(`${AI_BACKEND}/image/capabilities`, { signal: ctrl.signal })
    clearTimeout(timer)
    res.json(await r.json())
  } catch {
    res.json({
      pil: false, tesseract: false, openai: false, anthropic: false, gemini: false,
      cloudVision: false,
      install_hint: 'AI backend not running — start with: cd ai_backend && uvicorn main:app --port 8001',
    })
  }
})

export default router
