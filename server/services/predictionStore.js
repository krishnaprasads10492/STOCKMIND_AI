/**
 * predictionStore.js — save, retrieve, resolve predictions, and manage history.
 *
 * Storage layout:
 *   data/predictions/YYYY-MM/{SYMBOL}_{ts}_{id}.enc  — full payload (AES-256-GCM)
 *   data/predictions/YYYY-MM/summary.csv             — append-only summary
 *   data/backtest/{SYMBOL}_{version}.enc             — backtest result cache
 *   data/predictions/versions/{SYMBOL}.enc           — last 3 model versions per symbol
 *
 * Cleanup: configurable per-user, default 30 days.
 */

import crypto from 'crypto'
import { writeSecure, readSecure, listSecure, deleteSecure, appendCsv, readCsv } from '../storage/fileStore.js'

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
