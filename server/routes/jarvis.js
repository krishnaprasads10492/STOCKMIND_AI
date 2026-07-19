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

const router = Router()
const AI_URL = process.env.AI_BACKEND_URL ?? 'http://localhost:8001'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function aiGet(path, timeoutMs = 30_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${AI_URL}${path}`, { signal: controller.signal })
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
      headers: { 'Content-Type': 'application/json' },
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
router.post('/brain/chat', requireAuth, async (req, res) => {
  const { conv_id, message, use_cloud } = req.body
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message required' })
  }
  if (message.length > 3000) {
    return res.status(400).json({ error: 'message too long (max 3000 chars)' })
  }
  try {
    const crypto = await import('crypto')
    const sessionHash = crypto.default.createHash('sha256')
      .update(req.user?.userId ?? 'anon').digest('hex').slice(0, 32)

    const data = await aiPost('/jarvis/brain/chat', {
      conv_id:    conv_id ?? null,
      message:    message.trim(),
      use_cloud:  use_cloud !== false,
      session_id: sessionHash,
      // Pass the authenticated user's role — Python enforces capability tier
      user_role:  req.user?.role ?? 'user',
    }, 60_000)  // 60s — super-admin AGI tasks can take longer
    res.json(data)
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
