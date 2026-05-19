/**
 * amiStore.js — Advanced Market Intelligence data store.
 *
 * Stores AMI records under data/ami/{symbol}/{type}/ using encrypted file storage.
 * Types: scenarios | trendlines | danger-log | mtf-signals
 *
 * Maintains in-memory index per symbol per type (rebuilt on startup).
 * Auto-archives records older than 90 days when count > 500.
 */

import crypto from 'crypto'
import { writeSecure, readSecure, listSecure, deleteSecure } from '../storage/fileStore.js'

const VALID_TYPES = ['scenarios', 'trendlines', 'danger-log', 'mtf-signals']
const ARCHIVE_THRESHOLD = 500
const ARCHIVE_AGE_DAYS  = 90

// ── In-memory index: symbol → type → Set<id> ─────────────────────────────────
const _index = new Map()

function indexKey(symbol, type) {
  return `${symbol}::${type}`
}

function getIndex(symbol, type) {
  const k = indexKey(symbol, type)
  if (!_index.has(k)) _index.set(k, new Set())
  return _index.get(k)
}

function addToIndex(symbol, type, id) {
  getIndex(symbol, type).add(id)
}

function removeFromIndex(symbol, type, id) {
  getIndex(symbol, type).delete(id)
}

// ── Startup: rebuild index from disk ─────────────────────────────────────────

export function rebuildAMIIndex() {
  let total = 0
  try {
    const symbols = listSecure('ami')
    for (const symbol of symbols) {
      for (const type of VALID_TYPES) {
        const ids = listSecure(`ami/${symbol}/${type}`)
        for (const id of ids) {
          addToIndex(symbol, type, id)
          total++
        }
      }
    }
    console.log(`[AMIStore] Index rebuilt — ${total} records across ${symbols.length} symbols`)
  } catch (err) {
    console.warn('[AMIStore] Index rebuild warning:', err.message)
  }
}

// ── Auto-archive ──────────────────────────────────────────────────────────────

function autoArchive(symbol, type) {
  const idx = getIndex(symbol, type)
  if (idx.size <= ARCHIVE_THRESHOLD) return

  const cutoff = Date.now() - ARCHIVE_AGE_DAYS * 86_400_000
  const toDelete = []

  for (const id of idx) {
    const record = readSecure(`ami/${symbol}/${type}/${id}`)
    if (!record) { toDelete.push(id); continue }
    const ts = record.timestamp ?? record.ts ?? record.createdAt ?? 0
    if (ts < cutoff) toDelete.push(id)
  }

  for (const id of toDelete) {
    try {
      deleteSecure(`ami/${symbol}/${type}/${id}`)
      removeFromIndex(symbol, type, id)
    } catch { /* non-fatal */ }
  }

  if (toDelete.length > 0) {
    console.log(`[AMIStore] Archived ${toDelete.length} old ${type} records for ${symbol}`)
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Write an AMI record.
 * @param {string} symbol
 * @param {string} type
 * @param {object} record — must have an `id` field (or one will be generated)
 * @returns {string} id
 */
export function writeAMI(symbol, type, record) {
  if (!VALID_TYPES.includes(type)) throw new Error(`Invalid AMI type: ${type}`)
  const id = record.id ?? crypto.randomUUID()
  const enriched = { ...record, id, symbol, type, timestamp: record.timestamp ?? Date.now() }
  writeSecure(`ami/${symbol}/${type}/${id}`, enriched)
  addToIndex(symbol, type, id)
  autoArchive(symbol, type)
  return id
}

/**
 * Read a single AMI record.
 * @param {string} symbol
 * @param {string} type
 * @param {string} id
 * @returns {object|null}
 */
export function readAMI(symbol, type, id) {
  if (!VALID_TYPES.includes(type)) return null
  return readSecure(`ami/${symbol}/${type}/${id}`)
}

/**
 * List AMI records for a symbol/type.
 * @param {string} symbol
 * @param {string} type
 * @param {{ limit?: number, since?: number, sortBy?: 'timestamp' }} opts
 * @returns {object[]}
 */
export function listAMI(symbol, type, opts = {}) {
  if (!VALID_TYPES.includes(type)) return []
  const { limit = 100, since = 0, sortBy = 'timestamp' } = opts

  const ids = [...getIndex(symbol, type)]
  const records = []

  for (const id of ids) {
    const rec = readSecure(`ami/${symbol}/${type}/${id}`)
    if (!rec) continue
    const ts = rec.timestamp ?? rec.ts ?? 0
    if (ts < since) continue
    records.push(rec)
  }

  records.sort((a, b) => {
    const aTs = a.timestamp ?? a.ts ?? 0
    const bTs = b.timestamp ?? b.ts ?? 0
    return bTs - aTs  // newest first
  })

  return records.slice(0, limit)
}

/**
 * Get AMI summary for a symbol.
 * @param {string} symbol
 * @returns {{ scenarioCount, latestScenarioDate, trendlineCount, dangerCount30d, latestMtfSignalTs }}
 */
export function getAMISummary(symbol) {
  const scenarios  = listAMI(symbol, 'scenarios',   { limit: 1000 })
  const trendlines = listAMI(symbol, 'trendlines',  { limit: 1000 })
  const dangerLog  = listAMI(symbol, 'danger-log',  { limit: 1000 })
  const mtfSignals = listAMI(symbol, 'mtf-signals', { limit: 1 })

  const cutoff30d = Date.now() - 30 * 86_400_000
  const dangerCount30d = dangerLog.filter(r => (r.timestamp ?? 0) >= cutoff30d).length

  const latestScenario = scenarios[0]
  const latestMtf      = mtfSignals[0]

  return {
    scenarioCount:      scenarios.length,
    latestScenarioDate: latestScenario ? new Date(latestScenario.timestamp).toISOString() : null,
    trendlineCount:     trendlines.length,
    dangerCount30d,
    latestMtfSignalTs:  latestMtf?.timestamp ?? null,
  }
}

/**
 * Delete an AMI record.
 * @param {string} symbol
 * @param {string} type
 * @param {string} id
 * @returns {boolean}
 */
export function deleteAMI(symbol, type, id) {
  if (!VALID_TYPES.includes(type)) return false
  try {
    deleteSecure(`ami/${symbol}/${type}/${id}`)
    removeFromIndex(symbol, type, id)
    return true
  } catch {
    return false
  }
}
