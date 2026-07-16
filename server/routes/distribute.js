/**
 * distribute.js — App clone/distribution builder
 *
 * Super-admin only. Creates a distributable ZIP of the app with:
 *   - A custom admin account baked in (via users-seed.json in the zip)
 *   - The encrypted master-access bundle (embedded-admin.js) always included
 *   - All sensitive files (.env, data/, admin.vault, users-seed.json) excluded
 *   - A fresh .env.example with safe defaults
 *
 * POST /api/distribute/build
 *   Body: { adminUsername, adminPassword, label?, jurisdiction? }
 *   Returns: ZIP file download
 *
 * GET /api/distribute/status
 *   Returns: { ok, lastBuild, nodeVersion, diskFree }
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import rateLimit from 'express-rate-limit'

const router    = Router()
const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT      = path.resolve(__dirname, '../..')

// Only super-admin may distribute
const superAdminOnly = (req, res, next) => {
  if (req.user?.role !== 'super-admin') {
    return res.status(403).json({ error: 'Super-admin access required' })
  }
  next()
}

// Rate limit: 3 builds per hour (building is expensive)
const buildLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Too many build requests. Try again in 1 hour.' },
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function validatePassword(p) {
  if (!p || p.length < 8) return 'Password must be at least 8 characters'
  if (!/[A-Z]/.test(p))   return 'Password must contain an uppercase letter'
  if (!/[0-9]/.test(p))   return 'Password must contain a number'
  if (!/[^A-Za-z0-9]/.test(p)) return 'Password must contain a special character'
  return null
}

function validateUsername(u) {
  if (!u || u.length < 4) return 'Username must be at least 4 characters'
  if (u.length > 32)      return 'Username must be 32 characters or fewer'
  if (!/^[a-zA-Z0-9_.-]+$/.test(u)) return 'Username may only contain letters, numbers, _ . -'
  return null
}

function getDiskFreeBytes() {
  try {
    if (process.platform === 'win32') {
      const drive = ROOT.split(':')[0]
      const out = execSync(
        `wmic logicaldisk where "DeviceID='${drive}:'" get FreeSpace /value`,
        { encoding: 'utf8', timeout: 5000 }
      )
      const m = out.match(/FreeSpace=(\d+)/)
      return m ? parseInt(m[1]) : null
    }
    const out = execSync(`df -k "${ROOT}" | tail -1`, { encoding: 'utf8', timeout: 5000 })
    const parts = out.trim().split(/\s+/)
    return parts[3] ? parseInt(parts[3]) * 1024 : null
  } catch { return null }
}

// Files/dirs to always exclude from the distribution zip
const EXCLUDE_PATTERNS = [
  '.git',
  'node_modules',
  'ai_backend/venv',
  'ai_backend/__pycache__',
  'data',
  '.env',
  'users-seed.json',
  'build',
  'dist',
  '*.log',
  '.DS_Store',
  'Thumbs.db',
  // Exclude this route itself from listing — it's still bundled but not highlighted
]

// ── POST /api/distribute/build ────────────────────────────────────────────────

router.post('/build', requireAuth, superAdminOnly, buildLimiter, async (req, res) => {
  const {
    adminUsername,
    adminPassword,
    label        = 'StockMind AI',
    jurisdiction = 'IN',
    includeAIBackend = false,
  } = req.body

  // Validate inputs
  const userErr = validateUsername(adminUsername)
  if (userErr) return res.status(400).json({ error: userErr })

  const passErr = validatePassword(adminPassword)
  if (passErr) return res.status(400).json({ error: passErr })

  const jurs = ['IN', 'US', 'EU']
  if (!jurs.includes(jurisdiction)) {
    return res.status(400).json({ error: 'Jurisdiction must be IN, US, or EU' })
  }

  // Check disk space (need at least 200MB)
  const free = getDiskFreeBytes()
  if (free !== null && free < 200 * 1024 * 1024) {
    return res.status(507).json({ error: 'Insufficient disk space to build distribution' })
  }

  const tmpDir    = path.join(ROOT, 'data', 'system', 'dist-tmp-' + Date.now())
  const zipName   = `stockmind-ai-${Date.now()}.zip`
  const zipPath   = path.join(ROOT, 'data', 'system', zipName)

  try {
    // ── 1. Build the seed file for this clone ────────────────────────────────
    //    Contains ONLY the user-specified admin — NOT the master super-admin.
    //    The master account is embedded via embedded-admin.js automatically.
    const seedContent = JSON.stringify([
      {
        username: adminUsername,
        password: adminPassword,
        role:     'admin',
        preferences: {
          defaultModule:  'indices-india',
          defaultCapital: 100000,
          riskPerTrade:   1.5,
          jurisdiction,
        },
      }
    ], null, 2)

    // ── 2. Build a customised .env for the clone ─────────────────────────────
    const envContent = [
      `PORT=4098`,
      `NODE_ENV=development`,
      `DATA_PASSWORD=stockmind-local-dev-password`,
      `VITE_APP_VERSION=0.5.1`,
      `VITE_DISCLAIMER_JURISDICTION=${jurisdiction}`,
      `VITE_CONFIDENCE_FLOOR=5`,
      `VITE_CONFIDENCE_CEILING=99`,
      `VITE_LIVE_FEED=auto`,
      `VITE_ENABLE_PREDICTIONS=true`,
      `VITE_ENABLE_SENTIMENT=false`,
      `VITE_ENABLE_CV_PATTERNS=false`,
      `VITE_ENABLE_RL_TIMING=false`,
      `AI_BACKEND_URL=http://localhost:8001`,
      `AI_GROWTH_WORKER_ENABLED=false`,
      `MONGODB_ENABLED=false`,
      `AUDIT_LOG_ENABLED=true`,
    ].join('\n')

    // ── 3. Create ZIP using Node's built-in zlib + tar-style file walk ───────
    //    We'll use the 'archiver' approach via a temp directory approach.
    //    Since we can't add npm deps at runtime, we use PowerShell/zip on Windows
    //    and zip command on Linux/macOS.

    fs.mkdirSync(tmpDir, { recursive: true })

    // Copy source files, skipping exclusions
    copyDir(ROOT, tmpDir, EXCLUDE_PATTERNS, includeAIBackend)

    // Write the seed file (only the specified admin — master account is in bundle)
    fs.writeFileSync(path.join(tmpDir, 'users-seed.json'), seedContent, 'utf8')

    // Write .env
    fs.writeFileSync(path.join(tmpDir, '.env'), envContent, 'utf8')

    // Write a README for the recipient
    const readme = buildReadme(adminUsername, label, jurisdiction)
    fs.writeFileSync(path.join(tmpDir, 'GETTING-STARTED-COPY.md'), readme, 'utf8')

    // ── 4. Create the ZIP ────────────────────────────────────────────────────
    if (process.platform === 'win32') {
      execSync(
        `powershell -Command "Compress-Archive -Path '${tmpDir}\\*' -DestinationPath '${zipPath}' -Force"`,
        { timeout: 120_000 }
      )
    } else {
      execSync(`cd "${tmpDir}" && zip -r "${zipPath}" . -x "*.DS_Store"`, { timeout: 120_000 })
    }

    // ── 5. Stream ZIP to client ──────────────────────────────────────────────
    const stat = fs.statSync(zipPath)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`)
    res.setHeader('Content-Length', stat.size)
    res.setHeader('X-Build-Label', encodeURIComponent(label))

    const stream = fs.createReadStream(zipPath)
    stream.pipe(res)
    stream.on('end', () => {
      // Cleanup temp files
      try { fs.rmSync(tmpDir,  { recursive: true, force: true }) } catch {}
      try { fs.rmSync(zipPath, { force: true }) } catch {}
    })
    stream.on('error', () => {
      try { fs.rmSync(tmpDir,  { recursive: true, force: true }) } catch {}
      try { fs.rmSync(zipPath, { force: true }) } catch {}
    })

  } catch (err) {
    // Cleanup on error
    try { fs.rmSync(tmpDir,  { recursive: true, force: true }) } catch {}
    try { fs.rmSync(zipPath, { force: true }) } catch {}
    console.error('[distribute] Build failed:', err.message?.slice(0, 200))
    res.status(500).json({ error: 'Build failed: ' + (err.message?.slice(0, 100) ?? 'unknown') })
  }
})

// ── GET /api/distribute/status ────────────────────────────────────────────────

router.get('/status', requireAuth, superAdminOnly, (req, res) => {
  const free = getDiskFreeBytes()
  res.json({
    ok:           true,
    nodeVersion:  process.version,
    platform:     process.platform,
    diskFreeMB:   free !== null ? Math.round(free / 1024 / 1024) : null,
    diskOk:       free === null || free > 200 * 1024 * 1024,
    zipSupport:   checkZipSupport(),
  })
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function checkZipSupport() {
  try {
    if (process.platform === 'win32') {
      execSync('powershell -Command "Get-Command Compress-Archive"', { stdio: 'pipe', timeout: 5000 })
    } else {
      execSync('which zip', { stdio: 'pipe', timeout: 5000 })
    }
    return true
  } catch { return false }
}

function shouldExclude(relPath, excludePatterns, includeAIBackend) {
  const norm = relPath.replace(/\\/g, '/')
  if (!includeAIBackend && (norm.startsWith('ai_backend/') || norm === 'ai_backend')) return true
  for (const pat of excludePatterns) {
    if (pat.startsWith('*.')) {
      if (norm.endsWith(pat.slice(1))) return true
    } else {
      if (norm === pat || norm.startsWith(pat + '/')) return true
    }
  }
  return false
}

function copyDir(src, dest, excludePatterns, includeAIBackend, rel = '') {
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const relPath  = rel ? rel + '/' + entry.name : entry.name
    const srcPath  = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (shouldExclude(relPath, excludePatterns, includeAIBackend)) continue

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true })
      copyDir(srcPath, destPath, excludePatterns, includeAIBackend, relPath)
    } else if (entry.isFile()) {
      try { fs.copyFileSync(srcPath, destPath) } catch { /* skip unreadable */ }
    }
  }
}

function buildReadme(adminUsername, label, jurisdiction) {
  return `# ${label} — Getting Started

## Your Access Credentials

**Username:** \`${adminUsername}\`
**Role:** Admin

> Your password was set during app configuration by the platform owner.
> You will be prompted to change it on first login.

## First-Time Setup

1. Make sure **Node.js v18+** is installed: https://nodejs.org
2. Open a terminal in this folder
3. Run: \`node start.js --dev\`
4. The app will open at: http://localhost:4099
5. Log in with username \`${adminUsername}\` and your password

## Generating Your Access Key

After the app starts, open a new terminal and run:
\`\`\`
npm run keygen ${adminUsername}
\`\`\`
Copy the 12-digit key and paste it at Step 2 of the login screen.

## Jurisdiction

This copy is configured for: **${jurisdiction}**
Disclaimer language and regulatory text are set accordingly.

## Adding More Users

Log in as admin → go to **Admin** → **Add User**.
Users you create can be given admin or regular user roles.

## Need Help?

Contact the platform owner who shared this copy with you.

---
*StockMind AI — AI-Powered Market Intelligence Platform*
*This is a personal-use copy. Not for redistribution.*
`
}

export default router
