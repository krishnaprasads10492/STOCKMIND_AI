/**
 * aiGrowthWorker.js — Background AI Growth Engine
 *
 * Runs continuously in the background (even when the UI is out of focus).
 * Responsibilities:
 *   1. Collect OHLCV + market data for all tracked symbols
 *   2. Run strategy evaluation across multiple timeframes
 *   3. Analyse prediction accuracy trends and propose algo upgrades
 *   4. Submit upgrade proposals to JARVIS for review
 *   5. Update adaptive weights based on recent performance
 *   6. Broadcast progress events to SSE subscribers
 *
 * Controlled via:
 *   startAIGrowthWorker()  — called from server/index.js when enabled
 *   stopAIGrowthWorker()   — called when user disables in Settings
 *   getGrowthWorkerStatus() — returns current state
 *
 * The worker respects a "paused" flag so it can be toggled without restart.
 */

import { readSecure, writeSecure, listSecure } from '../storage/fileStore.js'
import { computeAccuracy } from './predictionStore.js'

const AI_BACKEND_URL = process.env.AI_BACKEND_URL ?? 'http://localhost:8001'
const WORKER_INTERVAL_MS = Number(process.env.AI_GROWTH_INTERVAL_MS ?? 5 * 60 * 1000) // 5 min default

// ── State ─────────────────────────────────────────────────────────────────────
let running   = false
let paused    = false
let intervalId = null
let cycleCount = 0
let lastCycleAt = null
let lastError   = null
const upgradeProposals = []   // in-memory ring buffer (last 50)
const MAX_PROPOSALS = 50

// ── SSE clients (shared with outcomeValidator pattern) ────────────────────────
const sseClients = new Set()

export function addGrowthWorkerSSEClient(res) {
  sseClients.add(res)
  res.on('close', () => sseClients.delete(res))
}

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of sseClients) {
    try { client.write(payload) } catch { sseClients.delete(client) }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal })
    clearTimeout(timer)
    return res
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

function getTrackedSymbols() {
  // Pull symbols from recent prediction files
  const symbols = new Set()
  try {
    const months = listSecure('predictions').filter(f => /^\d{4}-\d{2}$/.test(f)).sort().reverse().slice(0, 2)
    for (const month of months) {
      const files = listSecure(`predictions/${month}`)
      for (const file of files) {
        if (file === 'summary') continue
        const pred = readSecure(`predictions/${month}/${file}`)
        if (pred?.symbol) symbols.add(pred.symbol)
        if (symbols.size >= 30) break  // cap at 30 symbols per cycle
      }
      if (symbols.size >= 30) break
    }
  } catch { /* non-fatal */ }

  // Always include core indices
  const CORE = ['NIFTY50', 'BANKNIFTY', 'FINNIFTY', 'SENSEX', 'NIFTY', 'MIDCPNIFTY']
  for (const s of CORE) symbols.add(s)

  return [...symbols]
}

// ── Phase 1: Data collection ──────────────────────────────────────────────────

async function collectMarketData(symbols) {
  const results = {}
  for (const symbol of symbols.slice(0, 10)) {  // batch of 10 per cycle
    try {
      const res = await fetchWithTimeout(
        `http://localhost:${process.env.PORT ?? 5000}/api/market/quote?symbol=${encodeURIComponent(symbol)}&exchange=NSE`,
        { headers: { 'x-internal': '1' } },
        5000
      )
      if (res.ok) {
        const data = await res.json()
        results[symbol] = { price: data.price, change: data.change, volume: data.volume, ts: Date.now() }
      }
    } catch { /* skip symbol */ }
  }
  return results
}

// ── Phase 2: Strategy evaluation ─────────────────────────────────────────────

async function evaluateStrategies(symbols) {
  const evaluations = []
  for (const symbol of symbols.slice(0, 5)) {
    try {
      const acc = computeAccuracy(symbol, 30)
      if (acc.totalResolved < 3) continue  // not enough data

      const evaluation = {
        symbol,
        accuracyPct:   acc.accuracyPct,
        totalResolved: acc.totalResolved,
        stable:        acc.stable,
        ts:            Date.now(),
      }

      // Flag symbols needing attention
      if (acc.accuracyPct != null && acc.accuracyPct < 60) {
        evaluation.needsAttention = true
        evaluation.reason = `Accuracy ${acc.accuracyPct}% below 60% threshold`
      }

      evaluations.push(evaluation)
    } catch { /* skip */ }
  }
  return evaluations
}

// ── Phase 3: Algo upgrade proposals ──────────────────────────────────────────

async function generateUpgradeProposals(evaluations) {
  const proposals = []

  for (const ev of evaluations) {
    if (!ev.needsAttention) continue

    // Ask AI backend for upgrade suggestions
    try {
      const res = await fetchWithTimeout(
        `${AI_BACKEND_URL}/self-optimizer/suggest`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            symbol:      ev.symbol,
            accuracyPct: ev.accuracyPct,
            totalSamples: ev.totalResolved,
            context:     'background_growth_worker',
          }),
        },
        10000
      )
      if (res.ok) {
        const suggestion = await res.json()
        proposals.push({
          id:          `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          symbol:      ev.symbol,
          type:        'algo_upgrade',
          priority:    ev.accuracyPct < 50 ? 'high' : 'medium',
          suggestion:  suggestion.suggestion ?? 'Recalibrate model weights',
          details:     suggestion.details ?? {},
          accuracyPct: ev.accuracyPct,
          status:      'pending',
          createdAt:   Date.now(),
        })
      }
    } catch {
      // AI backend unavailable — generate a local proposal
      proposals.push({
        id:          `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        symbol:      ev.symbol,
        type:        'recalibration',
        priority:    ev.accuracyPct < 50 ? 'high' : 'medium',
        suggestion:  `Accuracy for ${ev.symbol} is ${ev.accuracyPct}% — trigger recalibration pipeline`,
        details:     { accuracyPct: ev.accuracyPct, totalResolved: ev.totalResolved },
        status:      'pending',
        createdAt:   Date.now(),
      })
    }
  }

  return proposals
}

// ── Phase 4: Adaptive weight update ──────────────────────────────────────────

async function updateAdaptiveWeights(evaluations) {
  for (const ev of evaluations) {
    if (ev.accuracyPct == null) continue
    try {
      await fetchWithTimeout(
        `${AI_BACKEND_URL}/calibrate`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            symbol:      ev.symbol,
            accuracy:    ev.accuracyPct,
            source:      'growth_worker',
            timestamp:   Date.now(),
          }),
        },
        5000
      )
    } catch { /* non-fatal — AI backend may be offline */ }
  }
}

// ── Main growth cycle ─────────────────────────────────────────────────────────

async function runGrowthCycle() {
  if (paused) return

  cycleCount++
  lastCycleAt = Date.now()

  broadcastSSE('growth_cycle_start', { cycle: cycleCount, ts: lastCycleAt })

  try {
    const symbols = getTrackedSymbols()

    // Phase 1: Collect market data
    const marketData = await collectMarketData(symbols)
    const dataCount = Object.keys(marketData).length
    broadcastSSE('growth_data_collected', { symbols: dataCount, cycle: cycleCount })

    // Phase 2: Evaluate strategies
    const evaluations = await evaluateStrategies(symbols)
    const attentionNeeded = evaluations.filter(e => e.needsAttention).length
    broadcastSSE('growth_strategies_evaluated', {
      evaluated: evaluations.length,
      attentionNeeded,
      cycle: cycleCount,
    })

    // Phase 3: Generate upgrade proposals (only if issues found)
    if (attentionNeeded > 0) {
      const newProposals = await generateUpgradeProposals(evaluations)
      for (const p of newProposals) {
        upgradeProposals.unshift(p)
        broadcastSSE('growth_proposal', p)
      }
      // Keep ring buffer bounded
      while (upgradeProposals.length > MAX_PROPOSALS) upgradeProposals.pop()
    }

    // Phase 4: Update adaptive weights
    await updateAdaptiveWeights(evaluations)

    // Persist cycle summary
    try {
      const summary = {
        cycle:          cycleCount,
        ts:             lastCycleAt,
        symbolsTracked: symbols.length,
        dataCollected:  dataCount,
        evaluated:      evaluations.length,
        attentionNeeded,
        proposalsTotal: upgradeProposals.length,
      }
      writeSecure('system/growth-worker-summary', summary)
    } catch { /* non-fatal */ }

    broadcastSSE('growth_cycle_complete', {
      cycle:          cycleCount,
      symbolsTracked: symbols.length,
      dataCollected:  dataCount,
      evaluated:      evaluations.length,
      attentionNeeded,
      durationMs:     Date.now() - lastCycleAt,
    })

    lastError = null
  } catch (err) {
    lastError = err.message
    console.error('[AIGrowthWorker] Cycle error:', err.message)
    broadcastSSE('growth_cycle_error', { cycle: cycleCount, error: err.message })
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startAIGrowthWorker() {
  if (running) return
  running = true
  paused  = false
  console.log(`[AIGrowthWorker] Started — cycle every ${WORKER_INTERVAL_MS / 1000}s`)
  // Run first cycle after a short delay to not block startup
  setTimeout(() => runGrowthCycle(), 10_000)
  intervalId = setInterval(runGrowthCycle, WORKER_INTERVAL_MS)
}

export function stopAIGrowthWorker() {
  running = false
  paused  = false
  clearInterval(intervalId)
  intervalId = null
  console.log('[AIGrowthWorker] Stopped')
}

export function pauseAIGrowthWorker() {
  paused = true
  console.log('[AIGrowthWorker] Paused')
}

export function resumeAIGrowthWorker() {
  paused = false
  console.log('[AIGrowthWorker] Resumed')
}

export function getGrowthWorkerStatus() {
  return {
    running,
    paused,
    cycleCount,
    lastCycleAt,
    lastError,
    proposalsPending: upgradeProposals.filter(p => p.status === 'pending').length,
    proposalsTotal:   upgradeProposals.length,
    intervalMs:       WORKER_INTERVAL_MS,
    sseClients:       sseClients.size,
  }
}

export function getUpgradeProposals(limit = 20) {
  return upgradeProposals.slice(0, limit)
}

export function approveProposal(id) {
  const p = upgradeProposals.find(p => p.id === id)
  if (p) { p.status = 'approved'; p.approvedAt = Date.now() }
  return !!p
}

export function dismissProposal(id) {
  const p = upgradeProposals.find(p => p.id === id)
  if (p) { p.status = 'dismissed'; p.dismissedAt = Date.now() }
  return !!p
}
