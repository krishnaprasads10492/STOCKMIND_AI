/**
 * docIntel.js — Universal Document Intelligence routes.
 *
 * POST /api/doc-intel/upload      — upload any file (PDF/CSV/Excel/TXT/JSON/image)
 *                                   → extract knowledge → store in AI Knowledge Base
 * POST /api/doc-intel/ingest-text — ingest plain text / news / notes
 * GET  /api/doc-intel/status      — Knowledge Base status
 * GET  /api/doc-intel/knowledge/:symbol — all knowledge for a symbol
 * GET  /api/doc-intel/macro       — current macro context
 * POST /api/doc-intel/search      — search the knowledge base
 * POST /api/multi-level/predict   — predictions at all 8 levels (scalp → investment)
 *
 * Files are NEVER stored to disk — processed in memory, then discarded.
 * Extracted knowledge is stored in the AI Knowledge Base.
 */

import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../middleware/auth.js'
import { sanitizeTicker, stripHtml } from '../utils/sanitize.js'

const router = Router()
const AI_BACKEND = process.env.AI_BACKEND_URL ?? 'http://localhost:8001'

// ── Multer: universal file acceptor (all types, 50MB max) ────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 },   // 50 MB
  fileFilter: (_req, file, cb) => {
    // Accept all useful document and data types
    const allowed = [
      'application/pdf',
      'text/csv', 'text/plain', 'text/markdown',
      'application/json',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    ]
    const allowedExts = /\.(pdf|csv|txt|md|json|xlsx|xls|jpg|jpeg|png|gif|webp)$/i
    if (allowed.includes(file.mimetype) || allowedExts.test(file.originalname)) {
      cb(null, true)
    } else {
      cb(new Error(`File type not supported. Allowed: PDF, CSV, Excel, TXT, JSON, images`))
    }
  },
})

// ── Helper ────────────────────────────────────────────────────────────────────

async function proxyToAI(path, body, timeoutMs = 30_000) {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${AI_BACKEND}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  ctrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { ok: false, error: err.detail ?? `AI error ${res.status}` }
    }
    return res.json()
  } catch (e) {
    clearTimeout(timer)
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message }
  }
}

async function aiGet(path, timeoutMs = 10_000) {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${AI_BACKEND}${path}`, { signal: ctrl.signal })
    clearTimeout(timer)
    return res.ok ? res.json() : { ok: false }
  } catch { clearTimeout(timer); return { ok: false } }
}

// ── POST /api/doc-intel/upload ────────────────────────────────────────────────
// Accepts any supported file. For images: proxies to image analyser + KB ingest.
// For documents: sends buffer as base64 to Python doc_intelligence engine.

router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const symbol   = sanitizeTicker(req.body.symbol ?? '')
  const docType  = req.body.doc_type ? stripHtml(req.body.doc_type) : undefined
  const filename = req.file.originalname
  const mimetype = req.file.mimetype
  const fileB64  = req.file.buffer.toString('base64')

  // Discard buffer immediately after encoding
  req.file.buffer = null

  try {
    let result

    if (mimetype.startsWith('image/')) {
      // Image: use existing image analyser + ingest extracted text into KB
      const imgResult = await proxyToAI('/image/analyse', {
        image_b64: `data:${mimetype};base64,${fileB64}`,
        context:   symbol || '',
        use_cloud: true,
      }, 30_000)

      // Also ingest any extracted text into KB
      const extractedText = imgResult?.merged?.raw_text
        || imgResult?.local?.raw_text
        || imgResult?.summary || ''

      if (extractedText && extractedText.length > 20) {
        await proxyToAI('/doc-intel/ingest-text', {
          text:        extractedText,
          source_name: filename,
          symbol:      symbol || undefined,
          doc_type:    docType || 'technical',
        })
      }

      result = { ok: true, type: 'image', filename, analysis: imgResult }

    } else {
      // Document: send to Python doc intelligence engine
      const docResult = await proxyToAI('/doc-intel/ingest-buffer', {
        file_b64:  fileB64,
        filename,
        mimetype,
        symbol:    symbol || undefined,
        doc_type:  docType,
      }, 45_000)

      result = { ok: docResult.ok !== false, type: 'document', filename, ...docResult }
    }

    res.json(result)
  } catch (err) {
    console.error('[DocIntel] Upload error:', err.message)
    res.status(500).json({ error: 'Processing failed', detail: err.message })
  }
})

// ── POST /api/doc-intel/ingest-text ──────────────────────────────────────────

router.post('/ingest-text', requireAuth, async (req, res) => {
  const text       = stripHtml(String(req.body.text ?? '')).trim()
  const sourceName = stripHtml(String(req.body.source_name ?? 'user-input')).slice(0, 100)
  const symbol     = sanitizeTicker(req.body.symbol ?? '') || undefined
  const docType    = req.body.doc_type ? stripHtml(req.body.doc_type) : undefined

  if (!text || text.length < 10) {
    return res.status(400).json({ error: 'text must be at least 10 characters' })
  }

  const result = await proxyToAI('/doc-intel/ingest-text', {
    text, source_name: sourceName, symbol, doc_type: docType,
  })
  res.json(result)
})

// ── GET /api/doc-intel/status ─────────────────────────────────────────────────

router.get('/status', requireAuth, async (req, res) => {
  const data = await aiGet('/doc-intel/status')
  res.json(data)
})

// ── GET /api/doc-intel/knowledge/:symbol ──────────────────────────────────────

router.get('/knowledge/:symbol', requireAuth, async (req, res) => {
  const symbol = sanitizeTicker(req.params.symbol)
  if (!symbol) return res.status(400).json({ error: 'Invalid symbol' })
  const data = await aiGet(`/doc-intel/knowledge/${symbol}`)
  res.json(data)
})

// ── GET /api/doc-intel/macro ──────────────────────────────────────────────────

router.get('/macro', requireAuth, async (req, res) => {
  const data = await aiGet('/doc-intel/macro-context')
  res.json(data)
})

// ── POST /api/doc-intel/search ────────────────────────────────────────────────

router.post('/search', requireAuth, async (req, res) => {
  const query = stripHtml(String(req.body.query ?? '')).trim()
  if (!query) return res.status(400).json({ error: 'query required' })
  const data = await proxyToAI('/doc-intel/search', { query })
  res.json(data)
})

// ── POST /api/multi-level/predict ─────────────────────────────────────────────

router.post('/multi-level-predict', requireAuth, async (req, res) => {
  const symbol    = sanitizeTicker(req.body.symbol ?? 'NIFTY50')
  const exchange  = String(req.body.exchange ?? 'NSE').toUpperCase().replace(/[^A-Z]/g, '')
  const levels    = req.body.levels  // optional array
  const regime    = req.body.regime  // optional
  const base_prob = req.body.base_prob ?? 0.55

  if (!symbol) return res.status(400).json({ error: 'symbol required' })

  const data = await proxyToAI('/multi-level/predict', {
    symbol, exchange, levels, regime, base_prob,
  }, 45_000)
  res.json(data)
})

export default router
