/**
 * outcomeValidator.js — Live prediction outcome tracking + learning feedback loop.
 *
 * Every 2.4s during market hours:
 *   1. Load unresolved predictions from last 30 days
 *   2. Fetch current live price for each symbol
 *   3. Check if T1/T2/T3 or SL has been hit
 *   4. Resolve outcome, write back to storage
 *   5. Save deviation record for adaptive learning
 *   6. Recompute rolling accuracy
 *   7. Notify AI backend if accuracy drifts (triggers recalibration)
 *   8. Broadcast outcome events to SSE subscribers
 *
 * This is the feedback loop that makes predictions improve over time.
 */

import { listSecure, readSecure, writeSecure } from '../storage/fileStore.js'
import { computeAccuracy, saveDeviationRecord } from './predictionStore.js'
import { writeAMI } from './amiStore.js'
import { recordSnapshot } from './marketSessionStore.js'

const AI_BACKEND_URL     = process.env.AI_BACKEND_URL ?? 'http://localhost:8001'
const FINNHUB_KEY        = process.env.FINNHUB_KEY ?? process.env.VITE_FINNHUB_KEY ?? ''
const POLL_INTERVAL      = 2_400   // 2.4 seconds
const CACHE_TTL          = 2_400
const MAX_AGE_DAYS       = 30
const DANGER_MULTIPLIER  = Number(process.env.DANGER_SIGNAL_MULTIPLIER ?? 1.5)

// ── Danger signal state ───────────────────────────────────────────────────────
// Tracks which prediction IDs have already fired a danger signal this session
// so we don't duplicate. Also tracks which are in "danger" state for recovery.
const dangerFiredIds    = new Set()   // IDs that have fired danger signal
const dangerActiveIds   = new Set()   // IDs currently in danger state (for recovery)
const dangerRetryQueue  = []          // recalibration requests to retry

// ── Danger signal detection (runs in background, never blocks polling) ────────

function checkDangerSignal(pred, currentPrice) {
  if (!pred.entryPrice || !pred.stopLoss) return null
  const isLong = pred.type === 'LONG'
  const slDistance = Math.abs(pred.entryPrice - pred.stopLoss)
  if (slDistance === 0) return null

  const threshold = isLong
    ? pred.stopLoss - slDistance * (DANGER_MULTIPLIER - 1)
    : pred.stopLoss + slDistance * (DANGER_MULTIPLIER - 1)

  const isDanger = isLong
    ? currentPrice <= threshold
    : currentPrice >= threshold

  if (!isDanger) return null

  const deviationPct = ((currentPrice - pred.entryPrice) / pred.entryPrice) * 100
  return {
    predictionId:    pred.id,
    symbol:          pred.symbol,
    instrType:       pred.instrType ?? 'spot',
    entryPrice:      pred.entryPrice,
    stopLoss:        pred.stopLoss,
    livePrice:       currentPrice,
    deviationPct:    Math.round(deviationPct * 100) / 100,
    deviationMultiplier: DANGER_MULTIPLIER,
    grade:           pred.grade ?? 'C',
    timestamp:       Date.now(),
  }
}

async function processDangerSignals(predsBySymbol, livePrices) {
  // This runs in background — never awaited by the main polling loop
  for (const [symbol, entries] of predsBySymbol) {
    const price = livePrices.get(symbol)
    if (!price) continue

    for (const { pred } of entries) {
      if (!pred.id || pred.outcome) continue

      const danger = checkDangerSignal(pred, price)

      if (danger) {
        // New danger signal — fire if not already fired for this prediction
        if (!dangerFiredIds.has(pred.id)) {
          dangerFiredIds.add(pred.id)
          dangerActiveIds.add(pred.id)

          // Log to AMI store
          try {
            writeAMI(symbol, 'danger-log', { ...danger, id: `danger-${pred.id}` })
          } catch { /* non-fatal */ }

          // Save deviation record for adaptive learning
          try {
            saveDeviationRecord({
              id:           pred.id,
              symbol:       pred.symbol,
              instrType:    pred.instrType ?? 'spot',
              entryPrice:   pred.entryPrice,
              actualPrice:  price,
              deviation:    danger.deviationPct,
              outcome:      'DANGER_SIGNAL',
              correct:      false,
              probability:  pred.probability,
              grade:        pred.grade,
              predictionMode: pred.predictionMode ?? 'both',
              ts:           Date.now(),
            })
          } catch { /* non-fatal */ }

          // Broadcast danger signal to SSE clients
          broadcastSSE('danger_signal', danger)
          console.warn(`[DangerMonitor] ⚠ DANGER: ${symbol} #${pred.id?.slice(0, 8)} price=${price} SL=${pred.stopLoss} dev=${danger.deviationPct}%`)

          // Queue recalibration request (non-blocking)
          dangerRetryQueue.push({ symbol, accuracy: 0, drift: Math.abs(danger.deviationPct), timestamp: Date.now() })
        }
      } else if (dangerActiveIds.has(pred.id)) {
        // Price recovered above stop-loss — resolve the danger signal
        dangerActiveIds.delete(pred.id)
        broadcastSSE('danger_resolved', { predictionId: pred.id, symbol, livePrice: price, timestamp: Date.now() })
        console.log(`[DangerMonitor] ✓ RESOLVED: ${symbol} #${pred.id?.slice(0, 8)} price recovered to ${price}`)
      }
    }
  }

  // Flush retry queue (non-blocking)
  while (dangerRetryQueue.length > 0) {
    const req = dangerRetryQueue.shift()
    try {
      await fetch(`${AI_BACKEND_URL}/calibrate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(req),
        signal:  AbortSignal.timeout(3000),
      })
    } catch {
      // Re-queue for next cycle (max 3 retries per item)
      if ((req._retries ?? 0) < 3) {
        dangerRetryQueue.push({ ...req, _retries: (req._retries ?? 0) + 1 })
      }
    }
  }
}

export function getDangerLog(limit = 50) {
  // Return recent danger signals from in-memory tracking
  return { dangerFiredCount: dangerFiredIds.size, dangerActiveCount: dangerActiveIds.size }
}

// ── Market hours check (NSE: Mon-Fri 09:15–15:30 IST) ────────────────────────

function isMarketHours() {
  const now = new Date()
  const day = now.getDay()
  if (day === 0 || day === 6) return false
  const istOffset = 5.5 * 60 * 60 * 1000
  const ist  = new Date(now.getTime() + istOffset)
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  return mins >= 555 && mins <= 930  // 9:15–15:30 IST
}

// ── SSE subscriber registry ───────────────────────────────────────────────────
// Allows the frontend to receive real-time outcome events without polling.

const sseClients = new Set()

export function addSSEClient(res) {
  sseClients.add(res)
  res.on('close', () => sseClients.delete(res))
}

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of sseClients) {
    try { client.write(payload) } catch { sseClients.delete(client) }
  }
}

// ── Live price fetcher ────────────────────────────────────────────────────────

const priceCache = new Map()

async function fetchLivePrice(symbol) {
  const cached = priceCache.get(symbol)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.price

  try {
    const { fetchQuote } = await import('./yahooFinanceService.js')
    const tick = await fetchQuote(symbol, 'NSE')
    if (tick?.price) {
      priceCache.set(symbol, { price: tick.price, ts: Date.now() })
      return tick.price
    }
  } catch { /* fall through */ }

  if (FINNHUB_KEY) {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${symbol}.NS&token=${FINNHUB_KEY}`,
        { signal: AbortSignal.timeout(3000) }
      )
      if (res.ok) {
        const d = await res.json()
        if (d.c && d.c > 0) {
          priceCache.set(symbol, { price: d.c, ts: Date.now() })
          return d.c
        }
      }
    } catch { /* fall through */ }
  }

  return null
}

// ── Outcome resolution logic ──────────────────────────────────────────────────

function checkOutcome(pred, currentPrice) {
  const { type, entryPrice, t1Price, t2Price, t3Price, stopLoss } = pred
  if (!entryPrice || !stopLoss || !t1Price) return null

  const isLong = type === 'LONG'

  if (isLong) {
    if (currentPrice >= (t3Price ?? Infinity)) return { resolved: true, outcome: 'T3_HIT', outcomePrice: currentPrice }
    if (currentPrice >= (t2Price ?? Infinity)) return { resolved: true, outcome: 'T2_HIT', outcomePrice: currentPrice }
    if (currentPrice >= t1Price)               return { resolved: true, outcome: 'T1_HIT', outcomePrice: currentPrice }
    if (currentPrice <= stopLoss)              return { resolved: true, outcome: 'SL_HIT', outcomePrice: currentPrice }
  } else {
    if (currentPrice <= (t3Price ?? -Infinity)) return { resolved: true, outcome: 'T3_HIT', outcomePrice: currentPrice }
    if (currentPrice <= (t2Price ?? -Infinity)) return { resolved: true, outcome: 'T2_HIT', outcomePrice: currentPrice }
    if (currentPrice <= t1Price)                return { resolved: true, outcome: 'T1_HIT', outcomePrice: currentPrice }
    if (currentPrice >= stopLoss)               return { resolved: true, outcome: 'SL_HIT', outcomePrice: currentPrice }
  }

  if (pred.validity && new Date(pred.validity) < new Date()) {
    return { resolved: true, outcome: 'TIMEOUT', outcomePrice: currentPrice }
  }

  return null
}

// ── Accuracy drift detector ───────────────────────────────────────────────────

const accuracyHistory = new Map()

async function notifyAIBackendIfDrift(symbol, accuracy) {
  const prev = accuracyHistory.get(symbol)
  accuracyHistory.set(symbol, accuracy)
  if (prev == null) return

  const drift = Math.abs(accuracy - prev)
  if (drift < 3) return

  console.log(`[OutcomeValidator] Accuracy drift for ${symbol}: ${prev}% → ${accuracy}% (Δ${drift.toFixed(1)}%)`)

  // Broadcast to SSE clients
  broadcastSSE('accuracy_drift', { symbol, prev, current: accuracy, drift })

  try {
    await fetch(`${AI_BACKEND_URL}/calibrate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ symbol, accuracy, drift, timestamp: Date.now() }),
      signal:  AbortSignal.timeout(3000),
    })
  } catch {
    if (drift > 10) {
      console.warn(`[OutcomeValidator] ⚠ Large accuracy drift for ${symbol} (${drift.toFixed(1)}%) — consider retraining`)
    }
  }
}

// ── Main validation loop ──────────────────────────────────────────────────────

let running = false
let intervalId = null
const resolvedThisSession = new Set()

async function runValidationCycle() {
  if (!isMarketHours()) return

  try {
    const allDirs = listSecure('predictions')
    const months  = allDirs.filter(f => /^\d{4}-\d{2}$/.test(f)).sort().reverse().slice(0, 2)

    const cutoff        = Date.now() - MAX_AGE_DAYS * 86_400_000
    const symbolsToCheck = new Set()
    const predsBySymbol  = new Map()

    for (const month of months) {
      const files = listSecure(`predictions/${month}`)
      for (const file of files) {
        if (file === 'summary') continue
        const pred = readSecure(`predictions/${month}/${file}`)
        if (!pred || pred.outcome || resolvedThisSession.has(pred.id)) continue
        if (pred.generatedAt < cutoff) continue
        if (!pred.symbol || !pred.entryPrice) continue

        symbolsToCheck.add(pred.symbol)
        if (!predsBySymbol.has(pred.symbol)) predsBySymbol.set(pred.symbol, [])
        predsBySymbol.get(pred.symbol).push({ pred, month, file })
      }
    }

    if (symbolsToCheck.size === 0) return

    const resolvedSymbols = new Set()
    // Collect live prices for danger signal processing
    const livePrices = new Map()

    for (const symbol of symbolsToCheck) {
      const price = await fetchLivePrice(symbol)
      if (!price) continue

      livePrices.set(symbol, price)

      // Record snapshot for market session store (pre/post/regular tracking)
      try {
        const { fetchQuote } = await import('./yahooFinanceService.js')
        const tick = await fetchQuote(symbol, 'NSE')
        if (tick) recordSnapshot(tick)
      } catch { /* non-fatal */ }

      const entries = predsBySymbol.get(symbol) ?? []
      let resolvedCount = 0

      for (const { pred, month, file } of entries) {
        const result = checkOutcome(pred, price)
        if (!result?.resolved) continue

        const wasCorrect = result.outcome !== 'SL_HIT' && result.outcome !== 'TIMEOUT'
        const pnl = wasCorrect
          ? Math.abs(result.outcomePrice - pred.entryPrice) * (pred.lotCount ?? 1) * (pred.lotSize ?? 1)
          : -Math.abs(pred.entryPrice - pred.stopLoss) * (pred.lotCount ?? 1) * (pred.lotSize ?? 1)
        const commission = (pred.lotCount ?? 1) * 40
        const pnlAfterCommission = pnl - commission

        const outcome = {
          outcome:              result.outcome,
          outcomePrice:         result.outcomePrice,
          outcomeResolvedAt:    Date.now(),
          wasCorrect,
          pnl:                  Math.round(pnl),
          pnlAfterCommission:   Math.round(pnlAfterCommission),
        }

        writeSecure(`predictions/${month}/${file}`, { ...pred, outcome })
        resolvedThisSession.add(pred.id)
        resolvedCount++

        // Save deviation record for adaptive learning
        const deviationPct = ((result.outcomePrice - pred.entryPrice) / pred.entryPrice) * 100
        saveDeviationRecord({
          id:           pred.id,
          symbol:       pred.symbol,
          instrType:    pred.instrType ?? 'spot',
          entryPrice:   pred.entryPrice,
          actualPrice:  result.outcomePrice,
          deviation:    Math.round(deviationPct * 100) / 100,
          outcome:      result.outcome,
          correct:      wasCorrect,
          probability:  pred.probability,
          grade:        pred.grade,
          predictionMode: pred.predictionMode ?? 'both',
          ts:           Date.now(),
        })

        // Broadcast to SSE clients
        broadcastSSE('outcome_resolved', {
          symbol:    pred.symbol,
          id:        pred.id,
          outcome:   result.outcome,
          price:     result.outcomePrice,
          wasCorrect,
          pnlAfterCommission: Math.round(pnlAfterCommission),
        })

        console.log(`[OutcomeValidator] ${symbol} #${pred.id?.slice(0, 8)} → ${result.outcome} @ ${price} (${wasCorrect ? '✓' : '✗'})`)
      }

      if (resolvedCount > 0) resolvedSymbols.add(symbol)
    }

    // Recompute accuracy and notify AI backend if drift
    for (const symbol of resolvedSymbols) {
      const acc = computeAccuracy(symbol, 30)
      if (acc.accuracyPct != null) {
        await notifyAIBackendIfDrift(symbol, acc.accuracyPct)

        // Broadcast accuracy update to SSE clients
        broadcastSSE('accuracy_update', {
          symbol,
          accuracyPct:   acc.accuracyPct,
          totalResolved: acc.totalResolved,
          stable:        acc.stable,
        })
      }
    }

    // ── Danger signal detection — runs in background, NEVER blocks this loop ──
    // Fire-and-forget: processDangerSignals is async but we do NOT await it.
    // The polling loop continues immediately. Live price data keeps flowing,
    // which is essential to determine if a danger signal is genuine or a
    // false positive that resolves within subsequent polling cycles.
    processDangerSignals(predsBySymbol, livePrices).catch(err => {
      console.warn('[DangerMonitor] Background processing error:', err.message)
    })

  } catch (err) {
    console.error('[OutcomeValidator] Cycle error:', err.message)
  }
}

// ── Cleanup scheduler ─────────────────────────────────────────────────────────

let cleanupIntervalId = null

export function startCleanupScheduler(retentionDays = 30, intervalHours = 24) {
  if (cleanupIntervalId) return
  const ms = intervalHours * 60 * 60 * 1000
  cleanupIntervalId = setInterval(async () => {
    const { cleanupOldPredictions } = await import('./predictionStore.js')
    const result = cleanupOldPredictions(retentionDays)
    if (result.deleted > 0) {
      console.log(`[Cleanup] Removed ${result.deleted} old predictions from: ${result.freedMonths.join(', ')}`)
    }
  }, ms)
  console.log(`[Cleanup] Scheduler started — runs every ${intervalHours}h, retains ${retentionDays} days`)
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startOutcomeValidator() {
  if (running) return
  running = true
  console.log('[OutcomeValidator] Started — checking predictions every 2.4s during market hours')
  intervalId = setInterval(runValidationCycle, POLL_INTERVAL)
  runValidationCycle()
}

export function stopOutcomeValidator() {
  running = false
  clearInterval(intervalId)
  clearInterval(cleanupIntervalId)
  console.log('[OutcomeValidator] Stopped')
}

export function getValidatorStatus() {
  return {
    running,
    resolvedThisSession: resolvedThisSession.size,
    marketHours:         isMarketHours(),
    pollIntervalMs:      POLL_INTERVAL,
    sseClients:          sseClients.size,
    dangerSignals:       getDangerLog(),
  }
}
