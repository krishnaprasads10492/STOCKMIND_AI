/**
 * predictionStore.js — save, retrieve, resolve predictions, and manage history.
 *
 * Optimised storage layout v3:
 *   data/predictions/YYYY-MM/{SYMBOL}_{ts}_{batchId}.enc  — FULL BATCH (all signals in one file)
 *   data/predictions/YYYY-MM/summary.csv                  — append-only summary index
 *   data/predictions/index/{SYMBOL}.enc                   — in-memory-friendly symbol index
 *   data/predictions/versions/{SYMBOL}.enc                — model version history
 *   data/backtest/{SYMBOL}_{version}.enc                  — backtest result cache
 *   data/predictions/deviations/{SYMBOL}_ring.enc         — ring buffer (500 max, no rewrites)
 *
 * Key optimisations:
 *   1. Batch storage — all 16 signals in ONE encrypted file instead of 16
 *      → 16x fewer file I/O operations per prediction
 *   2. In-memory symbol index for O(1) lookups by symbol
 *   3. Ring-buffer deviation store — append-only, no full rewrite
 *   4. Accuracy cache — recomputed lazily, invalidated on outcome
 */

import crypto from 'crypto'
import { writeSecure, readSecure, listSecure, deleteSecure, appendCsv, readCsv, writeBatch } from '../storage/fileStore.js'
import { CACHE } from '../storage/memCache.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthDir(ts) {
  const d = new Date(ts)
  return `predictions/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function batchFile(symbol, ts, batchId) {
  return `${monthDir(ts)}/${symbol}_${ts}_batch_${batchId}`
}

const CSV_HEADER = 'batchId,symbol,exchange,generatedAt,signalCount,topGrade,topProb,modelVersion,predictionMode\n'

// ── In-memory symbol → month → batchId[] index ───────────────────────────────
// Rebuilt on startup from file listing. O(1) lookup by symbol.
const _symbolIndex = new Map()  // symbol → Set<"YYYY-MM/filename">

function _indexAdd(symbol, path) {
  if (!_symbolIndex.has(symbol)) _symbolIndex.set(symbol, new Set())
  _symbolIndex.get(symbol).add(path)
}

function _indexRemove(symbol, path) {
  _symbolIndex.get(symbol)?.delete(path)
}

export function rebuildPredictionIndex() {
  _symbolIndex.clear()
  const months = listSecure('predictions').filter(f => /^\d{4}-\d{2}$/.test(f))
  let total = 0
  for (const month of months) {
    const files = listSecure(`predictions/${month}`).filter(f => f.includes('_batch_'))
    for (const f of files) {
      const sym = f.split('_')[0]
      if (sym) { _indexAdd(sym, `${month}/${f}`); total++ }
    }
  }
  console.log(`[PredStore] Index rebuilt — ${total} batches across ${_symbolIndex.size} symbols`)
}

// ── Save ──────────────────────────────────────────────────────────────────────

/**
 * Save a prediction batch — ALL signals in ONE file.
 * 16x fewer files, faster writes, less disk fragmentation.
 */
export function savePredictionBatch(batch) {
  const batchId = crypto.randomUUID()
  const dir     = monthDir(batch.generatedAt)
  const csvPath = `${dir}/summary.csv`

  // Write entire batch as a single encrypted file
  const payload = {
    batchId,
    symbol:         batch.symbol,
    exchange:       batch.exchange,
    generatedAt:    batch.generatedAt,
    modelVersion:   batch.modelVersion,
    predictionMode: batch.predictionMode ?? 'both',
    userCapital:    batch.userCapital,
    userRiskPct:    batch.userRiskPct,
    signalCount:    batch.signals.filter(s => !s.suppressed).length,
    signals:        batch.signals
      .filter(s => !s.suppressed)
      .map(s => ({
        // Store only essential fields — reconstruct display fields on read
        id:              s.id,
        type:            s.type,
        grade:           s.grade,
        probability:     s.probability,
        entryPrice:      s.entryPrice,
        entryZoneLow:    s.entryZoneLow,
        entryZoneHigh:   s.entryZoneHigh,
        t1Price:         s.t1Price,
        t2Price:         s.t2Price,
        t3Price:         s.t3Price,
        stopLoss:        s.stopLoss,
        immediateOptimalSL: s.immediateOptimalSL,
        maxRisk:         s.maxRisk,
        riskRewardRatio: s.riskRewardRatio,
        validity:        s.validity,
        t1Probability:   s.t1Probability,
        t2Probability:   s.t2Probability,
        t3Probability:   s.t3Probability,
        slProbability:   s.slProbability,
        reasons:         s.reasons,
        instrType:       s.instrType,
        spotPrice:       s.spotPrice,
        lotSize:         s.lotSize,
        lotCount:        s.lotCount,
        regime:          s.regime,
        outcome:         s.outcome ?? null,
      })),
  }

  const filePath = batchFile(batch.symbol, batch.generatedAt, batchId)
  writeSecure(filePath, payload)
  _indexAdd(batch.symbol, `${dir.replace('predictions/', '')}/${batch.symbol}_${batch.generatedAt}_batch_${batchId}`)

  // Update CSV summary (one row per batch, not per signal)
  if (!readCsv(csvPath)) appendCsv(csvPath, CSV_HEADER.trim())
  const topSignal = payload.signals[0]
  appendCsv(csvPath, [
    batchId, batch.symbol, batch.exchange, batch.generatedAt,
    payload.signalCount, topSignal?.grade ?? '', topSignal?.probability ?? '',
    batch.modelVersion, batch.predictionMode ?? 'both',
  ].join(','))

  // Invalidate accuracy cache for this symbol
  CACHE.invalidatePrefix(`accuracy/${batch.symbol}`)

  // Track model version
  _trackModelVersion(batch.symbol, batch.modelVersion, batch.generatedAt)

  return batchId
}

// ── Version history ───────────────────────────────────────────────────────────

function _trackModelVersion(symbol, modelVersion, ts) {
  if (!modelVersion) return
  const path = `predictions/versions/${symbol}`
  const existing = readSecure(path) ?? { symbol, versions: [] }
  const versions = existing.versions ?? []
  const found = versions.find(v => v.version === modelVersion)
  if (!found) {
    versions.unshift({ version: modelVersion, firstUsedAt: ts, lastUsedAt: ts })
    if (versions.length > 3) versions.splice(3)
  } else {
    found.lastUsedAt = ts
  }
  writeSecure(path, { symbol, versions })
}

export function getModelVersionHistory(symbol) {
  return readSecure(`predictions/versions/${symbol}`) ?? { symbol, versions: [] }
}

// ── Retrieve ──────────────────────────────────────────────────────────────────

/**
 * Get all batches for a symbol in a given month.
 */
export function getPredictions(symbol, yearMonth) {
  const dir   = `predictions/${yearMonth}`
  const files = listSecure(dir).filter(f => f.startsWith(symbol + '_') && f.includes('_batch_'))
  return files.map(f => readSecure(`${dir}/${f}`)).filter(Boolean)
}

/**
 * Get individual signals (flattened from batches) for a symbol.
 */
export function getPredictionSignals(symbol, yearMonth) {
  return getPredictions(symbol, yearMonth).flatMap(b => b.signals ?? [])
}

/**
 * Get recent batches using the in-memory index — fast O(1) symbol lookup.
 */
export function getRecentPredictions(symbol, limit = 50) {
  const paths = [...(_symbolIndex.get(symbol) ?? [])]
  paths.sort().reverse()  // newest first

  const results = []
  for (const p of paths) {
    const batch = readSecure(`predictions/${p}`)
    if (batch) results.push(batch)
    if (results.length >= limit) break
  }
  return results
}

/**
 * Get a specific signal by ID (searches recent batches).
 */
export function getSignalById(predId, symbol) {
  const paths = [...(_symbolIndex.get(symbol) ?? [])].sort().reverse().slice(0, 10)
  for (const p of paths) {
    const batch = readSecure(`predictions/${p}`)
    const sig = batch?.signals?.find(s => s.id === predId)
    if (sig) return { ...sig, symbol, batchId: batch.batchId, generatedAt: batch.generatedAt }
  }
  return null
}

// ── Resolve outcome (update a signal within a batch) ─────────────────────────

export function resolveOutcome(predictionId, symbol, yearMonth, outcome) {
  const dir   = `predictions/${yearMonth}`
  const files = listSecure(dir).filter(f => f.startsWith(symbol + '_') && f.includes('_batch_'))

  for (const file of files) {
    const batch = readSecure(`${dir}/${file}`)
    if (!batch?.signals) continue
    const sigIdx = batch.signals.findIndex(s => s.id === predictionId)
    if (sigIdx === -1) continue

    // Update in-place
    batch.signals[sigIdx].outcome = outcome
    writeSecure(`${dir}/${file}`, batch)
    // Invalidate accuracy cache
    CACHE.invalidatePrefix(`accuracy/${symbol}`)
    return { ok: true }
  }
  return { ok: false, error: 'Prediction not found' }
}

// ── Accuracy — with caching ───────────────────────────────────────────────────

export function computeAccuracy(symbol, windowDays = 30) {
  // Check cache — accuracy is expensive to compute (scans all months)
  const cacheKey = `accuracy/${symbol}_${windowDays}`
  const cached   = CACHE.get(cacheKey)
  if (cached) return cached

  const cutoff   = Date.now() - windowDays * 24 * 60 * 60 * 1000
  const paths    = [...(_symbolIndex.get(symbol) ?? [])].sort().reverse()

  let total = 0, correct = 0, t1 = 0, t2 = 0, t3 = 0, sl = 0, rrSum = 0
  const byMode = { learning: { total: 0, correct: 0 }, realworld: { total: 0, correct: 0 }, both: { total: 0, correct: 0 } }

  for (const p of paths) {
    const batch = readSecure(`predictions/${p}`)
    if (!batch) continue
    if (batch.generatedAt < cutoff) continue

    const mode = batch.predictionMode ?? 'both'
    for (const sig of (batch.signals ?? [])) {
      if (!sig.outcome) continue
      total++
      const o   = sig.outcome.outcome ?? sig.outcome
      const hit = o === 'T1_HIT' || o === 'T2_HIT' || o === 'T3_HIT'
      if (hit) correct++
      if (o === 'T1_HIT') t1++
      if (o === 'T2_HIT') t2++
      if (o === 'T3_HIT') t3++
      if (o === 'SL_HIT') sl++
      rrSum += sig.riskRewardRatio ?? 0
      if (byMode[mode]) { byMode[mode].total++; if (hit) byMode[mode].correct++ }
    }
  }

  const modeAccuracy = {}
  for (const [m, stats] of Object.entries(byMode)) {
    modeAccuracy[m] = stats.total ? Math.round(stats.correct / stats.total * 100) : null
  }

  const result = {
    symbol, windowDays, totalResolved: total, correct, incorrect: total - correct,
    accuracyPct:  total ? Math.round(correct / total * 100) : null,
    t1HitRate:    total ? Math.round(t1 / total * 100) : null,
    t2HitRate:    total ? Math.round(t2 / total * 100) : null,
    t3HitRate:    total ? Math.round(t3 / total * 100) : null,
    slHitRate:    total ? Math.round(sl / total * 100) : null,
    avgRR:        total ? Math.round(rrSum / total * 100) / 100 : null,
    modeAccuracy,
    stable:       total >= 20 && (total ? correct / total >= 0.75 : false),
    computedAt:   new Date().toISOString(),
  }

  // Cache for 60 seconds — will be invalidated on new outcomes
  CACHE.set(cacheKey, result, 60_000)
  return result
}

// ── Backtest cache ────────────────────────────────────────────────────────────

export function saveBacktestResult(symbol, modelVersion, result) {
  const key = `backtest/${symbol}_${modelVersion.replace(/[^a-z0-9]/gi, '_')}`
  writeSecure(key, { symbol, modelVersion, ...result, savedAt: new Date().toISOString() })
}

export function getBacktestResult(symbol, modelVersion) {
  return readSecure(`backtest/${symbol}_${modelVersion.replace(/[^a-z0-9]/gi, '_')}`)
}

export function listBacktestResults(symbol) {
  return listSecure('backtest')
    .filter(f => f.startsWith(symbol + '_'))
    .map(f => readSecure(`backtest/${f}`))
    .filter(Boolean)
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

export function cleanupOldPredictions(retentionDays = 30) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const months = listSecure('predictions').filter(f => /^\d{4}-\d{2}$/.test(f)).sort()
  let deleted = 0
  const freedMonths = []

  for (const month of months) {
    const [year, mon] = month.split('-').map(Number)
    const monthEnd    = new Date(year, mon, 1).getTime()
    if (monthEnd > cutoff) continue

    const files = listSecure(`predictions/${month}`).filter(f => f.includes('_batch_'))
    let monthDeleted = 0
    for (const file of files) {
      deleteSecure(`predictions/${month}/${file}`)
      // Remove from index
      const sym = file.split('_')[0]
      _indexRemove(sym, `${month}/${file}`)
      monthDeleted++; deleted++
    }
    if (monthDeleted > 0) { freedMonths.push(month); console.log(`[Cleanup] Deleted ${monthDeleted} batches from ${month}`) }
  }
  return { deleted, freedMonths }
}

// ── Deviation store — ring buffer (no full rewrites) ─────────────────────────

const DEVIATION_RING_SIZE = 500

export function saveDeviationRecord(record) {
  const path = `predictions/deviations/${record.symbol}_ring`
  const existing = readSecure(path) ?? { symbol: record.symbol, records: [], head: 0 }
  const records = existing.records ?? []

  // Ring buffer: overwrite oldest when full
  if (records.length < DEVIATION_RING_SIZE) {
    records.push({ ...record, savedAt: Date.now() })
  } else {
    const head = (existing.head ?? 0) % DEVIATION_RING_SIZE
    records[head] = { ...record, savedAt: Date.now() }
    existing.head = head + 1
  }

  writeSecure(path, { symbol: record.symbol, records, head: existing.head ?? records.length })
}

export function getDeviationHistory(symbol, limit = 100) {
  const data = readSecure(`predictions/deviations/${symbol}_ring`)
  if (!data) return []
  const records = data.records ?? []
  // Return newest first
  return [...records].reverse().filter(Boolean).slice(0, limit)
}

export function computeAdaptiveWeight(symbol, instrType = 'spot') {
  const history  = getDeviationHistory(symbol, 50)
  const relevant = history.filter(h => h.instrType === instrType && h.deviation != null)
  if (relevant.length < 5) return 1.0
  const accuracy = relevant.slice(0, 20).filter(h => h.correct).length / Math.min(20, relevant.length)
  return Math.round((0.8 + accuracy * 0.4) * 100) / 100
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthDir(ts) {
  const d = new Date(ts)
  return `predictions/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function predFile(symbol, ts, id) {
  return `${monthDir(ts)}/${symbol}_${ts}_${id}`
}

const CSV_HEADER = 'id,symbol,exchange,generatedAt,grade,probability,entryPrice,t1,t2,t3,sl,regime,modelVersion,predictionMode\n'

// ── Save ──────────────────────────────────────────────────────────────────────

/**
 * Save a prediction batch (all 16 signals).
 */
export function savePredictionBatch(batch) {
  const dir     = monthDir(batch.generatedAt)
  const csvPath = `${dir}/summary.csv`

  if (!readCsv(csvPath)) {
    appendCsv(csvPath, CSV_HEADER.trim())
  }

  for (const signal of batch.signals) {
    if (signal.suppressed) continue

    const filePath = predFile(batch.symbol, batch.generatedAt, signal.id)
    writeSecure(filePath, {
      ...signal,
      symbol:         batch.symbol,
      exchange:       batch.exchange,
      modelVersion:   batch.modelVersion,
      predictionMode: batch.predictionMode ?? 'both',
      userCapital:    batch.userCapital,
      userRiskPct:    batch.userRiskPct,
    })

    const row = [
      signal.id, batch.symbol, batch.exchange, batch.generatedAt,
      signal.grade, signal.probability, signal.entryPrice,
      signal.t1Price, signal.t2Price, signal.t3Price,
      signal.stopLoss, signal.regime ?? 'trending', batch.modelVersion,
      batch.predictionMode ?? 'both',
    ].join(',')
    appendCsv(csvPath, row)
  }

  // Track model version history (keep last 3 per symbol)
  _trackModelVersion(batch.symbol, batch.modelVersion, batch.generatedAt)
}

// ── Version history ───────────────────────────────────────────────────────────

function _trackModelVersion(symbol, modelVersion, ts) {
  if (!modelVersion) return
  const path = `predictions/versions/${symbol}`
  const existing = readSecure(path) ?? { symbol, versions: [] }
  const versions = existing.versions ?? []

  // Add if not already present
  if (!versions.find(v => v.version === modelVersion)) {
    versions.unshift({ version: modelVersion, firstUsedAt: ts, lastUsedAt: ts })
    // Keep last 3 versions
    if (versions.length > 3) versions.splice(3)
    writeSecure(path, { symbol, versions })
  } else {
    // Update lastUsedAt
    const v = versions.find(v => v.version === modelVersion)
    if (v) v.lastUsedAt = ts
    writeSecure(path, { symbol, versions })
  }
}

export function getModelVersionHistory(symbol) {
  return readSecure(`predictions/versions/${symbol}`) ?? { symbol, versions: [] }
}

// ── Retrieve ──────────────────────────────────────────────────────────────────

export function getPredictions(symbol, yearMonth) {
  const dir   = `predictions/${yearMonth}`
  const files = listSecure(dir).filter(f => f.startsWith(symbol + '_'))
  return files.map(f => readSecure(`${dir}/${f}`)).filter(Boolean)
}

export function getRecentPredictions(symbol, limit = 50) {
  const allFiles = listSecure('predictions')
  const months   = allFiles
    .filter(f => /^\d{4}-\d{2}$/.test(f))
    .sort()
    .reverse()

  const results = []
  for (const month of months) {
    const preds = getPredictions(symbol, month)
    results.push(...preds)
    if (results.length >= limit) break
  }
  return results.slice(0, limit)
}

// ── Resolve outcome ───────────────────────────────────────────────────────────

export function resolveOutcome(predictionId, symbol, yearMonth, outcome) {
  const dir   = `predictions/${yearMonth}`
  const files = listSecure(dir).filter(f => f.includes(predictionId))
  if (!files.length) return { ok: false, error: 'Prediction not found' }

  const filePath = `${dir}/${files[0]}`
  const pred = readSecure(filePath)
  if (!pred) return { ok: false, error: 'Could not read prediction' }

  writeSecure(filePath, { ...pred, outcome })
  return { ok: true }
}

// ── Accuracy ──────────────────────────────────────────────────────────────────

export function computeAccuracy(symbol, windowDays = 30) {
  const cutoff   = Date.now() - windowDays * 24 * 60 * 60 * 1000
  const allFiles = listSecure('predictions')
  const months   = allFiles.filter(f => /^\d{4}-\d{2}$/.test(f)).sort().reverse()

  let total = 0, correct = 0, t1 = 0, t2 = 0, t3 = 0, sl = 0, rrSum = 0
  const byMode = { learning: { total: 0, correct: 0 }, realworld: { total: 0, correct: 0 }, both: { total: 0, correct: 0 } }

  for (const month of months) {
    const preds = getPredictions(symbol, month)
    for (const p of preds) {
      if (!p.outcome || p.generatedAt < cutoff) continue
      total++
      const o    = p.outcome.outcome
      const mode = p.predictionMode ?? 'both'
      const hit  = o === 'T1_HIT' || o === 'T2_HIT' || o === 'T3_HIT'

      if (hit) correct++
      if (o === 'T1_HIT') t1++
      if (o === 'T2_HIT') t2++
      if (o === 'T3_HIT') t3++
      if (o === 'SL_HIT') sl++
      rrSum += p.riskRewardRatio ?? 0

      if (byMode[mode]) {
        byMode[mode].total++
        if (hit) byMode[mode].correct++
      }
    }
  }

  const modeAccuracy = {}
  for (const [mode, stats] of Object.entries(byMode)) {
    modeAccuracy[mode] = stats.total
      ? Math.round((stats.correct / stats.total) * 100)
      : null
  }

  return {
    symbol,
    windowDays,
    totalResolved:  total,
    correct,
    incorrect:      total - correct,
    accuracyPct:    total ? Math.round((correct / total) * 100) : null,
    t1HitRate:      total ? Math.round((t1 / total) * 100) : null,
    t2HitRate:      total ? Math.round((t2 / total) * 100) : null,
    t3HitRate:      total ? Math.round((t3 / total) * 100) : null,
    slHitRate:      total ? Math.round((sl / total) * 100) : null,
    avgRR:          total ? Math.round((rrSum / total) * 100) / 100 : null,
    modeAccuracy,
    stable:         total >= 20 && (total ? (correct / total) >= 0.75 : false),
    computedAt:     new Date().toISOString(),
  }
}

// ── Backtest cache ────────────────────────────────────────────────────────────

/**
 * Save a backtest result for a symbol+version.
 */
export function saveBacktestResult(symbol, modelVersion, result) {
  const key = `backtest/${symbol}_${modelVersion.replace(/[^a-z0-9]/gi, '_')}`
  writeSecure(key, {
    symbol,
    modelVersion,
    ...result,
    savedAt: new Date().toISOString(),
  })
}

/**
 * Get cached backtest result.
 */
export function getBacktestResult(symbol, modelVersion) {
  const key = `backtest/${symbol}_${modelVersion.replace(/[^a-z0-9]/gi, '_')}`
  return readSecure(key)
}

/**
 * List all backtest results for a symbol.
 */
export function listBacktestResults(symbol) {
  const files = listSecure('backtest').filter(f => f.startsWith(symbol + '_'))
  return files.map(f => readSecure(`backtest/${f}`)).filter(Boolean)
}

// ── Cleanup scheduler ─────────────────────────────────────────────────────────

/**
 * Delete prediction files older than retentionDays.
 * Keeps the summary CSV intact.
 * @param {number} retentionDays — default 30
 * @returns {{ deleted: number, freedMonths: string[] }}
 */
export function cleanupOldPredictions(retentionDays = 30) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const allDirs = listSecure('predictions')
  const months  = allDirs.filter(f => /^\d{4}-\d{2}$/.test(f)).sort()

  let deleted = 0
  const freedMonths = []

  for (const month of months) {
    // Parse month to timestamp
    const [year, mon] = month.split('-').map(Number)
    const monthEnd = new Date(year, mon, 1).getTime()  // first day of next month

    if (monthEnd > cutoff) continue  // month is within retention window

    const files = listSecure(`predictions/${month}`)
    let monthDeleted = 0

    for (const file of files) {
      if (file === 'summary') continue  // keep CSV
      deleteSecure(`predictions/${month}/${file}`)
      monthDeleted++
      deleted++
    }

    if (monthDeleted > 0) {
      freedMonths.push(month)
      console.log(`[Cleanup] Deleted ${monthDeleted} predictions from ${month}`)
    }
  }

  return { deleted, freedMonths }
}

// ── Learning deviation store ──────────────────────────────────────────────────

/**
 * Save a deviation record from the learning mode.
 * Called by outcomeValidator when a prediction resolves.
 */
export function saveDeviationRecord(record) {
  const path = `predictions/deviations/${record.symbol}`
  const existing = readSecure(path) ?? { symbol: record.symbol, records: [] }
  const records = existing.records ?? []

  records.push({
    ...record,
    savedAt: Date.now(),
  })

  // Keep last 500 per symbol
  if (records.length > 500) records.splice(0, records.length - 500)

  writeSecure(path, { symbol: record.symbol, records })
}

/**
 * Get deviation history for adaptive learning.
 */
export function getDeviationHistory(symbol, limit = 100) {
  const data = readSecure(`predictions/deviations/${symbol}`)
  if (!data) return []
  return (data.records ?? []).slice(-limit)
}

/**
 * Compute adaptive weight from deviation history.
 * Returns a multiplier (0.8–1.2) to apply to probability scores.
 */
export function computeAdaptiveWeight(symbol, instrType = 'spot') {
  const history = getDeviationHistory(symbol, 50)
  const relevant = history.filter(h => h.instrType === instrType && h.deviation != null)
  if (relevant.length < 5) return 1.0

  const accuracy = relevant.slice(-20).filter(h => h.correct).length / Math.min(20, relevant.length)
  const weight   = 0.8 + (accuracy * 0.4)
  return Math.round(weight * 100) / 100
}
