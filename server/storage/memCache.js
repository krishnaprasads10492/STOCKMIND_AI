/**
 * memCache.js — In-memory LRU cache with TTL for hot storage paths.
 *
 * Sits in front of fileStore.js to avoid repeated decrypt + HMAC verify
 * for frequently read data (user sessions, deviation history, accuracy, etc.).
 *
 * Design:
 *   - LRU eviction: least recently used item evicted when capacity reached
 *   - Per-entry TTL: entries expire after their individual TTL
 *   - Namespace invalidation: clear all keys matching a prefix
 *   - Zero-copy reads: returns the cached object directly (don't mutate!)
 *   - Stats: hits, misses, evictions for monitoring
 *
 * Capacity / TTL defaults (tuned for StockMind data sizes):
 *   users:         small,  long TTL  — rarely change
 *   predictions:   large,  medium    — resolved outcomes change them
 *   accuracy:      small,  short     — recomputed often
 *   ami:           medium, medium
 *   system:        small,  long
 */

const DEFAULT_CAPACITY = 2000   // max entries across all namespaces
const DEFAULT_TTL_MS   = 5 * 60 * 1000  // 5 minutes

// ── TTL config per namespace prefix ──────────────────────────────────────────
const TTL_BY_PREFIX = {
  'users/':          30 * 60 * 1000,   // 30 min — user prefs change rarely
  'predictions/versions/': 15 * 60 * 1000,  // 15 min
  'predictions/deviations/': 2 * 60 * 1000, // 2 min — updated on every outcome
  'predictions/':    5 * 60 * 1000,    // 5 min
  'backtest/':       60 * 60 * 1000,   // 1 hour — expensive to recompute
  'ami/':            3 * 60 * 1000,    // 3 min
  'system/':         10 * 60 * 1000,   // 10 min
  'accuracy/':       60 * 1000,        // 1 min — changes on each outcome
}

function getTTL(key) {
  for (const [prefix, ttl] of Object.entries(TTL_BY_PREFIX)) {
    if (key.startsWith(prefix)) return ttl
  }
  return DEFAULT_TTL_MS
}

// ── LRU Cache implementation ──────────────────────────────────────────────────

class LRUCache {
  constructor(capacity = DEFAULT_CAPACITY) {
    this._capacity = capacity
    this._map      = new Map()   // key → { value, expiresAt, hits }
    this._order    = []          // insertion/access order (oldest first)
    this.stats     = { hits: 0, misses: 0, evictions: 0, expired: 0, sets: 0 }
  }

  get(key) {
    const entry = this._map.get(key)
    if (!entry) {
      this.stats.misses++
      return undefined
    }
    if (Date.now() > entry.expiresAt) {
      // Expired
      this._map.delete(key)
      this._order.splice(this._order.indexOf(key), 1)
      this.stats.expired++
      this.stats.misses++
      return undefined
    }
    // LRU: move to end (most recently used)
    this._order.splice(this._order.indexOf(key), 1)
    this._order.push(key)
    entry.hits++
    this.stats.hits++
    return entry.value
  }

  set(key, value, ttlMs) {
    const ttl    = ttlMs ?? getTTL(key)
    const entry  = { value, expiresAt: Date.now() + ttl, hits: 0 }
    this.stats.sets++

    if (this._map.has(key)) {
      this._order.splice(this._order.indexOf(key), 1)
    } else if (this._map.size >= this._capacity) {
      this._evict()
    }

    this._map.set(key, entry)
    this._order.push(key)
  }

  delete(key) {
    if (!this._map.has(key)) return false
    this._map.delete(key)
    this._order.splice(this._order.indexOf(key), 1)
    return true
  }

  invalidatePrefix(prefix) {
    let count = 0
    for (const key of [...this._map.keys()]) {
      if (key.startsWith(prefix)) {
        this._map.delete(key)
        this._order.splice(this._order.indexOf(key), 1)
        count++
      }
    }
    return count
  }

  _evict() {
    // Evict oldest entry
    const oldest = this._order.shift()
    if (oldest) {
      this._map.delete(oldest)
      this.stats.evictions++
    }
  }

  clear() {
    this._map.clear()
    this._order.length = 0
  }

  getStats() {
    const total     = this.stats.hits + this.stats.misses
    const hitRate   = total ? Math.round(this.stats.hits / total * 100) : 0
    return {
      size:      this._map.size,
      capacity:  this._capacity,
      ...this.stats,
      hitRatePct: hitRate,
      totalRequests: total,
    }
  }

  // Periodic cleanup of expired entries (call every few minutes)
  purgeExpired() {
    const now     = Date.now()
    let purged    = 0
    for (const [key, entry] of this._map.entries()) {
      if (now > entry.expiresAt) {
        this._map.delete(key)
        this._order.splice(this._order.indexOf(key), 1)
        purged++
        this.stats.expired++
      }
    }
    return purged
  }
}

// Singleton cache
export const CACHE = new LRUCache(DEFAULT_CAPACITY)

// Auto-purge expired entries every 2 minutes
setInterval(() => {
  const purged = CACHE.purgeExpired()
  if (purged > 0) {
    console.log(`[MemCache] Purged ${purged} expired entries. Size: ${CACHE._map.size}`)
  }
}, 2 * 60 * 1000)

export default CACHE
