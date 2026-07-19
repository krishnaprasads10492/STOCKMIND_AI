/**
 * jarvis.js — JARVIS self-healing/self-updating intelligence routes.
 *
 * GET  /api/jarvis/status          — full system status snapshot
 * GET  /api/jarvis/events/stream   — SSE live event stream (proxied from Python)
 * GET  /api/jarvis/events/poll     — polling fallback
 * GET  /api/jarvis/dependencies    — dependency scan results
 * GET  /api/jarvis/code-health     — code health analysis
 * GET  /api/jarvis/algo-proposals  — algorithm upgrade proposals
 * POST /api/jarvis/force-scan      — trigger immediate scan
 * POST /api/jarvis/approve         — approve/reject a pending action
 * GET  /api/jarvis/node-health     — Node.js process health (CPU, memory, uptime)
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import os from 'os'
import process from 'process'
import crypto from 'crypto'
import { signedHeaders } from '../utils/internalSign.js'
import {
  appendExchange, listConversations, getConversation,
  starConversation, tagConversation, deleteConversation, getConversationStats,
} from '../services/ramaConversationStore.js'
import {
  saveKnowledgeEntry, listKnowledge, getKnowledgeEntry,
  updateKnowledgeEntry, deleteKnowledgeEntry, getKnowledgeStats,
  runConsolidation, checkAndConsolidate, analyzeStorageDecisions,
} from '../services/ramaKnowledgeStore.js'

const router = Router()
const AI_URL = process.env.AI_BACKEND_URL ?? 'http://localhost:8001'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function aiGet(path, timeoutMs = 30_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${AI_URL}${path}`, {
      signal:  controller.signal,
      headers: signedHeaders(''),
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`AI ${res.status}`)
    return await res.json()
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

async function aiPost(path, body, timeoutMs = 30_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${AI_URL}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...signedHeaders(body) },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`AI ${res.status}`)
    return await res.json()
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

// ── Node.js health (no AI backend needed) ────────────────────────────────────

function getNodeHealth() {
  const mem = process.memoryUsage()
  const uptime = process.uptime()
  const loadAvg = os.loadavg()
  const totalMem = os.totalmem()
  const freeMem  = os.freemem()

  return {
    uptime_seconds:   Math.round(uptime),
    uptime_human:     formatUptime(uptime),
    memory: {
      heap_used_mb:   Math.round(mem.heapUsed  / 1024 / 1024),
      heap_total_mb:  Math.round(mem.heapTotal / 1024 / 1024),
      rss_mb:         Math.round(mem.rss       / 1024 / 1024),
      external_mb:    Math.round(mem.external  / 1024 / 1024),
    },
    system: {
      total_mem_mb:   Math.round(totalMem / 1024 / 1024),
      free_mem_mb:    Math.round(freeMem  / 1024 / 1024),
      used_mem_pct:   Math.round((1 - freeMem / totalMem) * 100),
      load_avg_1m:    Math.round(loadAvg[0] * 100) / 100,
      cpus:           os.cpus().length,
      platform:       os.platform(),
      node_version:   process.version,
    },
    status: mem.heapUsed / mem.heapTotal > 0.9 ? 'WARNING' : 'HEALTHY',
  }
}

function formatUptime(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${Math.floor(s % 60)}s`
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/jarvis/node-health — no AI backend needed, always available
router.get('/node-health', requireAuth, (req, res) => {
  res.json(getNodeHealth())
})

// GET /api/jarvis/status
router.get('/status', requireAuth, async (req, res) => {
  const nodeHealth = getNodeHealth()
  try {
    const aiStatus = await aiGet('/jarvis/status')
    res.json({ ...aiStatus, node: nodeHealth, ai_backend_online: true })
  } catch {
    res.json({
      online: false,
      ai_backend_online: false,
      node: nodeHealth,
      error: 'AI backend unavailable — Python server not running',
      recent_events: [],
      pending_approvals: [],
    })
  }
})

// GET /api/jarvis/events/stream — SSE live stream
// Proxies the Python SSE stream to the browser
router.get('/events/stream', requireAuth, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  // Send initial connected event
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'JARVIS stream connected', timestamp: Date.now() / 1000 })}\n\n`)

  const since = parseFloat(req.query.since ?? '0')
  const aiStreamUrl = `${AI_URL}/jarvis/events${since > 0 ? `?since=${since}` : ''}`

  let aiRes = null
  const keepAlive = setInterval(() => {
    try { res.write(': ping\n\n') } catch { clearInterval(keepAlive) }
  }, 15_000)

  try {
    const controller = new AbortController()
    req.on('close', () => { controller.abort(); clearInterval(keepAlive) })

    aiRes = await fetch(aiStreamUrl, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
    })

    if (!aiRes.ok || !aiRes.body) {
      throw new Error(`AI stream: ${aiRes.status}`)
    }

    const reader = aiRes.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      res.write(chunk)
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      // AI backend down — send error event and keep connection alive with node health
      res.write(`data: ${JSON.stringify({
        type: 'system_health',
        title: 'AI Backend Offline',
        message: 'Python AI backend not running. Node.js backend is healthy.',
        severity: 'WARNING',
        timestamp: Date.now() / 1000,
        data: getNodeHealth(),
      })}\n\n`)
    }
  } finally {
    clearInterval(keepAlive)
  }
})

// GET /api/jarvis/events/poll — polling fallback
router.get('/events/poll', requireAuth, async (req, res) => {
  const since = parseFloat(req.query.since ?? '0')
  try {
    const data = await aiGet(`/jarvis/events/poll?since=${since}`)
    res.json(data)
  } catch {
    res.json({ events: [], count: 0, timestamp: Date.now() / 1000, ai_backend_online: false })
  }
})

// GET /api/jarvis/dependencies
router.get('/dependencies', requireAuth, async (req, res) => {
  try {
    const data = await aiGet('/jarvis/dependencies', 60_000)
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// GET /api/jarvis/code-health
router.get('/code-health', requireAuth, async (req, res) => {
  try {
    const data = await aiGet('/jarvis/code-health', 30_000)
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// GET /api/jarvis/algo-proposals
router.get('/algo-proposals', requireAuth, async (req, res) => {
  try {
    const data = await aiGet('/jarvis/algo-proposals')
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/force-scan — admin only
router.post('/force-scan', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') return res.status(403).json({ error: 'Admin only' })
  const { scan_type } = req.body
  if (!['dependencies', 'code_health', 'diagnostics', 'algo_review'].includes(scan_type)) {
    return res.status(400).json({ error: 'Invalid scan_type' })
  }
  try {
    const data = await aiPost('/jarvis/force-scan', { scan_type }, 60_000)
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/approve — admin only
router.post('/approve', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') return res.status(403).json({ error: 'Admin only' })
  const { action_id, approved } = req.body
  if (!action_id) return res.status(400).json({ error: 'action_id required' })
  try {
    const data = await aiPost('/jarvis/approve', {
      action_id, approved, user: req.user.username,
    })
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/patch — apply a code patch (requires approval token)
router.post('/patch', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') return res.status(403).json({ error: 'Admin only' })
  const { approval_token, rel_path, old_content, new_content } = req.body
  if (!approval_token || !rel_path || old_content === undefined || new_content === undefined) {
    return res.status(400).json({ error: 'approval_token, rel_path, old_content, new_content required' })
  }
  try {
    const data = await aiPost('/jarvis/patch', { approval_token, rel_path, old_content, new_content }, 30_000)
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/install-dep — install a dependency (requires approval token)
router.post('/install-dep', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') return res.status(403).json({ error: 'Admin only' })
  const { approval_token, manager, package: pkg, version } = req.body
  if (!approval_token || !manager || !pkg) {
    return res.status(400).json({ error: 'approval_token, manager, package required' })
  }
  try {
    const data = await aiPost('/jarvis/install-dep', { approval_token, manager, package: pkg, version: version ?? '' }, 120_000)
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/run-tests — run test suite
router.post('/run-tests', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') return res.status(403).json({ error: 'Admin only' })
  const { test_runner = 'pytest', test_path = '' } = req.body
  try {
    const data = await aiPost('/jarvis/run-tests', { test_runner, test_path }, 300_000)
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/rollback — rollback a patched file
router.post('/rollback', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') return res.status(403).json({ error: 'Admin only' })
  const { approval_token, backup_filename } = req.body
  if (!approval_token || !backup_filename) {
    return res.status(400).json({ error: 'approval_token, backup_filename required' })
  }
  try {
    const data = await aiPost('/jarvis/rollback', { approval_token, backup_filename }, 30_000)
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// GET /api/jarvis/backups — list available backups
router.get('/backups', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') return res.status(403).json({ error: 'Admin only' })
  try {
    const data = await aiGet('/jarvis/backups')
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/issue-token — issue an approval token (admin only)
router.post('/issue-token', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') return res.status(403).json({ error: 'Admin only' })
  try {
    const data = await aiPost('/jarvis/issue-token', {})
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// ── Theme generation routes ───────────────────────────────────────────────────

// POST /api/jarvis/generate-theme — generate a theme from description (any auth)
router.post('/generate-theme', requireAuth, async (req, res) => {
  const { name, description } = req.body
  if (!name || !description) {
    return res.status(400).json({ error: 'name and description required' })
  }
  if (typeof name !== 'string' || name.length > 50) {
    return res.status(400).json({ error: 'name must be a string ≤ 50 chars' })
  }
  if (typeof description !== 'string' || description.length > 200) {
    return res.status(400).json({ error: 'description must be a string ≤ 200 chars' })
  }
  try {
    const data = await aiPost('/jarvis/generate-theme', { name, description }, 15_000)
    res.json(data)
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Theme generation timed out' })
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/write-theme — write approved theme to themes.js (admin only)
router.post('/write-theme', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Admin only' })
  }
  const { approval_token, theme } = req.body
  if (!approval_token || !theme) {
    return res.status(400).json({ error: 'approval_token and theme required' })
  }
  try {
    const data = await aiPost('/jarvis/write-theme', { approval_token, theme }, 30_000)
    res.json(data)
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Write timed out' })
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/theme-from-image — create theme from uploaded image
// Accepts: JSON { image_b64, name, description?, use_as_wallpaper?, n_colors? }
// OR multipart with 'image' file field + other fields
router.post('/theme-from-image', requireAuth, async (req, res) => {  try {
    let image_b64 = req.body?.image_b64
    const name            = String(req.body?.name ?? '').trim()
    const description     = String(req.body?.description ?? '').trim()
    const use_as_wallpaper = req.body?.use_as_wallpaper !== false
    const n_colors        = Math.min(20, Math.max(4, Number(req.body?.n_colors ?? 10)))

    if (!name) return res.status(400).json({ error: 'name required' })
    if (!image_b64) return res.status(400).json({ error: 'image_b64 required' })

    // Validate it looks like an image
    if (!image_b64.startsWith('data:image') && !image_b64.match(/^[A-Za-z0-9+/].*={0,2}$/)) {
      return res.status(400).json({ error: 'image_b64 must be a base64 image or data URL' })
    }

    const data = await aiPost('/jarvis/theme-from-image', {
      image_b64, name, description, use_as_wallpaper, n_colors,
    }, 60_000)

    res.json(data)
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Theme generation timed out' })
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/theme-compare
// Runs web search + uploaded image extraction in parallel, scores both, returns for comparison.
router.post('/theme-compare', requireAuth, async (req, res) => {
  try {
    const name           = String(req.body?.name ?? '').trim()
    const style          = String(req.body?.style ?? '').trim()
    const image_b64      = req.body?.image_b64 ?? null
    const use_as_wallpaper = req.body?.use_as_wallpaper !== false
    const n_colors       = Math.min(20, Math.max(4, Number(req.body?.n_colors ?? 10)))
    const image_count    = Math.min(12, Math.max(2, Number(req.body?.image_count ?? 6)))

    if (!name) return res.status(400).json({ error: 'name required' })

    const data = await aiPost('/jarvis/theme-compare', {
      name, style, image_b64, use_as_wallpaper, n_colors, image_count,
    }, 90_000)   // longer timeout — runs two pipelines in parallel

    res.json(data)
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Theme compare timed out' })
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// ── JARVIS Brain (Conversational AI) routes ───────────────────────────────────

// POST /api/jarvis/brain/chat — main conversational endpoint
// Persists every exchange to rama_conversations (MongoDB → local fallback)
router.post('/brain/chat', requireAuth, async (req, res) => {
  const { conv_id, message, use_cloud } = req.body
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message required' })
  }
  if (message.length > 3000) {
    return res.status(400).json({ error: 'message too long (max 3000 chars)' })
  }
  try {
    const sessionHash = crypto.createHash('sha256')
      .update(req.user?.userId ?? 'anon').digest('hex').slice(0, 32)

    const data = await aiPost('/jarvis/brain/chat', {
      conv_id:    conv_id ?? null,
      message:    message.trim(),
      use_cloud:  use_cloud !== false,
      session_id: sessionHash,
      user_role:  req.user?.role ?? 'user',
    }, 60_000)

    res.json(data)

    // ── Persist exchange to conversation store (fire-and-forget) ─────────────
    // Done after res.json() so it never delays the response
    if (data?.conv_id && !data.error) {
      const isFirst = !conv_id  // no conv_id in request → first message
      appendExchange(data.conv_id, {
        userMessage:      message.trim(),
        assistantMessage: data.response ?? '',
        intent:           data.intent   ?? null,
        provider:         data.provider ?? 'local',
        tokens:           data.tokens_used ?? 0,
        wasFiltered:      data.was_filtered ?? false,
        isFirst,
      }, {
        userId:   req.user?.userId   ?? 'anon',
        username: req.user?.username ?? 'unknown',
        userRole: req.user?.role     ?? 'user',
      }).catch(err => console.warn('[brain/chat] conv store error:', err.message))

      // ── Auto-extract knowledge from meaningful responses ──────────────────
      // Only for admin/super-admin, only for substantive responses (>200 chars)
      // Only for intents that are likely to produce reusable knowledge
      const knowledgeIntents = new Set([
        'RESEARCH','WRITE_CONTENT','CODING_ASSIST','DATA_ANALYSIS',
        'SECURITY_AUDIT','AUTOMATION','EXPLAIN_CODE','UPGRADE_ALGO',
        'ANALYZE_ACCURACY','ADD_FEATURE','MODIFY_FEATURE','FETCH_DATA',
      ])
      const userRole = req.user?.role ?? 'user'
      const responseText = data.response ?? ''
      const intent = data.intent ?? ''
      if (
        (userRole === 'super-admin' || userRole === 'admin') &&
        responseText.length > 200 &&
        knowledgeIntents.has(intent)
      ) {
        const topicPreview = message.trim().slice(0, 70)
        const typeMap = {
          RESEARCH: 'research', WRITE_CONTENT: 'general', CODING_ASSIST: 'code',
          DATA_ANALYSIS: 'insight', SECURITY_AUDIT: 'insight', AUTOMATION: 'code',
          EXPLAIN_CODE: 'insight', UPGRADE_ALGO: 'insight',
          ANALYZE_ACCURACY: 'insight', ADD_FEATURE: 'code', MODIFY_FEATURE: 'code',
          FETCH_DATA: 'market',
        }
        saveKnowledgeEntry({
          type:     typeMap[intent] ?? 'general',
          topic:    topicPreview,
          content:  responseText.slice(0, 4000),
          source:   'rama_response',
          convId:   data.conv_id,
          userId:   req.user?.userId,
          username: req.user?.username,
          userRole,
          intent,
          provider: data.provider ?? 'local',
          importance: 3,
          tags:     [intent.toLowerCase()],
        }).catch(() => {})
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Brain timeout — AI backend may be busy' })
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/brain/self-optimize — super-admin only
router.post('/brain/self-optimize', requireAuth, async (req, res) => {
  if (req.user?.role !== 'super-admin') {
    return res.status(403).json({ error: 'Super-admin only' })
  }
  try {
    const data = await aiPost('/jarvis/brain/self-optimize', {}, 60_000)
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/brain/feedback — record feedback on a response
router.post('/brain/feedback', requireAuth, async (req, res) => {
  const { conv_id, message_idx, feedback, intent } = req.body
  const validFeedback = ['accepted', 'rejected', 'modified']
  if (!conv_id || message_idx == null || !validFeedback.includes(feedback)) {
    return res.status(400).json({ error: 'conv_id, message_idx, feedback required' })
  }
  try {
    const data = await aiPost('/jarvis/brain/feedback', { conv_id, message_idx, feedback, intent: intent ?? '' })
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// GET /api/jarvis/brain/stats
router.get('/brain/stats', requireAuth, async (req, res) => {
  try {
    const data = await aiGet('/jarvis/brain/stats')
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// GET /api/jarvis/brain/conversation/:convId
router.get('/brain/conversation/:convId', requireAuth, async (req, res) => {
  const convId = req.params.convId.replace(/[^a-f0-9-]/g, '').slice(0, 36)
  if (!convId) return res.status(400).json({ error: 'Invalid conv_id' })
  try {
    const data = await aiGet(`/jarvis/brain/conversation/${convId}`)
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// GET /api/jarvis/brain/conversations
router.get('/brain/conversations', requireAuth, async (req, res) => {
  const n = Math.min(50, Math.max(1, parseInt(req.query.n ?? '10', 10)))
  try {
    const data = await aiGet(`/jarvis/brain/conversations?n=${n}`)
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/brain/new-conversation
router.post('/brain/new-conversation', requireAuth, async (req, res) => {
  try {
    const data = await aiPost('/jarvis/brain/new-conversation', {})
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/brain/rebuild-knowledge — admin only
router.post('/brain/rebuild-knowledge', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Admin only' })
  }
  try {
    const data = await aiPost('/jarvis/brain/rebuild-knowledge', {})
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// ── Rama Conversation Store routes ────────────────────────────────────────────
// These read from MongoDB (not from Python) — admin/super-admin only

// GET /api/jarvis/brain/conversation-store — paginated list
router.get('/brain/conversation-store', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Admin only' })
  }
  const page     = Math.max(1,   Number(req.query.page     ?? 1))
  const limit    = Math.min(100, Number(req.query.limit    ?? 25))
  const search   = String(req.query.search   ?? '').trim().slice(0, 100)
  const userRole = String(req.query.userRole ?? '').trim()
  const username = String(req.query.username ?? '').trim().slice(0, 50)
  const starred  = req.query.starred === 'true' ? true : req.query.starred === 'false' ? false : undefined
  try {
    const result = await listConversations({ page, limit, search, userRole, username, starred })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/jarvis/brain/conversation-store/stats
router.get('/brain/conversation-store/stats', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Admin only' })
  }
  try {
    res.json(await getConversationStats())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/jarvis/brain/conversation-store/:convId — full conversation with messages
router.get('/brain/conversation-store/:convId', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Admin only' })
  }
  const convId = req.params.convId.replace(/[^a-f0-9-]/g, '').slice(0, 36)
  if (!convId) return res.status(400).json({ error: 'Invalid conv_id' })
  try {
    const conv = await getConversation(convId)
    if (!conv) return res.status(404).json({ error: 'Conversation not found' })
    res.json(conv)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/jarvis/brain/conversation-store/:convId/star
router.patch('/brain/conversation-store/:convId/star', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Admin only' })
  }
  const convId  = req.params.convId.replace(/[^a-f0-9-]/g, '').slice(0, 36)
  const starred = Boolean(req.body?.starred)
  try {
    await starConversation(convId, starred)
    res.json({ ok: true, convId, starred })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/jarvis/brain/conversation-store/:convId/tags
router.patch('/brain/conversation-store/:convId/tags', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Admin only' })
  }
  const convId = req.params.convId.replace(/[^a-f0-9-]/g, '').slice(0, 36)
  const tags   = Array.isArray(req.body?.tags) ? req.body.tags : []
  try {
    await tagConversation(convId, tags)
    res.json({ ok: true, convId, tags })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/jarvis/brain/conversation-store/:convId — super-admin only
router.delete('/brain/conversation-store/:convId', requireAuth, async (req, res) => {
  if (req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Super-admin only' })
  }
  const convId = req.params.convId.replace(/[^a-f0-9-]/g, '').slice(0, 36)
  if (!convId) return res.status(400).json({ error: 'Invalid conv_id' })
  try {
    await deleteConversation(convId)
    res.json({ ok: true, convId })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── JARVIS AGI routes ─────────────────────────────────────────────────────────

// POST /api/jarvis/agi/execute — execute a goal with full AGI stack
router.post('/agi/execute', requireAuth, async (req, res) => {
  const { goal, conv_id, use_agent } = req.body
  if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
    return res.status(400).json({ error: 'goal required' })
  }
  if (goal.length > 3000) {
    return res.status(400).json({ error: 'goal too long (max 3000 chars)' })
  }
  try {
    const data = await aiPost('/jarvis/agi/execute', {
      goal:      goal.trim(),
      conv_id:   conv_id ?? null,
      use_agent: use_agent !== false,
    }, 120_000)
    res.json(data)
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'AGI timeout — task may still be running' })
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// GET /api/jarvis/agi/task/:taskId
router.get('/agi/task/:taskId', requireAuth, async (req, res) => {
  const taskId = req.params.taskId.replace(/[^a-f0-9-]/g, '').slice(0, 36)
  if (!taskId) return res.status(400).json({ error: 'Invalid task_id' })
  try {
    const data = await aiGet(`/jarvis/agi/task/${taskId}`)
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// GET /api/jarvis/agi/tasks
router.get('/agi/tasks', requireAuth, async (req, res) => {
  try {
    const data = await aiGet('/jarvis/agi/tasks')
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/agi/feedback
router.post('/agi/feedback', requireAuth, async (req, res) => {
  const { response, feedback, intent } = req.body
  const validFeedback = ['accepted', 'rejected', 'modified']
  if (!validFeedback.includes(feedback)) {
    return res.status(400).json({ error: 'feedback must be accepted|rejected|modified' })
  }
  try {
    const data = await aiPost('/jarvis/agi/feedback', { response: response ?? '', feedback, intent: intent ?? '' })
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// GET /api/jarvis/agi/insights
router.get('/agi/insights', requireAuth, async (req, res) => {
  try {
    const data = await aiGet('/jarvis/agi/insights')
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// GET /api/jarvis/agi/capabilities
router.get('/agi/capabilities', requireAuth, async (req, res) => {  try {
    const data = await aiGet('/jarvis/agi/capabilities')
    res.json(data)
  } catch {
    // Return static capabilities when AI backend is offline
    res.json({
      tools: ['read_file', 'list_files', 'search_code', 'generate_code', 'patch_file',
              'create_file', 'run_tests', 'fetch_data', 'analyze_accuracy', 'system_status',
              'generate_theme', 'web_search'],
      ai_paradigms: [
        { name: 'Narrow AI',      description: 'Specialized ML models for market predictions' },
        { name: 'Generative AI',  description: 'LLM-powered code generation and scaffolding' },
        { name: 'Agentic AI',     description: 'ReAct loop: multi-step autonomous task execution' },
        { name: 'Multi-Agent',    description: 'Specialized sub-agents for different domains' },
        { name: 'Self-Improving', description: 'Learns from feedback, improves own prompts' },
      ],
      providers: { available: ['local'], active: 'local', has_cloud: false },
      ai_backend_online: false,
    })
  }
})

// ── AI Provider Management routes ─────────────────────────────────────────────

// GET /api/jarvis/providers
router.get('/providers', requireAuth, async (req, res) => {
  try {
    const data = await aiGet('/jarvis/providers')
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/providers/add — admin only
router.post('/providers/add', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Admin only' })
  }
  const { id, name, base_url, env_key, format, models, note } = req.body
  if (!id || !name || !base_url) {
    return res.status(400).json({ error: 'id, name, base_url required' })
  }
  try {
    const data = await aiPost('/jarvis/providers/add', { id, name, base_url, env_key, format, models, note })
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/providers/set-model — admin only
router.post('/providers/set-model', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Admin only' })
  }
  const { provider_id, model_id } = req.body
  if (!provider_id || !model_id) return res.status(400).json({ error: 'provider_id and model_id required' })
  try {
    const data = await aiPost('/jarvis/providers/set-model', { provider_id, model_id })
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/providers/set-active — admin only
router.post('/providers/set-active', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Admin only' })
  }
  const { provider_id } = req.body
  if (!provider_id) return res.status(400).json({ error: 'provider_id required' })
  try {
    const data = await aiPost('/jarvis/providers/set-active', { provider_id })
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/providers/test — admin only
router.post('/providers/test', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Admin only' })
  }
  const { provider_id, model_id } = req.body
  if (!provider_id) return res.status(400).json({ error: 'provider_id required' })
  try {
    const data = await aiPost('/jarvis/providers/test', { provider_id, model_id }, 30_000)
    res.json(data)
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ ok: false, error: 'Test timed out' })
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/jarvis/providers/generate-config
router.post('/providers/generate-config', requireAuth, async (req, res) => {
  const { name, base_url, env_key, format, models } = req.body
  if (!name || !base_url) return res.status(400).json({ error: 'name and base_url required' })
  try {
    const data = await aiPost('/jarvis/providers/generate-config', { name, base_url, env_key, format, models })
    res.json(data)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// JARVIS-X Super-AGI routes (proxy to /jarvis-x/* on Python)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/jarvis-x/status',        requireAuth, async (req, res) => { try { res.json(await aiGet('/jarvis-x/status'))        } catch { res.status(503).json({ error: 'AI backend unavailable' }) } })
router.get('/jarvis-x/lpm',           requireAuth, async (req, res) => { try { res.json(await aiGet('/jarvis-x/lpm'))            } catch { res.status(503).json({ error: 'AI backend unavailable' }) } })
router.get('/jarvis-x/asi',           requireAuth, async (req, res) => { try { res.json(await aiGet('/jarvis-x/asi'))            } catch { res.status(503).json({ error: 'AI backend unavailable' }) } })
router.get('/jarvis-x/asi/proposals', requireAuth, async (req, res) => { try { res.json(await aiGet('/jarvis-x/asi/proposals'))  } catch { res.status(503).json({ error: 'AI backend unavailable' }) } })
router.get('/jarvis-x/dio',           requireAuth, async (req, res) => { try { res.json(await aiGet('/jarvis-x/dio'))            } catch { res.status(503).json({ error: 'AI backend unavailable' }) } })
router.get('/jarvis-x/data-hub',      requireAuth, async (req, res) => { try { res.json(await aiGet('/jarvis-x/data-hub'))       } catch { res.status(503).json({ error: 'AI backend unavailable' }) } })
router.get('/jarvis-x/capabilities',  requireAuth, async (req, res) => { try { res.json(await aiGet('/jarvis-x/capabilities'))   } catch { res.status(503).json({ error: 'AI backend unavailable' }) } })
router.post('/jarvis-x/lpm/compute',  requireAuth, async (req, res) => { try { res.json(await aiPost('/jarvis-x/lpm/compute', req.body))  } catch { res.status(503).json({ error: 'AI backend unavailable' }) } })
router.post('/jarvis-x/dio/select-provider', requireAuth, async (req, res) => { try { res.json(await aiPost('/jarvis-x/dio/select-provider', req.body)) } catch { res.status(503).json({ error: 'AI backend unavailable' }) } })
router.post('/jarvis-x/data-hub/sentiment',  requireAuth, async (req, res) => { try { res.json(await aiPost('/jarvis-x/data-hub/sentiment', req.body))  } catch { res.status(503).json({ error: 'AI backend unavailable' }) } })
router.post('/jarvis-x/asi/proposals/:id/approve', requireAuth, async (req, res) => { try { res.json(await aiPost(`/jarvis-x/asi/proposals/${req.params.id}/approve`, {})) } catch { res.status(503).json({ error: 'AI backend unavailable' }) } })

// ─────────────────────────────────────────────────────────────────────────────
// Blueprint AGI Routes — Perception Engine, ISQ, Multi-Horizon Wave, HUD
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/jarvis/blueprint-status — Full AGI Architecture status (all 3 layers)
router.get('/blueprint-status', requireAuth, async (req, res) => {
  try {
    const data = await aiGet('/agi/blueprint-status', 15_000)
    res.json(data)
  } catch { res.status(503).json({ error: 'AI backend unavailable' }) }
})

// POST /api/jarvis/multi-horizon — Multi-Horizon Wave projections
router.post('/multi-horizon', requireAuth, async (req, res) => {
  const { symbol, exchange, regime, macro_bias, sentiment } = req.body
  if (!symbol) return res.status(400).json({ error: 'symbol required' })
  try {
    const data = await aiPost('/jarvis/multi-horizon', {
      symbol: String(symbol).toUpperCase(),
      exchange: String(exchange ?? 'NSE').toUpperCase(),
      regime:     regime     ?? 'trending_bull',
      macro_bias: macro_bias ?? 0.0,
      sentiment:  sentiment  ?? 0.0,
    }, 30_000)
    res.json(data)
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Wave projection timeout' })
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// GET /api/jarvis/multi-horizon/status
router.get('/multi-horizon/status', requireAuth, async (req, res) => {
  try {
    const data = await aiGet('/jarvis/multi-horizon/status')
    res.json(data)
  } catch { res.status(503).json({ error: 'AI backend unavailable' }) }
})

// GET /api/agi/isq-status — ISQ + ARC Gauge + Circuit Breaker status
router.get('/isq-status', requireAuth, async (req, res) => {
  try {
    const data = await aiGet('/agi/isq-status')
    res.json(data)
  } catch { res.status(503).json({ error: 'AI backend unavailable' }) }
})

// POST /api/jarvis/isq-quantize — Run full ISQ pass
router.post('/isq-quantize', requireAuth, async (req, res) => {
  try {
    const data = await aiPost('/agi/isq-quantize', req.body)
    res.json(data)
  } catch { res.status(503).json({ error: 'AI backend unavailable' }) }
})

// GET /api/jarvis/arc-gauge — ARC Compute Energy Gauge
router.get('/arc-gauge', requireAuth, async (req, res) => {
  try {
    const data = await aiGet('/agi/arc-gauge')
    res.json(data)
  } catch { res.status(503).json({ error: 'AI backend unavailable' }) }
})

// POST /api/jarvis/arc-circuit-reset — Reset ARC circuit breaker
router.post('/arc-circuit-reset', requireAuth, async (req, res) => {
  try {
    const data = await aiPost('/agi/arc-circuit-reset', {})
    res.json(data)
  } catch { res.status(503).json({ error: 'AI backend unavailable' }) }
})

// GET /api/jarvis/circuit-breaker — API Circuit Breaker / Read-Only Lock
router.get('/circuit-breaker', requireAuth, async (req, res) => {
  try {
    const data = await aiGet('/agi/circuit-breaker')
    res.json(data)
  } catch { res.status(503).json({ error: 'AI backend unavailable' }) }
})

// GET /api/jarvis/perception-status — Perception Engine status
router.get('/perception-status', requireAuth, async (req, res) => {
  try {
    const data = await aiGet('/agi/perception-status')
    res.json(data)
  } catch { res.status(503).json({ error: 'AI backend unavailable' }) }
})

// ── Rama Knowledge Store routes ───────────────────────────────────────────────

// GET  /api/jarvis/knowledge               — paginated list
// POST /api/jarvis/knowledge               — save entry manually
// GET  /api/jarvis/knowledge/stats         — storage stats
// GET  /api/jarvis/knowledge/decisions     — Rama's storage decision analysis
// POST /api/jarvis/knowledge/consolidate   — run consolidation (super-admin)
// GET  /api/jarvis/knowledge/:id           — single entry
// PATCH /api/jarvis/knowledge/:id          — update (pin/tag/importance)
// DELETE /api/jarvis/knowledge/:id         — delete (super-admin)

router.get('/knowledge', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Admin only' })
  }
  const page       = Math.max(1,   Number(req.query.page   ?? 1))
  const limit      = Math.min(100, Number(req.query.limit  ?? 25))
  const search     = String(req.query.search    ?? '').trim().slice(0, 100)
  const type       = String(req.query.type      ?? '').trim()
  const importance = req.query.importance ? Number(req.query.importance) : undefined
  const pinned     = req.query.pinned === 'true' ? true : req.query.pinned === 'false' ? false : undefined
  const tags       = req.query.tags ? String(req.query.tags).split(',').map(t => t.trim()).filter(Boolean) : []
  try {
    res.json(await listKnowledge({ page, limit, search, type, importance, pinned, tags }))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/knowledge', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Admin only' })
  }
  const { type, topic, content, importance, tags, convId } = req.body
  if (!topic || !content) return res.status(400).json({ error: 'topic and content required' })
  try {
    const id = await saveKnowledgeEntry({
      type, topic, content, importance, tags, convId: convId ?? null,
      source: 'manual',
      userId:   req.user?.userId,
      username: req.user?.username,
      userRole: req.user?.role,
    })
    res.json({ ok: true, id })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/knowledge/stats', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Admin only' })
  }
  try { res.json(await getKnowledgeStats()) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

router.get('/knowledge/decisions', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Admin only' })
  }
  try { res.json(await analyzeStorageDecisions()) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/knowledge/consolidate', requireAuth, async (req, res) => {
  if (req.user.role !== 'super-admin') return res.status(403).json({ error: 'Super-admin only' })
  const { type, batchSize } = req.body
  try { res.json(await runConsolidation({ type: type ?? null, batchSize: batchSize ?? 50 })) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

router.get('/knowledge/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Admin only' })
  }
  try {
    const entry = await getKnowledgeEntry(req.params.id)
    if (!entry) return res.status(404).json({ error: 'Not found' })
    res.json(entry)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.patch('/knowledge/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Admin only' })
  }
  try {
    await updateKnowledgeEntry(req.params.id, req.body)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/knowledge/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'super-admin') return res.status(403).json({ error: 'Super-admin only' })
  try {
    await deleteKnowledgeEntry(req.params.id)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

export default router

// ─────────────────────────────────────────────────────────────────────────────
// Friday Nexus Protocol Engine — Schema V5.00 Routes
// ─────────────────────────────────────────────────────────────────────────────

router.get('/friday-nexus/status',          requireAuth, async (req, res) => { try { res.json(await aiGet('/friday-nexus/status')) } catch { res.status(503).json({ error: 'AI backend unavailable' }) } })
router.get('/friday-nexus/math-constants',  requireAuth, async (req, res) => { try { res.json(await aiGet('/friday-nexus/math-constants')) } catch { res.status(503).json({ error: 'AI backend unavailable' }) } })
router.post('/friday-nexus/optimize',       requireAuth, async (req, res) => { try { res.json(await aiPost('/friday-nexus/optimize', req.body, 30_000)) } catch { res.status(503).json({ error: 'AI backend unavailable' }) } })
router.post('/friday-nexus/debate',         requireAuth, async (req, res) => { try { res.json(await aiPost('/friday-nexus/debate', req.body)) } catch { res.status(503).json({ error: 'AI backend unavailable' }) } })
router.post('/friday-nexus/mcts-search',    requireAuth, async (req, res) => { try { res.json(await aiPost('/friday-nexus/mcts-search', req.body)) } catch { res.status(503).json({ error: 'AI backend unavailable' }) } })
router.post('/friday-nexus/gamwar-detect',  requireAuth, async (req, res) => { try { res.json(await aiPost('/friday-nexus/gamwar-detect', req.body)) } catch { res.status(503).json({ error: 'AI backend unavailable' }) } })
router.post('/friday-nexus/gamwar-generate',requireAuth, async (req, res) => { try { res.json(await aiPost('/friday-nexus/gamwar-generate', req.body)) } catch { res.status(503).json({ error: 'AI backend unavailable' }) } })
