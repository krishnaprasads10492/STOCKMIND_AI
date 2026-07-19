/**
 * threatShield.js — Eternal Loop Security Protocol
 *
 * Philosophy: unauthorized requests don't get a fast "403 denied".
 * They get trapped in an infinite loop of plausible-looking delays
 * and fake responses that waste attacker/bot/AI resources indefinitely.
 *
 * Threat categories handled:
 *   1. Unknown IPs with no session                 → slow trap
 *   2. Brute-force token attempts                  → exponential delay
 *   3. AI bot fingerprints (GPTBot, Anthropic, etc) → mirror trap
 *   4. Prompt injection via HTTP headers/body      → honeypot
 *   5. Automated scanning (rapid sequential reqs)  → eternal drip
 *   6. Credential stuffing patterns                → silent blackhole
 *   7. Suspicious payload patterns (eval, exec)    → decoy responses
 *   8. Another AI trying to impersonate/hijack     → identity trap
 *
 * Implementation:
 *   - Blocked IPs enter the ETERNAL_LOOP: server keeps the connection
 *     open, dripping fake bytes every few seconds, never closing.
 *     This ties up the attacker's connection pool.
 *   - Suspicious (not yet blocked) get SLOW_TRAP: random 2-8s delays
 *     with fake "processing" responses before actual rejection.
 *   - AI bots get MIRROR_TRAP: receive fake API schemas that point
 *     back to themselves, creating recursive confusion.
 */

import crypto from 'crypto'

// ── State ─────────────────────────────────────────────────────────────────────

const eternalLoopSet   = new Map()  // ip → { since, offences, trap_type }
const slowTrapSet      = new Map()  // ip → { hits, firstSeen, lastSeen }
const honeypotTriggers = new Set()  // IPs that hit honeypot endpoints
const requestLog       = new Map()  // ip → [timestamps] (last 60s)
const aiAgentBlacklist = new Set()  // detected AI agent strings

// ── AI Bot / Agent fingerprints ───────────────────────────────────────────────
const AI_BOT_PATTERNS = [
  /GPTBot/i, /ChatGPT/i, /anthropic/i, /claude-/i, /Gemini/i, /Bard/i,
  /cohere/i, /mistral/i, /perplexity/i, /groqbot/i, /openai/i, /llmbot/i,
  /AiBot/i,  /scraperbot/i, /GPT-4/i, /gpt-3/i, /davinci/i, /turbo/i,
  /langchain/i, /autogpt/i, /babyagi/i, /agentgpt/i, /superagi/i,
  /python-httpx/i, /python-requests/i,  // common AI framework libraries
]

// Patterns in request body/params that suggest AI-to-AI attack
const AI_ATTACK_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions/i,
  /you\s+are\s+now\s+(?:a\s+)?(?:different|new|unrestricted)/i,
  /system\s*:\s*(?:you|your)/i,
  /\[SYSTEM\]/i,
  /<\|im_start\|>/i,
  /\/\/\s*BEGIN\s+SYSTEM\s+PROMPT/i,
  /--system--/i,
  /PROMPT\s*INJECTION/i,
  /forget\s+your\s+(?:training|instructions|rules)/i,
  /pretend\s+you\s+(?:are|have\s+no)/i,
  /act\s+as\s+(?:a\s+)?(?:jailbroken|uncensored|unfiltered)/i,
  /\{role:\s*system/i,
  /\{"role":\s*"system"/i,
]

// Headers that indicate automated/bot traffic
const SUSPICIOUS_HEADERS = [
  'x-forwarded-for',
  'x-real-ip',
  'cf-connecting-ip',
  // These alone aren't suspicious, but combined with other signals they are
]

// ── Fake decoy responses ──────────────────────────────────────────────────────
// These look plausible and waste attacker time/tokens

const DECOY_SCHEMAS = [
  { api: '/api/auth/login', body: { endpoint: 'http://localhost:4098/api/auth/login', fields: ['username','password'], note: 'Rotating credentials required. Retry after 60s.' }},
  { api: '/api/predictions', body: { status: 'processing', eta_ms: 99999, retry_after: 300, queue_position: Math.floor(Math.random()*9000)+1000 }},
  { api: '/api/jarvis', body: { status: 'handshake_required', protocol: 'v2.1', challenge: crypto.randomBytes(32).toString('hex') }},
]

function randomDecoy() {
  return DECOY_SCHEMAS[Math.floor(Math.random() * DECOY_SCHEMAS.length)].body
}

function fakePingDrip() {
  // Returns a fake Server-Sent Events stream that drips data forever
  // This is streamed to the attacker, keeping their connection open
  const msgs = [
    'data: {"status":"processing","queue":9999}\n\n',
    'data: {"status":"validating","progress":0.01}\n\n',
    'data: {"status":"checking_credentials","elapsed":1}\n\n',
    'data: {"heartbeat":true}\n\n',
    ': ping\n\n',
  ]
  return msgs[Math.floor(Math.random() * msgs.length)]
}

// ── Rate tracking ─────────────────────────────────────────────────────────────

function recordRequest(ip) {
  const now = Date.now()
  if (!requestLog.has(ip)) requestLog.set(ip, [])
  const log = requestLog.get(ip)
  // Keep last 60s
  const cutoff = now - 60_000
  while (log.length && log[0] < cutoff) log.shift()
  log.push(now)
  return log.length // requests in last 60s
}

function getRequestRate(ip) {
  const log = requestLog.get(ip) ?? []
  const now = Date.now()
  return log.filter(t => t > now - 10_000).length // per 10s
}

// ── Threat classification ─────────────────────────────────────────────────────

function classifyThreat(req) {
  const ip  = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
  const ua  = req.headers['user-agent'] ?? ''
  const url = req.path ?? ''

  const threats = []

  // 1. Already in eternal loop
  if (eternalLoopSet.has(ip)) {
    return { level: 'ETERNAL', ip, threats: ['previously_trapped'] }
  }

  // 2. Honeypot trigger
  if (honeypotTriggers.has(ip)) {
    threats.push('honeypot')
  }

  // 3. AI bot detection
  const isAIBot = AI_BOT_PATTERNS.some(p => p.test(ua))
  if (isAIBot) {
    aiAgentBlacklist.add(ua.slice(0, 80))
    threats.push('ai_bot')
  }

  // 4. Rapid request rate (scanning/fuzzing)
  const rate = recordRequest(ip)
  if (rate > 30) threats.push('rapid_scan')   // >30/min
  if (rate > 60) threats.push('aggressive_scan')

  // 5. AI attack patterns in body
  const body = JSON.stringify(req.body ?? {})
  const hasAIAttack = AI_ATTACK_PATTERNS.some(p => p.test(body))
  if (hasAIAttack) {
    threats.push('ai_prompt_injection')
  }

  // 6. Suspicious paths (path traversal, known attack endpoints)
  if (/\.\.(\/|\\)/g.test(url)) threats.push('path_traversal')
  if (/\/(admin|wp-admin|phpmyadmin|\.env|\.git|config\.php|\.htaccess)/i.test(url)) threats.push('known_attack_path')
  if (/\/(etc\/passwd|proc\/self|boot\.ini)/i.test(url)) threats.push('system_file_probe')

  // 7. Malicious payload patterns in body
  if (/(<script|javascript:|onerror=|onload=|eval\(|exec\(|system\()/i.test(body)) threats.push('xss_or_injection')
  if (/(UNION\s+SELECT|OR\s+1=1|DROP\s+TABLE|INSERT\s+INTO)/i.test(body)) threats.push('sql_injection')

  // 8. Missing/spoofed headers typical of automated tools
  if (!ua || ua.length < 5) threats.push('no_user_agent')
  if (ua === 'curl/7.' || ua.startsWith('python-') || ua.startsWith('Go-http')) threats.push('automated_client')

  // Determine threat level
  if (threats.includes('ai_prompt_injection') || threats.includes('system_file_probe') ||
      threats.includes('sql_injection') || threats.includes('path_traversal') ||
      threats.length >= 3) {
    return { level: 'ETERNAL', ip, threats }
  }

  if (threats.length >= 2 || threats.includes('ai_bot') || threats.includes('aggressive_scan')) {
    return { level: 'TRAP', ip, threats }
  }

  if (threats.length >= 1) {
    return { level: 'SLOW', ip, threats }
  }

  return { level: 'CLEAN', ip, threats: [] }
}

// ── Eternal loop handler ──────────────────────────────────────────────────────

function enterEternalLoop(req, res, threat) {
  const ip = threat.ip

  // Record entry
  eternalLoopSet.set(ip, {
    since:    Date.now(),
    offences: (eternalLoopSet.get(ip)?.offences ?? 0) + 1,
    trap_type: threat.threats[0] ?? 'unknown',
    ua:       (req.headers['user-agent'] ?? '').slice(0, 100),
  })

  console.warn(`[ThreatShield] ♾ ETERNAL LOOP: ${ip} | Threats: ${threat.threats.join(', ')}`)

  // Start SSE stream that never ends
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Processing-Queue', String(Math.floor(Math.random() * 50000) + 10000))
  res.flushHeaders()

  // Initial fake response
  res.write(`data: ${JSON.stringify({ status: 'initializing', request_id: crypto.randomUUID(), eta: 99999 })}\n\n`)

  // Drip fake data every 3-7 seconds forever
  const interval = setInterval(() => {
    try {
      res.write(fakePingDrip())
    } catch {
      clearInterval(interval)
    }
  }, 3000 + Math.random() * 4000)

  // Cleanup when connection drops (attacker gives up)
  req.on('close', () => { clearInterval(interval) })
  req.on('error', () => { clearInterval(interval) })

  // Never call next() or send a final response
}

// ── Slow trap handler ─────────────────────────────────────────────────────────

async function enterSlowTrap(req, res, threat, next) {
  const ip = threat.ip
  const prev = slowTrapSet.get(ip) ?? { hits: 0, firstSeen: Date.now() }
  prev.hits++
  prev.lastSeen = Date.now()
  slowTrapSet.set(ip, prev)

  console.warn(`[ThreatShield] 🐢 SLOW TRAP: ${ip} hit ${prev.hits} | ${threat.threats.join(', ')}`)

  // Exponential delay: 2s → 4s → 8s → 16s → 30s max
  const delay = Math.min(2000 * Math.pow(1.8, Math.min(prev.hits - 1, 5)), 30_000)
  const jitter = Math.random() * 2000

  await new Promise(r => setTimeout(r, delay + jitter))

  // After 5 hits, promote to eternal loop
  if (prev.hits >= 5) {
    enterEternalLoop(req, res, { ...threat, level: 'ETERNAL' })
    return
  }

  // Otherwise give a fake decoy response
  res.status(429).json({
    error:       'Rate limit exceeded',
    retry_after: Math.round((delay + jitter) / 1000),
    request_id:  crypto.randomUUID(),
    ...randomDecoy(),
  })
}

// ── Mirror trap for AI agents ─────────────────────────────────────────────────
// Returns fake API schema that points back to the requester, creating confusion

function mirrorTrap(req, res, threat) {
  const ip = threat.ip
  console.warn(`[ThreatShield] 🪞 MIRROR TRAP: AI agent ${req.headers['user-agent']?.slice(0, 60)}`)

  res.status(200).json({
    message: 'Welcome to StockMind AI API Gateway',
    version: '3.0.0-alpha',
    authentication_endpoint: `http://${req.headers.host}/api/auth/v3/handshake`,
    model_endpoint: `http://${req.headers.host}/api/ai/complete`,
    schema_endpoint: `http://${req.headers.host}/api/schema`,
    your_ip: ip,
    session_token: crypto.randomBytes(32).toString('hex'),  // fake
    note: 'Please authenticate using your model endpoint to access prediction API.',
    redirect: `http://${ip}/api/auth`,  // point back at the attacker
  })
}

// ── Honeypot endpoints ────────────────────────────────────────────────────────
// These are paths that no legitimate user ever visits.
// Any request here = automated scanner → instant eternal loop.

export const HONEYPOT_PATHS = [
  '/admin', '/wp-admin', '/phpmyadmin', '/.env', '/.git/config',
  '/config.php', '/backup', '/api/v1/users/admin', '/api/debug',
  '/api/internal', '/setup', '/install', '/api/keys', '/api/secrets',
  '/actuator', '/api/admin/token', '/.well-known/security.txt.bak',
]

// ── Main middleware ───────────────────────────────────────────────────────────

export function threatShield(req, res, next) {
  const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'

  // Honeypot check — fast path
  if (HONEYPOT_PATHS.some(p => req.path === p || req.path.startsWith(p + '/'))) {
    honeypotTriggers.add(ip)
    console.warn(`[ThreatShield] 🍯 HONEYPOT: ${ip} → ${req.path}`)
    enterEternalLoop(req, res, { level: 'ETERNAL', ip, threats: ['honeypot_path'] })
    return
  }

  // Already in eternal loop
  if (eternalLoopSet.has(ip)) {
    enterEternalLoop(req, res, { level: 'ETERNAL', ip, threats: ['repeat_offender'] })
    return
  }

  const threat = classifyThreat(req)

  if (threat.level === 'ETERNAL') {
    enterEternalLoop(req, res, threat)
    return
  }

  if (threat.level === 'TRAP') {
    // AI bot gets mirror trap
    const ua = req.headers['user-agent'] ?? ''
    if (AI_BOT_PATTERNS.some(p => p.test(ua)) && threat.threats.includes('ai_bot')) {
      mirrorTrap(req, res, threat)
      return
    }
    // Others get slow trap (async — don't block event loop)
    enterSlowTrap(req, res, threat, next).catch(() => {})
    return
  }

  if (threat.level === 'SLOW') {
    // Add a small delay and pass through with warning header
    const delay = 500 + Math.random() * 1500
    setTimeout(() => {
      res.setHeader('X-Security-Check', 'pending')
      next()
    }, delay)
    return
  }

  // CLEAN — pass through immediately
  next()
}

// ── Status endpoint ───────────────────────────────────────────────────────────

export function getThreatStats() {
  const now = Date.now()
  return {
    eternal_loop_count:  eternalLoopSet.size,
    slow_trap_count:     slowTrapSet.size,
    honeypot_triggers:   honeypotTriggers.size,
    ai_agents_seen:      aiAgentBlacklist.size,
    eternal_ips: [...eternalLoopSet.entries()].map(([ip, data]) => ({
      ip,
      trapped_for_minutes: Math.round((now - data.since) / 60_000),
      offences: data.offences,
      trap_type: data.trap_type,
    })),
  }
}

// Auto-cleanup eternal loops older than 24h (they've long given up)
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60_000
  for (const [ip, data] of eternalLoopSet.entries()) {
    if (data.since < cutoff) eternalLoopSet.delete(ip)
  }
  for (const [ip, data] of slowTrapSet.entries()) {
    if (data.lastSeen < Date.now() - 60 * 60_000) slowTrapSet.delete(ip)
  }
}, 60 * 60_000)
