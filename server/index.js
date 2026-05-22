/**
 * StockMind AI — Express backend entry point.
 * Local-only. Sessions in memory. Data AES-256-GCM encrypted on disk.
 */

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { initEncryption, existsSecure } from './storage/fileStore.js'
import { initAuditLog, auditLog, verifyAuditChain, queryAuditLog, getAuditStats } from './storage/auditLog.js'
import { DB } from './storage/dbAdapter.js'
import { createUser } from './services/authService.js'
import authRoutes          from './routes/auth.js'
import userRoutes          from './routes/users.js'
import predictionRoutes    from './routes/predictions.js'
import healthRoutes        from './routes/health.js'
import zerodhaRoutes       from './routes/zerodha.js'
import inferenceRoutes     from './routes/inference.js'
import marketRoutes        from './routes/market.js'
import strategyRoutes      from './routes/strategies.js'
import strategyScoreRoutes from './routes/strategyScore.js'
import selfOptimizerRoutes from './routes/selfOptimizer.js'
import jarvisRoutes        from './routes/jarvis.js'
import historicalRoutes    from './routes/historical.js'
import ghostRoutes         from './routes/ghost.js'
import amiRoutes           from './routes/ami.js'
import derivativesRoutes   from './routes/derivatives.js'
import multibaggerRoutes   from './routes/multibagger.js'
import imageAnalysisRoutes from './routes/imageAnalysis.js'
import { startOutcomeValidator, getValidatorStatus, addSSEClient, startCleanupScheduler } from './services/outcomeValidator.js'
import { rebuildAMIIndex } from './services/amiStore.js'
import {
  startAIGrowthWorker, stopAIGrowthWorker, pauseAIGrowthWorker, resumeAIGrowthWorker,
  getGrowthWorkerStatus, getUpgradeProposals, approveProposal, dismissProposal,
  addGrowthWorkerSSEClient,
} from './services/aiGrowthWorker.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DIST_DIR  = path.resolve(__dirname, '../dist')
const PORT = process.env.PORT ?? 4098

// ── DATA_PASSWORD ─────────────────────────────────────────────────────────────
// Set via environment variable. Default is only for first-run convenience.
// Once data is written, you MUST use the same password every time.
const DATA_PASSWORD = process.env.DATA_PASSWORD ?? 'stockmind-local-dev-password'

// Init encryption (async — Argon2id preferred)
async function initSecurity() {
  await initEncryption(DATA_PASSWORD)
  initAuditLog(DATA_PASSWORD)
  await DB.init()
}

// ── Bootstrap from users-seed.json ───────────────────────────────────────────
async function bootstrap() {
  if (existsSecure('users/index')) return // users already exist

  const seedPath = path.resolve(__dirname, '../users-seed.json')
  if (!fs.existsSync(seedPath)) {
    console.log('[bootstrap] No users-seed.json found — creating default admin...')
    await createUser({ username: 'admin', password: 'Admin@1234', role: 'admin' }, 'system')
    console.log('[bootstrap] Default admin: admin / Admin@1234')
    console.log('[bootstrap] ⚠  Edit users-seed.json to set your own credentials before next run.')
    return
  }

  let seeds
  try {
    seeds = JSON.parse(fs.readFileSync(seedPath, 'utf8'))
  } catch (e) {
    console.error('[bootstrap] Failed to parse users-seed.json:', e.message)
    return
  }

  console.log(`[bootstrap] Seeding ${seeds.length} user(s) from users-seed.json...`)
  for (const seed of seeds) {
    const result = await createUser(seed, 'seed')
    if (result.ok) {
      console.log(`[bootstrap] ✓ Created: ${seed.username} (${seed.role})`)
    } else {
      console.warn(`[bootstrap] ✗ ${seed.username}: ${result.error}`)
    }
  }
  console.log('[bootstrap] Done. Run: npm run keygen <username>')
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express()

// Helmet with proper CSP for local SPA
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "'unsafe-inline'"],  // Vite dev needs inline
      styleSrc:       ["'self'", "'unsafe-inline'"],
      imgSrc:         ["'self'", 'data:', 'blob:'],
      connectSrc:     ["'self'", 'ws://localhost:*', 'wss://localhost:*',
                       'http://localhost:8001',
                       'https://query1.finance.yahoo.com',
                       'https://stream.binance.com',
                       'https://finnhub.io'],      fontSrc:        ["'self'", 'data:'],
      objectSrc:      ["'none'"],
      frameAncestors: ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,  // needed for some market data APIs
  hsts: false,  // local-only app, no HTTPS
}))

// CORS — localhost only
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) cb(null, true)
    else cb(new Error('CORS: origin not allowed'))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-session-token'],
}))

app.use(express.json({ limit: '512kb' }))  // tighter body limit

// Remove x-powered-by (already done by helmet, but explicit)
app.disable('x-powered-by')

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Auth: very tight — 10 attempts per 15 min
app.use('/api/auth/login', rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many login attempts. Try again in 15 minutes.' },
}))

// Keygen: 5 per hour (sensitive operation)
app.use('/api/auth/keygen', rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many key generation requests.' },
}))
// General API: 300 per minute
app.use('/api', rateLimit({
  windowMs:        60 * 1000,
  max:             300,
  standardHeaders: true,
  legacyHeaders:   false,
}))

app.use('/api/auth',           authRoutes)
app.use('/api/users',          userRoutes)
app.use('/api/predictions',    predictionRoutes)
app.use('/api/health',         healthRoutes)
app.use('/api/zerodha',        zerodhaRoutes)
app.use('/api/inference',      inferenceRoutes)
app.use('/api/market',         marketRoutes)
app.use('/api/strategies',     strategyRoutes)
app.use('/api/strategy-score', strategyScoreRoutes)
app.use('/api/self-optimizer', selfOptimizerRoutes)
app.use('/api/jarvis',         jarvisRoutes)
app.use('/api/historical',     historicalRoutes)
app.use('/api/ghost',          ghostRoutes)
app.use('/api/ami',            amiRoutes)
app.use('/api/derivatives',    derivativesRoutes)
app.use('/api/multibagger',    multibaggerRoutes)
app.use('/api/image',          imageAnalysisRoutes)

// ── Audit log routes (admin only) ─────────────────────────────────────────────
app.get('/api/audit/stats',  (req, res) => res.json(getAuditStats()))
app.get('/api/audit/verify', (req, res) => res.json(verifyAuditChain()))
app.get('/api/audit/query',  (req, res) => {
  const { event, userId, limit = 100 } = req.query
  res.json(queryAuditLog({ event, userId, limit: Number(limit) }))
})

// ── DB health ─────────────────────────────────────────────────────────────────
app.get('/api/db/health', async (req, res) => res.json(await DB.healthCheck()))

// Outcome validator status
app.get('/api/validator/status', (req, res) => res.json(getValidatorStatus()))

// SSE endpoint — real-time outcome events for the frontend
// GET /api/validator/events
app.get('/api/validator/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  // Send initial heartbeat
  res.write('event: connected\ndata: {"status":"connected"}\n\n')

  // Keep-alive ping every 30s
  const ping = setInterval(() => {
    try { res.write(':ping\n\n') } catch { clearInterval(ping) }
  }, 30_000)

  addSSEClient(res)
  res.on('close', () => clearInterval(ping))
})

// ── AI Growth Worker API ──────────────────────────────────────────────────────
app.get('/api/growth-worker/status', (req, res) => res.json(getGrowthWorkerStatus()))
app.get('/api/growth-worker/proposals', (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 20), 50)
  res.json({ proposals: getUpgradeProposals(limit) })
})
app.post('/api/growth-worker/start', (req, res) => {
  startAIGrowthWorker()
  res.json({ ok: true, status: getGrowthWorkerStatus() })
})
app.post('/api/growth-worker/stop', (req, res) => {
  stopAIGrowthWorker()
  res.json({ ok: true, status: getGrowthWorkerStatus() })
})
app.post('/api/growth-worker/pause', (req, res) => {
  pauseAIGrowthWorker()
  res.json({ ok: true, status: getGrowthWorkerStatus() })
})
app.post('/api/growth-worker/resume', (req, res) => {
  resumeAIGrowthWorker()
  res.json({ ok: true, status: getGrowthWorkerStatus() })
})
app.post('/api/growth-worker/proposals/:id/approve', (req, res) => {
  const ok = approveProposal(req.params.id)
  res.json({ ok })
})
app.post('/api/growth-worker/proposals/:id/dismiss', (req, res) => {
  const ok = dismissProposal(req.params.id)
  res.json({ ok })
})
// SSE stream for growth worker events
app.get('/api/growth-worker/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  res.write('event: connected\ndata: {"status":"connected"}\n\n')
  const ping = setInterval(() => {
    try { res.write(':ping\n\n') } catch { clearInterval(ping) }
  }, 30_000)
  addGrowthWorkerSSEClient(res)
  res.on('close', () => clearInterval(ping))
})

// ── Serve built frontend (production / no-source-code mode) ──────────────────
// In dev mode Vite serves the frontend separately on :4098.
// In production (dist/ exists), Express serves everything on one port.
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  // SPA fallback — non-API routes serve index.html
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })
}

// 404 for unknown API routes only
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }))
app.use((err, _req, res, _next) => { console.error('[server]', err); res.status(500).json({ error: 'Internal server error' }) })

// Async bootstrap with security init
initSecurity()
  .then(() => bootstrap())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[StockMind AI] ⚡ Backend → http://localhost:${PORT}`)
      console.log(`[StockMind AI] 🔐 Encryption: Argon2id + AES-256-GCM + HMAC-SHA512`)
      auditLog('serverStart', { port: PORT, pid: process.pid })
      startOutcomeValidator()
      rebuildAMIIndex()
      const retentionDays = Number(process.env.CLEANUP_RETENTION_DAYS ?? 30)
      startCleanupScheduler(retentionDays, 24)
      if (process.env.AI_GROWTH_WORKER_ENABLED === 'true') startAIGrowthWorker()
    })
  })
  .catch(err => { console.error('[StockMind AI] Fatal startup:', err); process.exit(1) })
