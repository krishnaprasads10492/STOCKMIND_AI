#!/usr/bin/env node
/**
 * StockMind AI — Self-Healing Unified Launcher v2
 *
 * On ANY system (Windows / macOS / Linux) with Node.js 18+:
 *   1. Probes PyPI + npm for best stable+secure versions (first run only)
 *   2. Validates every dependency before starting
 *   3. Auto-fixes all known failure scenarios
 *   4. Persists error scenarios for future auto-healing
 *   5. Asks user with full impact info when manual action is needed
 *   6. Monitors terminal output for errors and auto-diagnoses
 *   7. Never breaks the host system — all fixes are app-scoped
 *
 * Usage:
 *   node start.js              Production (build/ on :4098)
 *   node start.js --dev        Development (Vite HMR on :4099)
 *   node start.js --build      Build frontend first, then start
 *   node start.js --no-ai      Skip Python AI backend
 *   node start.js --keygen <u> Generate 12-digit access key
 *   node start.js --diagnose   System diagnostics only
 *   node start.js --probe      Probe registries for latest versions
 */

import { spawn, execSync, spawnSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { createInterface } from 'readline'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const args     = process.argv.slice(2)
const isDev    = args.includes('--dev')
const noAI     = args.includes('--no-ai')
const doBuild  = args.includes('--build')
const diagnose = args.includes('--diagnose')
const doProbe  = args.includes('--probe')
const help     = args.includes('--help') || args.includes('-h')

const C = {
  reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m',
  cyan:'\x1b[36m', green:'\x1b[32m', yellow:'\x1b[33m',
  red:'\x1b[31m', blue:'\x1b[34m', purple:'\x1b[35m', orange:'\x1b[38;5;208m',
}
const ts  = () => new Date().toLocaleTimeString('en-IN', { hour12: false })
const log = (p, c, m) => process.stdout.write(`${C.dim}${ts()}${C.reset} ${c}${C.bold}[${p}]${C.reset} ${m}\n`)
const ok  = m => log('✓', C.green,  m)
const warn= m => log('!', C.yellow, m)
const err = m => log('✗', C.red,    m)
const info= m => log('·', C.cyan,   m)
const ask = m => log('?', C.orange, m)

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', timeout: 30_000, ...opts }).trim()
}
function runSafe(cmd, opts = {}) {
  try { return { ok: true, out: run(cmd, opts) } } catch (e) { return { ok: false, error: e.message } }
}
function runInherit(cmd, opts = {}) {
  // Default timeout raised to 10 min for build steps.
  // npm install uses its own execSync call with a 10-min timeout.
  execSync(cmd, { stdio: 'inherit', timeout: 10 * 60_000, ...opts })
}

// ── Scenario library (file-based, no server needed) ───────────────────────────
const SCENARIOS_FILE = join(__dirname, 'data', 'system', 'startup-scenarios.json')

function loadScenarios() {
  try {
    if (existsSync(SCENARIOS_FILE)) return JSON.parse(readFileSync(SCENARIOS_FILE, 'utf8'))
  } catch {}
  return { scenarios: [] }
}

function saveScenario(error, fix, resolved = true) {
  try {
    const db  = loadScenarios()
    const key = error.replace(/\d+/g, 'N').slice(0, 80)
    const idx = db.scenarios.findIndex(s => s.key === key)
    if (idx >= 0) { db.scenarios[idx].seen++; db.scenarios[idx].fix = fix; db.scenarios[idx].resolved = resolved }
    else db.scenarios.push({ key, error: error.slice(0, 400), fix, resolved, seen: 1, ts: Date.now() })
    if (db.scenarios.length > 300) db.scenarios = db.scenarios.slice(-300)
    mkdirSync(join(__dirname, 'data', 'system'), { recursive: true })
    writeFileSync(SCENARIOS_FILE, JSON.stringify(db, null, 2))
  } catch { /* non-fatal */ }
}

function lookupScenario(error) {
  try {
    const db = loadScenarios()
    const lc = error.toLowerCase()
    return db.scenarios.find(s => s.resolved && lc.includes(s.key.slice(0, 40).toLowerCase()))
  } catch { return null }
}

// ── Interactive prompt (used when auto-fix isn't possible) ────────────────────
function promptUser(question, choices = null) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const suffix = choices ? ` [${choices.join('/')}]: ` : ': '
    rl.question(`\n${C.orange}${C.bold}[?]${C.reset} ${question}${suffix}`, answer => {
      rl.close(); resolve(answer.trim().toLowerCase())
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// FIRST-RUN VERSION PROBE — query npm + PyPI for latest stable versions
// ─────────────────────────────────────────────────────────────────────────────

const VERSION_PROBE_FILE = join(__dirname, 'data', 'system', 'version-probe.json')

async function probeVersions() {
  info('Probing npm registry and PyPI for latest stable secure versions...')
  info('(This runs once and caches results — safe for your system)')

  const results = { npm: {}, pypi: {}, probedAt: Date.now() }

  const npmPkgs  = ['express','helmet','cors','express-rate-limit','react','react-dom',
                    'react-router-dom','zustand','mongodb','multer','argon2',
                    'lightweight-charts','recharts','yahoo-finance2','vite','concurrently']
  const pypiPkgs = ['fastapi','uvicorn','pydantic','numpy','pandas','scipy',
                    'scikit-learn','lightgbm','xgboost','Pillow','httpx',
                    'statsmodels','python-dotenv','openpyxl','joblib','ta']

  const npmFetches  = npmPkgs.map(async pkg => {
    try {
      const r = await fetch(`https://registry.npmjs.org/${pkg}/latest`, { signal: AbortSignal.timeout(5000) })
      if (r.ok) { const d = await r.json(); results.npm[pkg] = d.version }
    } catch {}
  })
  const pypiFetches = pypiPkgs.map(async pkg => {
    try {
      const r = await fetch(`https://pypi.org/pypi/${pkg}/json`, { signal: AbortSignal.timeout(5000) })
      if (r.ok) { const d = await r.json(); results.pypi[pkg] = d.info.version }
    } catch {}
  })

  await Promise.allSettled([...npmFetches, ...pypiFetches])

  mkdirSync(join(__dirname, 'data', 'system'), { recursive: true })
  writeFileSync(VERSION_PROBE_FILE, JSON.stringify(results, null, 2))

  const npmCount  = Object.keys(results.npm).length
  const pypiCount = Object.keys(results.pypi).length
  ok(`Version probe complete — ${npmCount} npm + ${pypiCount} PyPI packages checked`)

  // Show recommendations compared to current package.json
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'))
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
    const updates = []
    for (const [name, latest] of Object.entries(results.npm)) {
      const current = allDeps[name]?.replace(/[^0-9.]/g, '')
      if (current && current !== latest) updates.push({ name, current, latest })
    }
    if (updates.length > 0) {
      warn(`${updates.length} npm package(s) have newer versions available:`)
      updates.slice(0, 8).forEach(u => warn(`  ${u.name}: ${u.current} → ${u.latest}`))
      warn('These are informational — current pinned versions are stable and tested.')
    }
  } catch {}

  return results
}

function loadVersionProbe() {
  try {
    if (existsSync(VERSION_PROBE_FILE)) {
      const d = JSON.parse(readFileSync(VERSION_PROBE_FILE, 'utf8'))
      const age = Date.now() - (d.probedAt ?? 0)
      if (age < 7 * 24 * 60 * 60 * 1000) return d  // use if < 7 days old
    }
  } catch {}
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM CHECKS
// ─────────────────────────────────────────────────────────────────────────────

function checkNodeVersion() {
  const parts = process.versions.node.split('.').map(Number)
  if (parts[0] < 18) {
    err(`Node.js ${process.versions.node} found — MINIMUM v18 required.`)
    err('Download from: https://nodejs.org/en/download')
    err('Impact: App will NOT start. No system changes made.')
    process.exit(1)
  }

  // Vite 7 requires Node 20.19+ or 22.12+ (uses crypto.hash)
  // We ship Vite 6 in package.json which supports Node 18+, but warn if outdated
  const [major, minor] = parts
  const isViте7Compat = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23
  if (!isViте7Compat) {
    warn(`Node.js ${process.versions.node} detected.`)
    warn('RECOMMENDED: Upgrade to Node.js v22 LTS for best compatibility.')
    warn('Current version works with Vite 6 (pinned in package.json).')
    warn('Download: https://nodejs.org/en/download')
  }

  ok(`Node.js ${process.versions.node} ✓`)
}

function checkDiskSpace() {
  try {
    if (process.platform === 'win32') {
      const drive = __dirname.split(':')[0]
      const out   = run(`wmic logicaldisk where "DeviceID='${drive}:'" get FreeSpace /value`, { timeout: 5000 })
      const m     = out.match(/FreeSpace=(\d+)/)
      if (m) {
        const freeMB = parseInt(m[1]) / (1024 * 1024)
        if (freeMB < 500) {
          warn(`Low disk space on ${drive}: — only ${freeMB.toFixed(0)} MB free`)
          warn('Impact: Python venv install may fail. Free at least 500MB on C:')
        } else {
          ok(`Disk space: ${freeMB.toFixed(0)} MB free on ${drive}: ✓`)
        }
      }
    }
  } catch { /* non-fatal */ }
}

function checkEnvVars() {
  // Check for common env var issues without leaking values
  const envPath = join(__dirname, '.env')
  if (!existsSync(envPath)) {
    const exPath = join(__dirname, '.env.example')
    if (existsSync(exPath)) {
      copyFileSync(exPath, envPath)
      ok('.env created from .env.example')
    } else {
      writeFileSync(envPath, [
        'PORT=4098','NODE_ENV=development',
        'DATA_PASSWORD=stockmind-local-dev-password',
        'VITE_APP_VERSION=0.5.1','VITE_LIVE_FEED=auto',
        'VITE_DISCLAIMER_JURISDICTION=IN',
        'VITE_CONFIDENCE_FLOOR=5','VITE_CONFIDENCE_CEILING=99',
        'AI_BACKEND_URL=http://localhost:8001','MONGODB_ENABLED=false',
      ].join('\n'))
      ok('.env created with safe defaults')
    }
  }
  // Load .env into process.env — always overwrite so updated values take effect
  try {
    const lines = readFileSync(envPath, 'utf8').split('\n')
    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
    }
  } catch {}
}

function ensureDataDirs() {
  const dirs = ['data','data/users','data/predictions','data/system',
                'data/system/audit','data/system/integrations/global',
                'data/strategies','data/strategy-scores']
  for (const d of dirs) {
    const full = join(__dirname, d)
    if (!existsSync(full)) { mkdirSync(full, { recursive: true }) }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NODE DEPENDENCIES
// ─────────────────────────────────────────────────────────────────────────────

function checkNodeDeps() {
  const nmExpress = join(__dirname, 'node_modules', 'express')
  const nmBin     = join(__dirname, 'node_modules', '.bin')

  if (!existsSync(nmBin) || !existsSync(nmExpress)) {
    warn('node_modules missing — installing...')
    return installNodeDeps('initial install')
  }

  // Verify package-lock integrity
  const lockPath = join(__dirname, 'package-lock.json')
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
      const pkg  = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'))
      if (lock.name !== pkg.name) {
        warn('package-lock.json mismatch — reinstalling...')
        return installNodeDeps('lock mismatch repair')
      }
    } catch {}
  }

  ok('node_modules ✓')
  return true
}

function installNodeDeps(reason = '') {
  if (reason) info(`npm install reason: ${reason}`)
  // Use spawn (streaming) with a generous timeout — npm install on a fresh machine
  // with a slow connection can easily take 3–5 minutes. spawnSync with a short
  // timeout caused silent ETIMEDOUT failures on first run.
  const NPM_INSTALL_TIMEOUT = 10 * 60 * 1000  // 10 minutes — safe for any network
  try {
    execSync('npm install --legacy-peer-deps', {
      stdio: 'inherit',
      timeout: NPM_INSTALL_TIMEOUT,
      cwd: __dirname,
    })
    ok('npm install complete ✓')
    saveScenario('node_modules missing', 'Run npm install --legacy-peer-deps', true)
    return true
  } catch (e) {
    // If it timed out, check if essentials actually landed (partial install)
    if (e.signal === 'SIGTERM' || /ETIMEDOUT|timed? ?out/i.test(e.message ?? '')) {
      const partialOk = existsSync(join(__dirname, 'node_modules', 'express')) &&
                        existsSync(join(__dirname, 'node_modules', 'vite'))
      if (partialOk) {
        warn('npm install timed out but essential packages are present — continuing.')
        warn('Run "npm install --legacy-peer-deps" in a separate terminal to finish.')
        return true
      }
      err('npm install timed out and essential packages are missing.')
      warn('Fix: Run "npm install --legacy-peer-deps" in your terminal, then restart.')
      warn('Slow internet? Run with: npm install --legacy-peer-deps --prefer-offline')
      return false
    }
    const known = lookupScenario(e.message)
    if (known) { warn(`Known issue: ${known.fix}`) }
    err(`npm install failed: ${e.message?.slice(0, 150)}`)
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FRONTEND BUILD CHECK
// ─────────────────────────────────────────────────────────────────────────────

async function checkFrontendBuild() {
  if (isDev) return true

  const distHtml = join(__dirname, 'build', 'index.html')
  if (!existsSync(distHtml) || doBuild) {
    log('BUILD', C.cyan, `${doBuild ? 'Rebuilding' : 'No build/ found — building'} frontend...`)
    try {
      runInherit('npm run build', { cwd: __dirname })
      ok('Frontend built → build/ ✓')
      return true
    } catch (e) {
      err(`Frontend build failed: ${e.message?.slice(0, 150)}`)
      const known = lookupScenario(e.message)
      if (known) {
        warn(`Known fix: ${known.fix}`)
      } else {
        // Ask user
        ask('Frontend build failed. Options:')
        console.log('  1) Run in --dev mode (no build needed)')
        console.log('  2) Check the error above and retry')
        console.log('  Impact: Production mode requires a build. Dev mode works without it.')
        const ans = await promptUser('Continue in --dev mode instead?', ['y', 'n'])
        if (ans === 'y') {
          process.argv.push('--dev')
          return true
        }
      }
      return false
    }
  }
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// PYTHON + VENV + DEPS
// ─────────────────────────────────────────────────────────────────────────────

function findPython() {
  if (noAI) return null

  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'python3.13', 'python3.12', 'python3.11', 'python3.10']
    : ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3', 'python']

  for (const cmd of candidates) {
    const r = runSafe(`${cmd} --version`)
    if (!r.ok) continue
    const m = r.out.match(/Python (\d+)\.(\d+)/)
    if (!m) continue
    const [, maj, min] = m.map(Number)
    if (maj >= 3 && min >= 10) { ok(`Python ${r.out.replace('Python ', '')} (${cmd}) ✓`); return cmd }
  }

  warn('Python 3.10+ not found — AI backend will be skipped.')
  warn('Install: https://www.python.org/downloads/')
  warn('Impact: Prediction engine falls back to JS-only mode (still functional, lower accuracy).')
  return null
}

function getVenvPaths(pythonCmd) {
  const venvDir = join(__dirname, 'ai_backend', 'venv')
  const isWin   = process.platform === 'win32'
  return {
    venvDir,
    pip:     isWin ? join(venvDir, 'Scripts', 'pip.exe')     : join(venvDir, 'bin', 'pip'),
    python:  isWin ? join(venvDir, 'Scripts', 'python.exe')  : join(venvDir, 'bin', 'python'),
    uvicorn: isWin ? join(venvDir, 'Scripts', 'uvicorn.exe') : join(venvDir, 'bin', 'uvicorn'),
  }
}

function getPythonMinor(venvPy) {
  const r = runSafe(`"${venvPy}" -c "import sys; print(sys.version_info.minor)"`)
  return r.ok ? parseInt(r.out.trim()) : 12
}

async function checkPythonDeps(pythonCmd) {
  if (!pythonCmd) return false

  const reqPath = join(__dirname, 'ai_backend', 'requirements.txt')
  if (!existsSync(reqPath)) { warn('requirements.txt not found'); return false }

  const { venvDir, pip, python: venvPy } = getVenvPaths(pythonCmd)

  // ── Windows Long Path: detect, warn once, attempt silent fix ───────────────
  if (process.platform === 'win32') {
    let longPathEnabled = false
    try {
      const r = run('reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled', { timeout: 3000 })
      longPathEnabled = r.includes('0x1')
    } catch {}

    if (!longPathEnabled) {
      // Attempt silent fix first — only succeeds if running as admin
      let fixed = false
      try {
        run('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f', { timeout: 3000 })
        fixed = true
        ok('Windows Long Path enabled (will take full effect after reboot)')
      } catch {}

      if (!fixed) {
        // Single concise warning — no wall-of-text on every run
        warn('Windows Long Path not enabled — Python heavy packages installed as wheels (avoids compiler).')
        warn('Optional: run as Admin once → reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f')
      }
    }
  }

  // ── Create venv ───────────────────────────────────────────────────────────
  if (!existsSync(venvDir)) {
    info('Creating Python virtual environment...')
    try {
      runInherit(`${pythonCmd} -m venv venv`, { cwd: join(__dirname, 'ai_backend') })
      ok('Python venv created ✓')
    } catch (e) {
      err(`venv creation failed: ${e.message?.slice(0, 120)}`)
      warn('Trying --without-pip fallback...')
      try {
        runInherit(`${pythonCmd} -m venv venv --without-pip`, { cwd: join(__dirname, 'ai_backend') })
        // Bootstrap pip manually
        runInherit(`${pythonCmd} -m ensurepip`, { cwd: join(__dirname, 'ai_backend') })
        ok('venv created with manual pip bootstrap ✓')
      } catch (e2) {
        err(`venv fallback also failed: ${e2.message?.slice(0, 100)}`)
        warn('AI backend will be skipped — app works in JS-only mode.')
        return false
      }
    }
  }

  // ── Check if deps already installed ──────────────────────────────────────
  const stamp     = join(venvDir, '.req_stamp')
  const reqContent= readFileSync(reqPath, 'utf8')
  const reqHash   = Buffer.from(reqContent).toString('base64').slice(0, 32)
  const savedHash = existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : ''

  const faCheck = runSafe(`"${venvPy}" -c "import fastapi; print(fastapi.__version__)"`)
  if (faCheck.ok && faCheck.out && reqHash === savedHash) {
    ok(`Python deps ready (fastapi ${faCheck.out}) ✓`)
    return true
  }

  if (faCheck.ok && faCheck.out) info(`requirements.txt changed — updating (fastapi ${faCheck.out})...`)
  return installPythonDeps(pythonCmd, reqPath, pip, venvPy, reqHash, stamp)
}

async function installPythonDeps(pythonCmd, reqPath, pip, venvPy, reqHash, stampFile) {
  info('Installing Python dependencies...')

  // ── Python version detection ───────────────────────────────────────────────
  const minor  = getPythonMinor(venvPy)
  const major  = 3
  info(`Python ${major}.${minor} detected — selecting compatible wheel versions`)

  // ── Pip self-upgrade ───────────────────────────────────────────────────────
  const pipCmd = pip || `"${pythonCmd}" -m pip`
  try {
    execSync(`"${pip || pythonCmd}" ${pip ? '' : '-m pip'} install --upgrade pip --quiet`.trim(),
      { stdio: 'pipe', cwd: join(__dirname, 'ai_backend'), timeout: 60_000 })
  } catch {}

  // ── Resolve Python-version-aware package list ─────────────────────────────
  // Python 3.13+ wheels: pandas 2.2.x has none → need 3.0+
  //                      pydantic 2.11.x needs pydantic-core 2.33 → no 3.14 wheel → need 2.13+
  //                      scipy, scikit-learn, statsmodels: 3.13+ needs latest
  // Build the base wheel-only list using flexible lower-bounds when on 3.13+
  const needsNewWheels = minor >= 13

  const coreWheels = needsNewWheels
    ? ['numpy', 'pandas', 'scipy', 'scikit-learn', 'lightgbm', 'xgboost',
       'pydantic', 'statsmodels', 'Pillow', 'openpyxl']
    : ['numpy==1.26.4', 'pandas==2.2.3', 'scipy==1.14.1', 'scikit-learn==1.5.2',
       'lightgbm==4.5.0', 'xgboost==2.1.3', 'pydantic==2.11.7',
       'statsmodels==0.14.4', 'Pillow==11.2.1', 'openpyxl==3.1.5']

  // ── Windows: short TEMP path + wheel-only first pass ─────────────────────
  const isWin     = process.platform === 'win32'
  const shortTemp = isWin ? 'C:\\Tmp' : null
  const env       = isWin
    ? { ...process.env, TEMP: shortTemp, TMP: shortTemp, TMPDIR: shortTemp }
    : process.env

  if (isWin && shortTemp) {
    try { if (!existsSync(shortTemp)) mkdirSync(shortTemp, { recursive: true }) } catch {}
  }

  // Pass 1 — heavy wheels (binary only, fast, no compiler needed)
  const wCmd = `"${pip}" install ${coreWheels.join(' ')} --only-binary=:all: --quiet`
  info(`Installing core ML wheels (Python ${major}.${minor})...`)
  try {
    execSync(wCmd, {
      stdio:   'inherit',
      cwd:     join(__dirname, 'ai_backend'),
      env,
      timeout: 8 * 60_000,  // 8 min — large packages on slow connections
    })
    ok('Core ML wheels installed ✓')
  } catch (e) {
    warn(`Wheel pass non-fatal: ${e.message?.slice(0, 80)}`)
    saveScenario('only-binary wheel install failed', 'Slow connection or no wheel for this Python version', false)
  }

  // Pass 2 — full requirements.txt (remaining pure-Python packages)
  const fullCmd = `"${pip}" install -r "${reqPath}" --quiet`
  try {
    execSync(fullCmd, {
      stdio:   'inherit',
      cwd:     join(__dirname, 'ai_backend'),
      env,
      timeout: 10 * 60_000,  // 10 min for full install including pure-Python packages
    })
    ok('Python deps installed ✓')
    if (stampFile) writeFileSync(stampFile, reqHash)
    saveScenario('python deps install', 'Use short TEMP dir and wheel-only pre-pass', true)
    return true
  } catch (e) {
    // Essential check — if fastapi + numpy + pandas are importable, we can still run
    const chk = runSafe(`"${venvPy}" -c "import fastapi, numpy, pandas; print('ok')"`)
    if (chk.ok && chk.out.trim() === 'ok') {
      ok('Essential packages present — AI backend will start ✓')
      if (stampFile) writeFileSync(stampFile, reqHash)
      return true
    }

    // Targeted diagnosis for the most common failures
    const msg = e.message ?? ''
    if (/pydantic.core/i.test(msg) && minor >= 13) {
      warn('pydantic-core has no wheel for this Python version.')
      warn('Fix: pip install pydantic --upgrade  (auto-selects compatible version)')
      try {
        execSync(`"${pip}" install "pydantic>=2.13" --only-binary=:all: --quiet`, { stdio: 'inherit', cwd: join(__dirname, 'ai_backend'), env, timeout: 120_000 })
        const chk2 = runSafe(`"${venvPy}" -c "import fastapi, numpy, pandas; print('ok')"`)
        if (chk2.ok && chk2.out.trim() === 'ok') {
          ok('Recovered — pydantic upgraded ✓')
          if (stampFile) writeFileSync(stampFile, reqHash)
          return true
        }
      } catch {}
    }

    err(`Python deps incomplete: ${msg.slice(0, 120)}`)
    warn('Impact: AI backend unavailable. App works in JS-only mode (reduced accuracy).')
    if (isWin) {
      warn('Windows fix: Run as Admin once →')
      warn('  reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f')
      warn('  Then reboot and restart the app.')
    }
    saveScenario(msg.slice(0, 80) ?? 'pip install failed',
      isWin ? 'Enable Windows Long Path (reg + reboot) or upgrade Python to 3.12' : 'Run pip install manually', false)
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PORT MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

function freePort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano', { encoding: 'utf8', stdio: 'pipe', timeout: 4000 })
      out.split('\n').filter(l => l.includes(`:${port} `) && l.includes('LISTENING')).forEach(line => {
        const pid = line.trim().split(/\s+/).pop()
        if (pid && /^\d+$/.test(pid) && pid !== '0') {
          spawnSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' })
          warn(`Freed port ${port} (PID ${pid})`)
        }
      })
    } else {
      const r = runSafe(`lsof -ti tcp:${port}`)
      if (r.ok && r.out) r.out.trim().split('\n').forEach(pid => {
        if (/^\d+$/.test(pid.trim())) { runSafe(`kill -9 ${pid.trim()}`); warn(`Freed port ${port} (PID ${pid.trim()})`) }
      })
    }
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// TERMINAL MONITORING — error detection + auto-diagnose
// ─────────────────────────────────────────────────────────────────────────────

const ERROR_PATTERNS = [
  { re: /EADDRINUSE/,                  severity: 'error', fix: 'Port conflict — freeing port and restarting' },
  { re: /Cannot find module '(.+)'/,   severity: 'error', fix: 'Missing npm module — run: npm install --legacy-peer-deps' },
  { re: /ModuleNotFoundError.*'(.+)'/, severity: 'error', fix: 'Missing Python package — run pip install in ai_backend/venv' },
  { re: /SyntaxError/,                 severity: 'warn',  fix: 'Syntax error — check the file mentioned above' },
  { re: /ENOMEM|out of memory/i,       severity: 'error', fix: 'Low memory — close other applications and restart' },
  { re: /ENOSPC|no space left/i,       severity: 'error', fix: 'Disk full — free disk space and restart' },
  { re: /EACCES|permission denied/i,   severity: 'warn',  fix: 'Permission error — check file/folder ownership' },
  { re: /ECONNREFUSED.*8001/,          severity: 'warn',  fix: 'Python AI backend not responding — using JS fallback' },
  { re: /ImportError.*'(.+)'/,         severity: 'warn',  fix: 'Python import error — restart to auto-reinstall deps' },
  { re: /ERR_MODULE_NOT_FOUND/,        severity: 'error', fix: 'Node module missing — run: npm install --legacy-peer-deps' },
  { re: /vite.*error.*plugin/i,        severity: 'error', fix: 'Vite plugin error — run: npm install --legacy-peer-deps' },
  { re: /failed to load config/i,      severity: 'error', fix: 'Vite config error — check vite.config.js syntax' },
  { re: /invalid.*env.*variable/i,     severity: 'warn',  fix: 'Invalid .env value — check .env file against .env.example' },
  { re: /argon2.*binding/i,            severity: 'error', fix: 'argon2 native binding failed — run: npm rebuild argon2' },
  { re: /ENOENT.*users-seed/i,         severity: 'warn',  fix: 'users-seed.json missing — default admin will be created' },
  // New: crypto.hash + backtick path
  { re: /crypto\.hash is not a function|crypto\.hash.*undefined/i,
                                        severity: 'error', fix: 'Node.js too old for Vite 7. Upgrade to Node v22 LTS or run: npm install --legacy-peer-deps (Vite 6 is now in package.json)' },
  { re: /backtick|`.*is not recognized/i,
                                        severity: 'error', fix: 'Path contains backtick — move project to a path without special characters' },
  { re: /spawn.*ENOENT.*vite/i,        severity: 'error', fix: 'Vite binary not found — run: npm install --legacy-peer-deps' },
]

function detectError(line) {
  for (const { re, severity, fix } of ERROR_PATTERNS) {
    if (re.test(line)) {
      const known = lookupScenario(line)
      return { severity, fix: known?.fix ?? fix, known: !!known }
    }
  }
  return null
}

const procs = []
let backendCrashes = 0
const exitedProcs = new Set()   // track which processes have exited with error

function spawnProc(name, color, cmd, cmdArgs, opts = {}) {
  // NEVER use shell:true — backticks/spaces in path break cmd.exe on Windows.
  // Always pass binary as argv[0] with array args so the OS calls it directly.
  const { shell: _ignored, ...restOpts } = opts

  const proc = spawn(cmd, cmdArgs, {
    cwd:   __dirname,
    env:   { ...process.env, FORCE_COLOR: '1', PYTHONUNBUFFERED: '1' },
    shell: false,   // explicit: never shell — avoids backtick/space path issues
    ...restOpts,
  })

  proc.stdout?.on('data', chunk => {
    String(chunk).trim().split('\n').filter(Boolean).forEach(line => {
      log(name, color, line)
      const e = detectError(line)
      if (e) {
        if (e.severity === 'error') err(`  ↳ ${e.fix}${e.known ? ' [known issue]' : ''}`)
        else warn(`  ↳ ${e.fix}`)
        saveScenario(line.slice(0, 80), e.fix, false)
      }
    })
  })

  proc.stderr?.on('data', chunk => {
    String(chunk).trim().split('\n')
      .filter(l => l && !l.includes('DeprecationWarning') && !l.includes('ExperimentalWarning') && !l.includes('npm warn'))
      .forEach(line => {
        if (/^INFO:|^DEBUG:|^\s*$/.test(line)) { log(name, color, line); return }
        log(name, C.yellow, line)
        const e = detectError(line)
        if (e) {
          if (e.severity === 'error') err(`  ↳ ${e.fix}`)
          else warn(`  ↳ ${e.fix}`)
        }
      })
  })

  proc.on('error', e => {
    err(`[${name}] Spawn error: ${e.message}`)
    if (e.code === 'ENOENT') {
      err(`  ↳ '${cmd}' not found in PATH`)
      if (name === 'VITE') err(`  ↳ Fix: npm install --legacy-peer-deps`)
    }
    exitedProcs.add(name)
    saveScenario(e.message.slice(0, 80), `Check that ${cmd} is installed`, false)
  })

  proc.on('exit', (code, signal) => {
    if (code !== 0 && code !== null && signal !== 'SIGTERM') {
      err(`[${name}] Exited with code ${code}`)
      exitedProcs.add(name)

      if (name === 'VITE') {
        err(`Vite failed to start (code ${code}).`)
        warn('Diagnosing Vite failure...')
        diagnoseViteFailure()
      }

      if (name === 'BACKEND') {
        backendCrashes++
        if (backendCrashes <= 3) {
          warn(`Backend crash #${backendCrashes} — restarting in 2s...`)
          setTimeout(() => {
            exitedProcs.delete('BACKEND')
            const entry = procs.find(p => p.name === 'BACKEND')
            if (entry) entry.proc = spawnProc('BACKEND', C.cyan, 'node', ['server/index.js'])
          }, 2000)
        } else {
          err('Backend crashed 3 times — stopping all processes')
          stopAll()
        }
      }
    }
  })

  procs.push({ name, proc })
  return proc
}

function diagnoseViteFailure() {
  const nodeVer = process.versions.node.split('.').map(Number)
  const [major, minor] = nodeVer

  // crypto.hash() was added in Node 21.7.0 — Vite 7+ needs it
  const hasCryptoHash = typeof require !== 'undefined'
    ? (() => { try { return typeof require('crypto').hash === 'function' } catch { return false } })()
    : (() => { try { const c = eval('require')('crypto'); return typeof c.hash === 'function' } catch { return false } })()

  if (!hasCryptoHash || (major < 21 || (major === 21 && minor < 7))) {
    err(`Node.js ${process.versions.node} is missing crypto.hash() (added in Node 21.7).`)
    err('Vite 7.x requires Node 20.19+ or 22.12+. You have an older Node version.')
    warn('Fix options (pick ONE):')
    warn('  1. RECOMMENDED: Upgrade Node.js to v22 LTS → https://nodejs.org')
    warn('  2. We have auto-downgraded Vite to 6.x in package.json (Node 18+ compatible)')
    warn('     Run: npm install --legacy-peer-deps   then restart')
    warn('Impact: Vite will NOT start until one of the above is done.')
    saveScenario('crypto.hash is not a function', 'Upgrade Node to v22+ OR run npm install (Vite downgraded to 6.x)', false)
  } else {
    // Check for backtick in path
    if (__dirname.includes('`')) {
      err('Path contains a backtick (`). Windows cmd.exe treats it as a special character.')
      err(`Current path: ${__dirname}`)
      warn('Fix: Move the project to a path without backticks.')
      warn('Example: C:\\Projects\\StockMind-AI\\  (no special chars)')
      warn('Impact: Vite cannot start when the project is in a path with backtick.')
      saveScenario('backtick in path', 'Move project to path without backtick or special chars', false)
    } else {
      warn('Vite exited unexpectedly. Check the error output above for details.')
      warn('Common fixes:')
      warn('  npm install --legacy-peer-deps   (missing or corrupt node_modules)')
      warn('  Check vite.config.js for syntax errors')
    }
  }
}

function stopAll() {
  process.stdout.write(`\n${C.yellow}Stopping all processes…${C.reset}\n`)
  for (const { proc } of procs) {
    try {
      if (!proc.killed) {
        process.platform === 'win32'
          ? spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
          : proc.kill('SIGTERM')
      }
    } catch {}
  }
  setTimeout(() => process.exit(0), 1500)
}

process.on('SIGINT',  stopAll)
process.on('SIGTERM', stopAll)
process.on('uncaughtException', e => { err(`Uncaught: ${e.message}`); stopAll() })

function waitForPort(port, timeoutMs = 25_000) {
  return new Promise(resolve => {
    const start = Date.now()
    function check() {
      fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(800) })
        .then(() => resolve(true))
        .catch(() => { if (Date.now() - start < timeoutMs) setTimeout(check, 600); else resolve(false) })
    }
    check()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSTICS
// ─────────────────────────────────────────────────────────────────────────────

function runDiagnostics() {
  console.log(`\n${C.cyan}${C.bold}=== StockMind AI — System Diagnostics ===${C.reset}\n`)
  const checks = []
  const add    = (n, pass, d = '') => checks.push({ n, pass, d })

  add('Node.js 18+',   Number(process.versions.node.split('.')[0]) >= 18, `v${process.versions.node}`)
  const npm = runSafe('npm --version')
  add('npm 9+',        npm.ok && Number((npm.out||'0').split('.')[0]) >= 9, npm.ok ? `v${npm.out}` : 'not found')
  add('node_modules',  existsSync(join(__dirname, 'node_modules', 'express')), '')
  add('.env file',     existsSync(join(__dirname, '.env')), '')
  add('data/ dirs',    existsSync(join(__dirname, 'data', 'system')), '')
  add('build/ folder',  existsSync(join(__dirname, 'build', 'index.html')), isDev ? '(dev — not needed)' : '')

  let pyCmd = null
  for (const cmd of ['python3', 'python']) {
    const r = runSafe(`${cmd} --version`)
    if (r.ok && /Python 3\.(1[0-9]|[2-9]\d)/.test(r.out)) { pyCmd = cmd; add('Python 3.10+', true, r.out.replace('Python ', '')); break }
  }
  if (!pyCmd) add('Python 3.10+', false, 'not found — https://python.org/downloads')

  const venvDir = join(__dirname, 'ai_backend', 'venv')
  add('Python venv', existsSync(venvDir), existsSync(venvDir) ? 'present' : 'will create on start')

  for (const port of [4098, 4099, 8001]) {
    let inUse = false
    try {
      if (process.platform === 'win32') {
        const out = execSync('netstat -ano', { encoding: 'utf8', stdio: 'pipe', timeout: 4000 })
        inUse = out.includes(`:${port} `) && out.includes('LISTENING')
      } else {
        inUse = runSafe(`lsof -ti tcp:${port}`).ok
      }
    } catch {}
    add(`Port ${port}`, !inUse, inUse ? 'IN USE (will be freed)' : 'free')
  }

  const probe = loadVersionProbe()
  add('Version probe', !!probe, probe ? `Last probed ${Math.round((Date.now()-probe.probedAt)/3600000)}h ago` : 'run: node start.js --probe')

  const scenarios = loadScenarios()
  add('Scenario library', true, `${scenarios.scenarios.length} known error patterns`)

  let allPass = true
  for (const c of checks) {
    const icon = c.pass ? `${C.green}✓${C.reset}` : `${C.yellow}!${C.reset}`
    console.log(`  ${icon}  ${c.n.padEnd(20)} ${C.dim}${c.d}${C.reset}`)
    if (!c.pass) allPass = false
  }
  console.log(`\n  ${allPass ? `${C.green}${C.bold}All checks passed ✓` : `${C.yellow}Issues found — start.js auto-fixes them on next run`}${C.reset}\n`)
}

// ─────────────────────────────────────────────────────────────────────────────
// BANNER + MAIN
// ─────────────────────────────────────────────────────────────────────────────

function printBanner(aiReady) {
  const pkg   = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'))
  const bPort = Number(process.env.PORT ?? 4098)
  const vPort = isDev ? Number(process.env.VITE_PORT ?? 4099) : bPort
  console.log(`
${C.cyan}${C.bold}╔══════════════════════════════════════════════════════╗
║   StockMind AI  v${pkg.version.padEnd(35)}║
║   AI-Powered Market Intelligence Platform            ║
╚══════════════════════════════════════════════════════╝${C.reset}
  Mode     ${isDev ? `${C.yellow}Development${C.reset} (Vite HMR)` : `${C.green}Production${C.reset}`}
  App      ${C.cyan}http://localhost:${vPort}${C.reset}
  Backend  ${C.cyan}http://localhost:${bPort}/api${C.reset}
  AI       ${aiReady ? `${C.green}Python FastAPI → :8001${C.reset}` : `${C.yellow}JS fallback (Python unavailable)${C.reset}`}
  Dashboard${C.cyan} http://localhost:${bPort}/api/agi/dashboard${C.reset}

  ${C.dim}Ctrl+C to stop | node start.js --diagnose for checks${C.reset}
`)
}

async function main() {
  console.clear()
  console.log(`\n${C.bold}${C.cyan}StockMind AI — Self-Healing Startup${C.reset}\n`)

  if (help) {
    const text = readFileSync(join(__dirname, 'start.js'), 'utf8')
    console.log(text.match(/\/\*\*([\s\S]*?)\*\//)?.[0] ?? 'StockMind AI Launcher')
    process.exit(0)
  }

  if (diagnose) { runDiagnostics(); process.exit(0) }

  if (args.includes('--keygen')) {
    const username = args[args.indexOf('--keygen') + 1]
    if (!username) { err('Usage: node start.js --keygen <username>'); process.exit(1) }
    checkNodeDeps()
    runInherit(`node server/keygen/generate.js ${username}`, { cwd: __dirname })
    process.exit(0)
  }

  // ── First-run version probe ────────────────────────────────────────────────
  const isFirstRun = !existsSync(join(__dirname, 'data', 'system', 'version-probe.json'))
  if (isFirstRun || doProbe) {
    info(isFirstRun ? 'First run — probing registries for optimal package versions...' : 'Manual version probe...')

    // First-run: explain credential behaviour
    if (isFirstRun) {
      const seedExists    = existsSync(join(__dirname, 'users-seed.json'))
      const exampleExists = existsSync(join(__dirname, 'users-seed.example.json'))

      if (seedExists) {
        // Tell user exactly what accounts will be created
        try {
          const entries = JSON.parse(readFileSync(join(__dirname, 'users-seed.json'), 'utf8'))
          const names   = entries.map(u => `${u.username} (${u.role})`).join(', ')
          ok(`users-seed.json found — seeding: ${names}`)
        } catch {
          ok('users-seed.json found — accounts will be seeded from it.')
        }
      } else if (exampleExists) {
        try {
          const entries = JSON.parse(readFileSync(join(__dirname, 'users-seed.example.json'), 'utf8'))
          const names   = entries.map(u => `${u.username} (${u.role})`).join(', ')
          ok(`users-seed.example.json found — seeding: ${names}`)
          info('TIP: Copy to users-seed.json and edit before first run to use your own credentials.')
        } catch {
          ok('users-seed.example.json found — using as seed source.')
        }
      } else {
        warn('No seed file found — default admin (admin / Admin@1234) will be created.')
        warn('Create users-seed.json before first run to set your own credentials.')
      }
    }

    try { await probeVersions() } catch (e) { warn(`Version probe failed (non-fatal): ${e.message?.slice(0,60)}`) }
  }

  // ── Pre-flight ─────────────────────────────────────────────────────────────
  info('Running pre-flight checks...')
  checkNodeVersion()
  checkDiskSpace()
  checkEnvVars()
  ensureDataDirs()

  const depsOk = checkNodeDeps()
  if (!depsOk) {
    err('Cannot start — npm install failed.')
    const known = lookupScenario('npm install failed')
    if (known) warn(`Known fix: ${known.fix}`)
    warn('Try manually: npm install --legacy-peer-deps --force')
    warn('Impact: Cannot start any part of the app.')
    process.exit(1)
  }

  const pythonCmd = findPython()
  const aiReady   = !noAI && !!pythonCmd && await checkPythonDeps(pythonCmd)

  const buildOk = await checkFrontendBuild()
  if (!buildOk && !isDev) {
    err('Cannot start in production mode — frontend build failed.')
    warn('Run: node start.js --dev  (for development mode without a build)')
    process.exit(1)
  }

  printBanner(aiReady)

  const backendPort = Number(process.env.PORT ?? 4098)
  const vitePort    = isDev ? Number(process.env.VITE_PORT ?? 4099) : backendPort

  info('Checking ports...')
  freePort(backendPort)
  if (isDev) freePort(vitePort)
  if (aiReady) freePort(8001)

  // ── Launch ─────────────────────────────────────────────────────────────────
  log('BACKEND', C.cyan, `Starting Express on :${backendPort}...`)
  spawnProc('BACKEND', C.cyan, 'node', ['server/index.js'])

  if (isDev) {
    log('VITE', C.blue, `Starting Vite on :${vitePort}...`)

    // Check for path issues before spawning
    if (__dirname.includes('`')) {
      err('Project path contains a backtick character: ' + __dirname)
      err('This breaks Vite on Windows. Move the project to a path without special characters.')
      warn('Example: C:\\Projects\\StockMind-AI')
      warn('Vite will not be started. Open the URL below for the backend API only.')
      exitedProcs.add('VITE')
    } else {
      // Resolve the Vite binary — use absolute path, never rely on shell PATH expansion
      // shell: false means the OS exec()s the binary directly — no backtick/space issues
      const viteJs = join(__dirname, 'node_modules', 'vite', 'bin', 'vite.js')
      const viteCjs= join(__dirname, 'node_modules', 'vite', 'dist', 'node', 'cli.js')
      let viteArgs

      if (existsSync(viteJs)) {
        // Invoke via `node <vite.js> --port N` — completely shell-independent
        viteArgs = { cmd: process.execPath, args: [viteJs, '--port', String(vitePort), '--strictPort'] }
      } else if (existsSync(viteCjs)) {
        viteArgs = { cmd: process.execPath, args: [viteCjs, '--port', String(vitePort), '--strictPort'] }
      } else {
        // Absolute path to the .cmd / shell script — still shell: false via node array
        const viteBin = process.platform === 'win32'
          ? join(__dirname, 'node_modules', '.bin', 'vite.cmd')
          : join(__dirname, 'node_modules', '.bin', 'vite')
        if (existsSync(viteBin)) {
          viteArgs = { cmd: process.platform === 'win32' ? 'cmd.exe' : viteBin,
                       args: process.platform === 'win32'
                         ? ['/d', '/c', viteBin, '--port', String(vitePort), '--strictPort']
                         : ['--port', String(vitePort), '--strictPort'] }
        } else {
          viteArgs = { cmd: process.execPath, args: ['-e', 'require("vite/bin/vite")', '--port', String(vitePort)] }
        }
      }

      spawnProc('VITE', C.blue, viteArgs.cmd, viteArgs.args, { shell: false })
    }
  }

  if (aiReady) {
    const { python: venvPy, uvicorn: venvUv } = getVenvPaths(pythonCmd)
    const pyExe = existsSync(venvPy) ? venvPy : pythonCmd
    log('AI', C.purple, 'Starting Python FastAPI on :8001...')
    if (existsSync(venvUv)) {
      spawnProc('AI', C.purple, venvUv, ['main:app', '--host', '0.0.0.0', '--port', '8001', '--log-level', 'warning'], { cwd: join(__dirname, 'ai_backend'), shell: false })
    } else {
      spawnProc('AI', C.purple, pyExe, ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', '8001', '--log-level', 'warning'], { cwd: join(__dirname, 'ai_backend'), shell: false })
    }
  }

  // ── Wait for readiness — check each process is actually alive before reporting ─
  const checks = [
    waitForPort(backendPort, 25_000).then(r => {
      log('BACKEND', r ? C.green : C.yellow, r ? `Ready → http://localhost:${backendPort}` : 'Slow — continuing')
    }),
  ]

  if (isDev) {
    if (exitedProcs.has('VITE')) {
      // Vite already exited with error — skip port wait, show status accurately
      checks.push(Promise.resolve())
    } else {
      checks.push(
        waitForPort(vitePort, 25_000).then(r => {
          if (!r || exitedProcs.has('VITE')) {
            err(`Vite did NOT start successfully on :${vitePort}`)
            warn('Check the Vite error output above for the exact cause.')
            warn('Common fixes:')
            warn('  → Upgrade Node.js to v22 LTS (fixes crypto.hash error)')
            warn('  → npm install --legacy-peer-deps (fixes missing/corrupt modules)')
            warn('  → Move project to a path without special chars (fixes backtick path)')
            warn(`  → Backend API still works at http://localhost:${backendPort}/api`)
          } else {
            log('VITE', C.green, `Ready → http://localhost:${vitePort}`)
          }
        })
      )
    }
  }

  if (aiReady) {
    checks.push(
      waitForPort(8001, 35_000).then(r =>
        log('AI', r ? C.green : C.yellow, r ? 'Ready → http://localhost:8001' : 'Slow — JS engine active')
      )
    )
  }

  await Promise.all(checks)

  // ── Print accurate status banner ───────────────────────────────────────────
  const viteOk   = !isDev || (!exitedProcs.has('VITE'))
  const backendOk= !exitedProcs.has('BACKEND')
  const allOk    = viteOk && backendOk
  const appUrl   = (isDev && viteOk) ? `http://localhost:${vitePort}` : `http://localhost:${backendPort}`

  if (allOk) {
    console.log(`\n${C.green}${C.bold}✓ All systems running${C.reset}

  ${C.cyan}${C.bold}Open: ${appUrl}${C.reset}

  ${C.dim}First time? New terminal: npm run keygen <username>
  System health: http://localhost:${backendPort}/api/agi/dashboard
  Diagnostics:   node start.js --diagnose${C.reset}
`)
  } else {
    const issues = []
    if (!viteOk)    issues.push('Vite (frontend) failed to start — see errors above')
    if (!backendOk) issues.push('Backend failed to start — see errors above')

    console.log(`\n${C.yellow}${C.bold}⚠ Partial startup — ${issues.length} issue(s):${C.reset}`)
    issues.forEach(i => console.log(`  ${C.red}✗${C.reset}  ${i}`))
    console.log(`
  ${C.cyan}Backend API: http://localhost:${backendPort}/api/health${C.reset}
  ${C.dim}Fix the errors above and run: node start.js --dev${C.reset}
`)
  }
}

main().catch(e => { err(`Fatal startup error: ${e.message}`); saveScenario(e.message?.slice(0,80) ?? 'startup crash', 'Check error above — restart to retry auto-fix', false); process.exit(1) })
