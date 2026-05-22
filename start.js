#!/usr/bin/env node
/**
 * StockMind AI — Unified Launcher  (parallel startup — target < 20s)
 *
 *   node start.js              production (serves built dist/ on :4098)
 *   node start.js --dev        development (Vite HMR on :4098)
 *   node start.js --build      build frontend first, then start production
 *   node start.js --no-ai      skip Python AI backend
 *   node start.js --keygen <username>
 */

import { spawn, execSync, spawnSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const args    = process.argv.slice(2)
const isDev   = args.includes('--dev')
const noAI    = args.includes('--no-ai')
const doBuild = args.includes('--build')
const help    = args.includes('--help') || args.includes('-h')

if (help) {
  console.log(`
StockMind AI — Launcher

  node start.js              Production mode (serves dist/ on :4098)
  node start.js --dev        Development mode (Vite HMR on :4098)
  node start.js --build      Build frontend then start production
  node start.js --no-ai      Skip Python AI backend
  node start.js --keygen <user>  Generate 12-digit access key

Environment:
  DATA_PASSWORD    Data folder encryption password
  PORT             Backend port (default: 5000)
  AI_BACKEND_URL   Python AI URL (default: http://localhost:8001)
  VITE_LIVE_FEED   Data feed: auto | zerodha | mock (default: auto)
`)
  process.exit(0)
}

const C = {
  reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m',
  cyan:'\x1b[36m', green:'\x1b[32m', yellow:'\x1b[33m',
  red:'\x1b[31m',  blue:'\x1b[34m', purple:'\x1b[35m',
}

function log(prefix, color, msg) {
  const ts = new Date().toLocaleTimeString('en-IN', { hour12: false })
  process.stdout.write(`${C.dim}${ts}${C.reset} ${color}${C.bold}[${prefix}]${C.reset} ${msg}\n`)
}

function checkNodeModules() {
  if (!existsSync(join(__dirname, 'node_modules', '.bin'))) {
    log('SETUP', C.yellow, 'node_modules not found — running npm install...')
    execSync('npm install --legacy-peer-deps', { stdio: 'inherit', cwd: __dirname })
    log('SETUP', C.green, 'Dependencies installed ✓')
  }
}

/**
 * Kill any process currently listening on a port.
 * Prevents EADDRINUSE on restart.
 */
function freePort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr ":${port} " | findstr "LISTENING"`, { encoding: 'utf8', stdio: ['pipe','pipe','ignore'] }).trim()
      if (out) {
        const pid = out.trim().split(/\s+/).pop()
        if (pid && /^\d+$/.test(pid) && pid !== '0') {
          spawnSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' })
          log('SETUP', C.yellow, `Freed port ${port} (PID ${pid})`)
        }
      }
    } else {
      spawnSync('fuser', ['-k', `${port}/tcp`], { stdio: 'ignore' })
    }
  } catch { /* port was already free */ }
}

function checkPython() {
  if (noAI) return false
  for (const cmd of ['python3', 'python']) {
    try {
      const out = execSync(`${cmd} --version 2>&1`, { encoding: 'utf8' }).trim()
      const m   = out.match(/Python (\d+)\.(\d+)/)
      if (m && parseInt(m[1]) >= 3 && parseInt(m[2]) >= 9) {
        log('AI', C.green, `${out} found ✓`)
        return cmd
      }
    } catch { /* try next */ }
  }
  log('AI', C.yellow, 'Python 3.9+ not found — AI backend skipped')
  return false
}

function checkPythonDeps(pythonCmd) {
  const venvPath = join(__dirname, 'ai_backend', 'venv')
  const reqPath  = join(__dirname, 'ai_backend', 'requirements.txt')
  if (!existsSync(reqPath)) return false
  if (!existsSync(venvPath)) {
    log('AI', C.yellow, 'Creating Python venv...')
    try {
      execSync(`${pythonCmd} -m venv venv`, { stdio: 'inherit', cwd: join(__dirname, 'ai_backend') })
      const pip = process.platform === 'win32'
        ? join(venvPath, 'Scripts', 'pip.exe')
        : join(venvPath, 'bin', 'pip')
      log('AI', C.yellow, 'Installing Python deps (first run ~1 min)...')
      execSync(`"${pip}" install -r requirements.txt --quiet`, {
        stdio: 'inherit', cwd: join(__dirname, 'ai_backend'),
      })
      log('AI', C.green, 'Python deps installed ✓')
    } catch (e) {
      log('AI', C.red, `Failed: ${e.message}`)
      return false
    }
  }
  return true
}

function buildFrontend() {
  log('BUILD', C.cyan, 'Building frontend...')
  execSync('npm run build', { stdio: 'inherit', cwd: __dirname })
  log('BUILD', C.green, 'Frontend built ✓')
}

const procs = []

function spawnProc(name, color, cmd, cmdArgs, opts = {}) {
  // Default shell: true on Windows for most commands, but allow override
  const useShell = opts.shell !== undefined ? opts.shell : process.platform === 'win32'
  const { shell: _shell, ...restOpts } = opts
  const proc = spawn(cmd, cmdArgs, {
    cwd: __dirname, env: { ...process.env, FORCE_COLOR: '1' },
    shell: useShell, ...restOpts,
  })
  proc.stdout?.on('data', d =>
    String(d).trim().split('\n').filter(Boolean).forEach(l => log(name, color, l))
  )
  proc.stderr?.on('data', d =>
    String(d).trim().split('\n')
      .filter(l => l && !l.includes('DeprecationWarning') && !l.includes('ExperimentalWarning'))
      .forEach(l => log(name, color, l))
  )
  proc.on('exit', code => onChildExit(name, code))
  proc.on('error', err => log(name, C.red, `Spawn error: ${err.message}`))
  procs.push({ name, proc })
  return proc
}

function stopAll() {
  process.stdout.write(`\n${C.yellow}Stopping…${C.reset}\n`)
  for (const { proc } of procs) {
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        proc.kill('SIGTERM')
      }
    } catch { /* already dead */ }
  }
  // Give processes 1s to clean up before hard exit
  setTimeout(() => process.exit(0), 1000)
}

// Handle child process exits — don't kill the launcher unless it's the backend
function onChildExit(name, code) {
  if (code !== 0 && code !== null) {
    log(name, C.red, `Exited with code ${code}`)
    if (name === 'BACKEND') {
      log('LAUNCHER', C.red, 'Backend crashed — stopping all processes')
      stopAll()
    }
  }
}

process.on('SIGINT', stopAll)
process.on('SIGTERM', stopAll)

function waitForPort(port, timeoutMs = 15_000) {
  return new Promise(resolve => {
    const start = Date.now()
    function check() {
      fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(500) })
        .then(() => resolve(true))
        .catch(() => { if (Date.now() - start < timeoutMs) setTimeout(check, 400); else resolve(false) })
    }
    check()
  })
}

function printBanner(pythonCmd) {
  const pkg  = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'))
  const port = process.env.PORT ?? 4098
  console.log(`
${C.cyan}${C.bold}╔══════════════════════════════════════════════════════╗
║   StockMind AI  v${pkg.version.padEnd(35)}║
║   AI-Powered Market Intelligence Platform            ║
╚══════════════════════════════════════════════════════╝${C.reset}

  Mode     ${isDev ? `${C.yellow}Development${C.reset} (Vite HMR)` : `${C.green}Production${C.reset}`}
  App      ${C.cyan}http://localhost:${isDev ? 4098 : port}${C.reset}
  Backend  ${C.cyan}http://localhost:${port}/api${C.reset}
  AI       ${pythonCmd ? `${C.green}Python FastAPI → :8001${C.reset}` : `${C.yellow}JS engine${C.reset}`}
  Feed     ${C.dim}${process.env.VITE_LIVE_FEED ?? 'auto'}${C.reset}

  ${C.dim}Ctrl+C to stop all processes${C.reset}
`)
}

async function main() {
  console.clear()
  checkNodeModules()
  if (doBuild) buildFrontend()
  if (!isDev && !existsSync(join(__dirname, 'dist', 'index.html'))) {
    log('SETUP', C.yellow, 'No production build — building now...')
    buildFrontend()
  }

  const pythonCmd = checkPython()
  const aiReady   = pythonCmd && checkPythonDeps(pythonCmd)
  printBanner(aiReady ? pythonCmd : false)

  const backendPort = Number(process.env.PORT ?? 4098)

  // ── Free ports before starting ────────────────────────────────────────────
  log('SETUP', C.dim, 'Checking ports...')
  freePort(backendPort)
  if (isDev)   freePort(4098)
  if (aiReady) freePort(8001)

  // ── Launch ALL three processes simultaneously ─────────────────────────────
  log('BACKEND', C.cyan, `Starting Express on :${backendPort}...`)
  spawnProc('BACKEND', C.cyan, 'node', ['server/index.js'])

  if (isDev) {
    log('VITE', C.blue, 'Starting Vite on :4098...')
    const viteBin = process.platform === 'win32'
      ? join(__dirname, 'node_modules', '.bin', 'vite.cmd')
      : join(__dirname, 'node_modules', '.bin', 'vite')
    const viteCmd  = existsSync(viteBin) ? viteBin : 'npx'
    const viteArgs = existsSync(viteBin) ? ['--port', '4098', '--strictPort'] : ['vite', '--port', '4098', '--strictPort']
    spawnProc('VITE', C.blue, viteCmd, viteArgs)
  }

  if (aiReady) {
    const venvPython = process.platform === 'win32'
      ? join(__dirname, 'ai_backend', 'venv', 'Scripts', 'python.exe')
      : join(__dirname, 'ai_backend', 'venv', 'bin', 'python')
    const pyExe = existsSync(venvPython) ? venvPython : pythonCmd
    log('AI', C.purple, 'Starting Python FastAPI on :8001...')
    // Note: --reload removed — it watches files and can kill the launcher on change.
    // Restart the whole app (node start.js --dev) to pick up AI backend changes.
    spawnProc('AI', C.purple, pyExe,
      ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', '8001',
       '--log-level', 'warning'],
      // shell: false so the path with spaces is passed correctly as argv[0]
      { cwd: join(__dirname, 'ai_backend'), shell: false }
    )
  }

  // ── Wait for all in parallel (not sequential) ─────────────────────────────
  const checks = [
    waitForPort(backendPort, 18_000).then(ok =>
      log('BACKEND', ok ? C.green : C.yellow, ok ? `Ready → http://localhost:${backendPort}` : 'Slow — continuing')
    ),
  ]
  if (isDev)    checks.push(waitForPort(4098, 18_000).then(ok => log('VITE', ok ? C.green : C.yellow, ok ? 'Ready → http://localhost:4098' : 'Slow — check :4098')))
  if (aiReady)  checks.push(waitForPort(8001, 25_000).then(ok => log('AI',   ok ? C.green : C.yellow, ok ? 'Ready → http://localhost:8001' : 'Slow — JS engine active')))

  await Promise.all(checks)

  const appUrl = isDev ? 'http://localhost:4098' : `http://localhost:${backendPort}`
  console.log(`\n${C.green}${C.bold}✓ All systems running${C.reset}\n\n  ${C.cyan}${C.bold}Open: ${appUrl}${C.reset}\n\n  ${C.dim}First time? In a new terminal:\n  npm run keygen <username>${C.reset}\n`)
}

if (args.includes('--keygen')) {
  const username = args[args.indexOf('--keygen') + 1]
  if (!username) { console.error('Usage: node start.js --keygen <username>'); process.exit(1) }
  execSync(`node server/keygen/generate.js ${username}`, { stdio: 'inherit' })
  process.exit(0)
}

main().catch(err => { console.error(`${C.red}Fatal:${C.reset}`, err.message); process.exit(1) })
