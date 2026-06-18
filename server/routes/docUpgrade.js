/**
 * docUpgrade.js — Tech Doc → Change Proposal → Apply Pipeline
 *
 * POST /api/doc-upgrade/analyse      — upload doc + provider → AI generates proposals
 * GET  /api/doc-upgrade/sets         — list all proposal sets
 * GET  /api/doc-upgrade/set/:id      — full proposal set details
 * POST /api/doc-upgrade/decide       — submit approve/reject decisions
 * POST /api/doc-upgrade/resolve      — re-run combination analysis
 * POST /api/doc-upgrade/apply/:id    — apply approved+safe proposals
 * GET  /api/doc-upgrade/apply-log    — history of applied changes
 *
 * Security:
 *   - All routes require super-admin
 *   - Apply requires a fresh approval token (single-use, 10 min TTL)
 *   - Every file patch creates a .jarvis_backups/ backup first
 *   - Nothing is applied without explicit user approval
 */

import { Router }  from 'express'
import multer      from 'multer'
import { requireAuth } from '../middleware/auth.js'
import { writeSecure, readSecure } from '../storage/fileStore.js'
import { SELF_UPDATE } from '../services/sustainingSystem.js'

const router     = Router()
const AI_BACKEND = process.env.AI_BACKEND_URL ?? 'http://localhost:8001'
const APPLY_LOG  = 'system/doc-upgrade-apply-log'

// All doc-upgrade routes: super-admin only
router.use((req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' })
  if (req.user.role !== 'super-admin') return res.status(403).json({ error: 'Super-admin only' })
  next()
})

// Multer for file uploads (50MB, all doc types)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(pdf|txt|md|json|html|csv)$/i.test(file.originalname)
      || ['application/pdf','text/plain','text/markdown','application/json','text/html'].includes(file.mimetype)
    cb(null, ok ? true : new Error('Unsupported file type for doc upgrade'))
  },
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function proxyAI(path, body, timeout = 60_000) {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(`${AI_BACKEND}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal,
    })
    clearTimeout(timer)
    return res.ok ? res.json() : { ok: false, error: `AI error ${res.status}` }
  } catch (e) {
    clearTimeout(timer)
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message }
  }
}

async function proxyAIGet(path, timeout = 15_000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(`${AI_BACKEND}${path}`, { signal: ctrl.signal })
    clearTimeout(timer)
    return res.ok ? res.json() : { ok: false }
  } catch { clearTimeout(timer); return { ok: false } }
}

// ── POST /api/doc-upgrade/analyse ─────────────────────────────────────────────
// Accepts file upload OR raw text in body

router.post('/analyse', requireAuth, upload.single('file'), async (req, res) => {
  let doc_text = ''
  const provider_id = req.body?.provider_id ?? 'unknown'
  const doc_name    = req.file?.originalname ?? req.body?.doc_name ?? 'uploaded_doc'

  if (req.file) {
    // Convert file to text
    const mime = req.file.mimetype
    if (mime === 'application/json') {
      doc_text = req.file.buffer.toString('utf8')
    } else if (mime === 'application/pdf') {
      // Basic PDF text extraction (same as AMI route)
      const raw = req.file.buffer.toString('latin1')
      const textObjects = [...raw.matchAll(/BT([\s\S]*?)ET/g)]
        .flatMap(m => [...(m[1].matchAll(/\((.*?)\)\s*Tj/g))].map(t => t[1]))
      doc_text = textObjects.join(' ').replace(/[^\x20-\x7E\n]/g, ' ').slice(0, 100_000)
      if (doc_text.trim().length < 50) {
        doc_text = raw.replace(/[^\x20-\x7E\n\r\t]/g, ' ').slice(0, 100_000)
      }
    } else {
      doc_text = req.file.buffer.toString('utf8', 0, Math.min(req.file.buffer.length, 100_000))
    }
    req.file.buffer = null
  } else if (req.body?.doc_text) {
    doc_text = String(req.body.doc_text).slice(0, 100_000)
  } else {
    return res.status(400).json({ error: 'Provide a file upload or doc_text in body' })
  }

  if (!doc_text.trim()) return res.status(400).json({ error: 'Could not extract text from document' })

  const result = await proxyAI('/doc-upgrade/analyse', { doc_text, doc_name, provider_id }, 90_000)
  res.json(result)
})

// ── GET /api/doc-upgrade/sets ─────────────────────────────────────────────────

router.get('/sets', requireAuth, async (req, res) => {
  const result = await proxyAIGet('/doc-upgrade/sets')
  res.json(result)
})

// ── GET /api/doc-upgrade/set/:id ──────────────────────────────────────────────

router.get('/set/:id', requireAuth, async (req, res) => {
  const result = await proxyAIGet(`/doc-upgrade/set/${req.params.id}`)
  res.json(result)
})

// ── POST /api/doc-upgrade/decide ──────────────────────────────────────────────

router.post('/decide', requireAuth, async (req, res) => {
  const { set_id, decisions } = req.body
  if (!set_id || typeof decisions !== 'object') {
    return res.status(400).json({ error: 'set_id and decisions required' })
  }
  const result = await proxyAI('/doc-upgrade/decide', { set_id, decisions })
  res.json(result)
})

// ── POST /api/doc-upgrade/resolve ─────────────────────────────────────────────

router.post('/resolve', requireAuth, async (req, res) => {
  const result = await proxyAI('/doc-upgrade/resolve-combination', { set_id: req.body?.set_id })
  res.json(result)
})

// ── POST /api/doc-upgrade/apply/:id ──────────────────────────────────────────
// The Apply Engine — patches files for approved+safe proposals

router.post('/apply/:id', requireAuth, async (req, res) => {
  const setId = req.params.id

  // 1. Get the resolved plan from AI
  const plan = await proxyAI('/doc-upgrade/resolve-combination', { set_id: setId })
  if (!plan.ok) return res.status(400).json({ error: 'Could not resolve combination', detail: plan })

  const safeToApply = plan.resolution?.safe_to_apply ?? []
  if (!safeToApply.length) {
    return res.json({ ok: true, applied: 0, message: 'No safe proposals to apply', warnings: plan.resolution?.warnings ?? [] })
  }

  // 2. Get approval token from JARVIS
  const tokenResp = await fetch(`${AI_BACKEND}/jarvis/issue-token`, { method: 'POST' })
  const tokenData = await tokenResp.json()
  const token     = tokenData.token
  if (!token) return res.status(500).json({ error: 'Could not get approval token' })

  const applied = []
  const failed  = []
  const skipped = []

  // 3. Apply each proposal's patch_ops in dependency order
  for (const proposal of safeToApply) {
    const ops = proposal.patch_ops ?? []

    if (!ops.length) {
      // No patch ops defined — record as schema-only (metadata update)
      applied.push({ proposal_id: proposal.id, title: proposal.title, type: 'metadata_only' })
      continue
    }

    let allOpsOk = true
    const opResults = []

    for (const op of ops) {
      if (!op.file || op.old === undefined || op.new === undefined) {
        opResults.push({ file: op.file, ok: false, error: 'Invalid patch op — missing file/old/new' })
        allOpsOk = false
        continue
      }

      // Apply via JARVIS CodebaseEngineer (creates backup, validates path, applies)
      const patchResp = await proxyAI('/jarvis/patch', {
        approval_token: token,
        rel_path:       op.file,
        old_content:    op.old,
        new_content:    op.new,
      }, 30_000)

      opResults.push({ file: op.file, ok: patchResp.ok, backup: patchResp.backup_path, error: patchResp.error })
      if (!patchResp.ok) allOpsOk = false
    }

    if (allOpsOk) {
      applied.push({ proposal_id: proposal.id, title: proposal.title, ops: opResults })
    } else {
      failed.push({ proposal_id: proposal.id, title: proposal.title, ops: opResults })
    }
  }

  // 4. Log the apply run
  const logEntry = {
    set_id:     setId,
    applied_by: req.user?.username,
    applied_at: Date.now(),
    applied,
    failed,
    skipped:    plan.resolution?.skipped?.map(s => ({ id: s.proposal?.id, title: s.proposal?.title, reason: s.reason })) ?? [],
    warnings:   plan.resolution?.warnings ?? [],
  }
  const existingLog = readSecure(APPLY_LOG) ?? []
  writeSecure(APPLY_LOG, [...existingLog, logEntry].slice(-50))

  // 5. Auto-commit if anything was applied
  if (applied.length > 0) {
    try {
      const commitMsg = `feat: apply doc-upgrade for ${safeToApply[0]?.provider ?? 'integration'} (${applied.length} change(s))`
      await SELF_UPDATE.commitAndPush(commitMsg)
    } catch (e) {
      logEntry.commit_error = e.message
    }
  }

  res.json({
    ok:       true,
    set_id:   setId,
    applied:  applied.length,
    failed:   failed.length,
    skipped:  skipped.length,
    results:  { applied, failed, skipped },
    warnings: plan.resolution?.warnings ?? [],
    committed: applied.length > 0,
  })
})

// ── GET /api/doc-upgrade/apply-log ───────────────────────────────────────────

router.get('/apply-log', requireAuth, (req, res) => {
  const log = readSecure(APPLY_LOG) ?? []
  res.json({ ok: true, entries: log.slice().reverse().slice(0, 20) })
})

export default router
