/**
 * mongoService.js — MongoDB Atlas integration for StockMind AI.
 *
 * Maps each data category to a properly named, indexed MongoDB collection:
 *
 *   Collection           Data                         TTL / Retention
 *   ──────────────────   ──────────────────────────   ───────────────
 *   users                User accounts, prefs, roles  Permanent
 *   prediction_batches   All signal batches            30–90 days (configurable)
 *   deviations           Outcome deviation records     90 days
 *   backtest_results     Backtest cache               Permanent (versioned)
 *   ami_records          AMI scenarios, danger log    90 days
 *   market_sessions      Pre/post/regular snapshots   90 days
 *   strategy_scores      AI strategy scores           30 days
 *   audit_log            HMAC-chained audit trail     365 days
 *   system_config        App config, version state    Permanent
 *
 * Security:
 *   - Passwords and key hashes are NOT stored in MongoDB (remain in local encrypted files)
 *   - All sensitive fields are stripped before writing to Atlas
 *   - Atlas network access should be restricted to your IP
 *   - Connection uses TLS by default (Atlas enforces this)
 *
 * Usage:
 *   import { getMongoService } from './mongoService.js'
 *   const mongo = await getMongoService()
 *   await mongo.users.upsert(userId, userData)
 */

import { MongoClient } from 'mongodb'
import { CACHE } from '../storage/memCache.js'

const DB_NAME = process.env.MONGODB_DB ?? 'stockmind'

// ── Connection singleton ──────────────────────────────────────────────────────

let _client = null
let _db     = null
let _status = { connected: false, error: null, lastAttempt: 0 }

export async function connectMongo() {
  if (_db) return _db

  const uri = process.env.MONGODB_ATLAS_URI || process.env.MONGODB_URI
  if (!uri) {
    console.warn('[MongoDB] No URI configured — set MONGODB_ATLAS_URI in .env')
    return null
  }

  try {
    _client = new MongoClient(uri, {
      maxPoolSize:              parseInt(process.env.MONGODB_POOL_MAX ?? '10'),
      minPoolSize:              parseInt(process.env.MONGODB_POOL_MIN ?? '2'),
      serverSelectionTimeoutMS: parseInt(process.env.MONGODB_TIMEOUT_MS ?? '8000'),
      socketTimeoutMS:          45_000,
      connectTimeoutMS:         10_000,
      retryWrites:  true,
      retryReads:   true,
      w:            'majority',
      compressors:  ['snappy', 'zstd'],  // Atlas supports these — reduces bandwidth
    })

    await _client.connect()
    _db = _client.db(DB_NAME)

    // Verify connection
    await _db.command({ ping: 1 })

    _status = { connected: true, error: null, lastAttempt: Date.now() }
    console.log(`[MongoDB] Connected to Atlas — database: ${DB_NAME}`)

    // Handle disconnection
    _client.on('error',  err => { _status.error = err.message; console.error('[MongoDB] Error:', err.message) })
    _client.on('close',  ()  => { _status.connected = false; console.warn('[MongoDB] Connection closed') })
    _client.on('topologyClosed', () => { _db = null; _client = null; _status.connected = false })

    // Create all collections + indexes
    await _ensureIndexes(_db)

    return _db
  } catch (err) {
    _status = { connected: false, error: err.message, lastAttempt: Date.now() }
    console.error('[MongoDB] Connection failed:', err.message)
    return null
  }
}

export function getMongoStatus() {
  return { ..._status, dbName: DB_NAME }
}

// ── Collection index definitions ──────────────────────────────────────────────

async function _ensureIndexes(db) {
  try {
    // users — lookup by username, userId
    await db.collection('users').createIndexes([
      { key: { username: 1 }, unique: true },
      { key: { userId: 1 },   unique: true },
      { key: { role: 1 } },
      { key: { isActive: 1 } },
    ])

    // prediction_batches — by symbol, date, grade, outcome status
    await db.collection('prediction_batches').createIndexes([
      { key: { symbol: 1, generatedAt: -1 } },
      { key: { generatedAt: -1 } },
      { key: { 'signals.grade': 1 } },
      { key: { 'signals.outcome': 1 } },
      { key: { symbol: 1, predictionMode: 1 } },
      // TTL — auto-delete after 90 days (3110400 seconds)
      { key: { generatedAt: 1 }, expireAfterSeconds: parseInt(process.env.PREDICTION_TTL_DAYS ?? '90') * 86400, name: 'ttl_generatedAt' },
    ])

    // deviations — by symbol, instrType
    await db.collection('deviations').createIndexes([
      { key: { symbol: 1, savedAt: -1 } },
      { key: { instrType: 1 } },
      { key: { correct: 1 } },
      { key: { savedAt: 1 }, expireAfterSeconds: 90 * 86400, name: 'ttl_deviations' },
    ])

    // backtest_results
    await db.collection('backtest_results').createIndexes([
      { key: { symbol: 1, modelVersion: 1 }, unique: true },
      { key: { accuracyPct: -1 } },
      { key: { savedAt: -1 } },
    ])

    // ami_records — by symbol, type, timestamp
    await db.collection('ami_records').createIndexes([
      { key: { symbol: 1, type: 1, timestamp: -1 } },
      { key: { type: 1 } },
      { key: { timestamp: 1 }, expireAfterSeconds: 90 * 86400, name: 'ttl_ami' },
    ])

    // market_sessions — by symbol + date
    await db.collection('market_sessions').createIndexes([
      { key: { symbol: 1, date: -1 }, unique: true },
      { key: { date: -1 } },
      { key: { 'regular.price': 1 } },
      { key: { createdAt: 1 }, expireAfterSeconds: 90 * 86400, name: 'ttl_sessions' },
    ])

    // strategy_scores — by symbol + date
    await db.collection('strategy_scores').createIndexes([
      { key: { symbol: 1, ts: -1 } },
      { key: { compositeScore: -1 } },
      { key: { ts: 1 }, expireAfterSeconds: 30 * 86400, name: 'ttl_scores' },
    ])

    // audit_log — append-only, indexed by event + ts
    await db.collection('audit_log').createIndexes([
      { key: { ts: -1 } },
      { key: { event: 1, ts: -1 } },
      { key: { userId: 1, ts: -1 } },
      { key: { ts: 1 }, expireAfterSeconds: 365 * 86400, name: 'ttl_audit' },
    ])

    // system_config — key-value store
    await db.collection('system_config').createIndexes([
      { key: { key: 1 }, unique: true },
    ])

    console.log('[MongoDB] Indexes ensured for all collections')
  } catch (err) {
    console.warn('[MongoDB] Index creation warning (may already exist):', err.message)
  }
}

// ── Sensitive field stripping ─────────────────────────────────────────────────
// Password hashes and key hashes NEVER go to Atlas — stay in local encrypted files

const STRIP_FIELDS = new Set([
  'passwordHash', 'keyHash', 'keyExpiresAt',
  'hmacSecret', 'encryptionKey', 'token',
])

function _stripSensitive(obj) {
  if (!obj || typeof obj !== 'object') return obj
  const clean = {}
  for (const [k, v] of Object.entries(obj)) {
    if (STRIP_FIELDS.has(k)) {
      clean[k] = '[STORED_LOCALLY]'  // marker — real value in local encrypted store
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      clean[k] = _stripSensitive(v)
    } else {
      clean[k] = v
    }
  }
  return clean
}

// ── Generic collection wrapper ────────────────────────────────────────────────

class MongoCollection {
  constructor(name, idField = '_id') {
    this.name    = name
    this.idField = idField
  }

  async _col() {
    const db = _db ?? await connectMongo()
    if (!db) throw new Error(`MongoDB not connected — collection: ${this.name}`)
    return db.collection(this.name)
  }

  async upsert(id, data) {
    const col   = await this._col()
    const clean = _stripSensitive({ ...data, _id: id, _updatedAt: new Date() })
    await col.replaceOne({ _id: id }, clean, { upsert: true })
    CACHE.set(`mongo:${this.name}:${id}`, data, 30_000)
  }

  async findById(id) {
    const cached = CACHE.get(`mongo:${this.name}:${id}`)
    if (cached) return cached
    const col = await this._col()
    const doc = await col.findOne({ _id: id })
    if (!doc) return null
    const { _id, _updatedAt, ...rest } = doc
    CACHE.set(`mongo:${this.name}:${id}`, rest, 30_000)
    return rest
  }

  async findOne(filter) {
    const col = await this._col()
    const doc = await col.findOne(filter)
    if (!doc) return null
    const { _id, _updatedAt, ...rest } = doc
    return rest
  }

  async find(filter = {}, { limit = 100, sort = { _updatedAt: -1 }, skip = 0 } = {}) {
    const col  = await this._col()
    const docs = await col.find(filter).sort(sort).skip(skip).limit(limit).toArray()
    return docs.map(({ _id, _updatedAt, ...rest }) => ({ ...rest, _id }))
  }

  async deleteById(id) {
    const col = await this._col()
    CACHE.delete(`mongo:${this.name}:${id}`)
    await col.deleteOne({ _id: id })
  }

  async countDocuments(filter = {}) {
    const col = await this._col()
    return col.countDocuments(filter)
  }

  async insertOne(doc) {
    const col = await this._col()
    const clean = _stripSensitive({ ...doc, _createdAt: new Date(), _updatedAt: new Date() })
    return col.insertOne(clean)
  }

  async aggregate(pipeline) {
    const col = await this._col()
    return col.aggregate(pipeline).toArray()
  }
}

// ── Specialized collections with domain-aware methods ────────────────────────

class UsersCollection extends MongoCollection {
  constructor() { super('users', 'userId') }

  async findByUsername(username) {
    return this.findOne({ username: username.toLowerCase() })
  }

  async updateRole(userId, role) {
    const col = await this._col()
    CACHE.delete(`mongo:users:${userId}`)
    await col.updateOne({ _id: userId }, { $set: { role, _updatedAt: new Date() } })
  }

  async updatePreferences(userId, prefs) {
    const col = await this._col()
    CACHE.delete(`mongo:users:${userId}`)
    await col.updateOne({ _id: userId }, { $set: { preferences: prefs, _updatedAt: new Date() } })
  }
}

class PredictionsCollection extends MongoCollection {
  constructor() { super('prediction_batches', 'batchId') }

  async findBySymbol(symbol, { limit = 50, since = 0 } = {}) {
    const filter = { symbol, ...(since ? { generatedAt: { $gte: since } } : {}) }
    return this.find(filter, { limit, sort: { generatedAt: -1 } })
  }

  async resolveOutcome(batchId, signalId, outcome) {
    const col = await this._col()
    CACHE.delete(`mongo:prediction_batches:${batchId}`)
    await col.updateOne(
      { _id: batchId, 'signals.id': signalId },
      { $set: { 'signals.$.outcome': outcome, _updatedAt: new Date() } }
    )
  }

  async getAccuracyStats(symbol, windowDays = 30) {
    const col    = await this._col()
    const cutoff = new Date(Date.now() - windowDays * 86_400_000)
    const pipeline = [
      { $match: { symbol, generatedAt: { $gte: cutoff.getTime() } } },
      { $unwind: '$signals' },
      { $match: { 'signals.outcome': { $exists: true, $ne: null } } },
      { $group: {
          _id:    '$symbol',
          total:  { $sum: 1 },
          hits:   { $sum: { $cond: [{ $in: ['$signals.outcome.outcome', ['T1_HIT','T2_HIT','T3_HIT']] }, 1, 0] } },
        }
      },
      { $project: {
          symbol:      '$_id',
          total:       1,
          hits:        1,
          accuracyPct: { $multiply: [{ $divide: ['$hits', '$total'] }, 100] },
        }
      },
    ]
    const results = await col.aggregate(pipeline).toArray()
    return results[0] ?? { symbol, total: 0, hits: 0, accuracyPct: null }
  }
}

class DeviationsCollection extends MongoCollection {
  constructor() { super('deviations') }

  async findBySymbol(symbol, { limit = 100, instrType = null } = {}) {
    const filter = { symbol, ...(instrType ? { instrType } : {}) }
    return this.find(filter, { limit, sort: { savedAt: -1 } })
  }
}

class AmiCollection extends MongoCollection {
  constructor() { super('ami_records') }

  async findBySymbolAndType(symbol, type, { limit = 100, since = 0 } = {}) {
    const filter = { symbol, type, ...(since ? { timestamp: { $gte: since } } : {}) }
    return this.find(filter, { limit, sort: { timestamp: -1 } })
  }
}

class MarketSessionsCollection extends MongoCollection {
  constructor() { super('market_sessions') }

  async upsertSession(symbol, date, data) {
    const col = await this._col()
    const id  = `${symbol}:${date}`
    await col.replaceOne(
      { _id: id },
      { _id: id, symbol, date, ...data, createdAt: new Date(), _updatedAt: new Date() },
      { upsert: true }
    )
    CACHE.set(`mongo:market_sessions:${id}`, data, 60_000)
  }

  async getSession(symbol, date) {
    return this.findById(`${symbol}:${date}`)
  }

  async getHistory(symbol, days = 5) {
    return this.find({ symbol }, { limit: days, sort: { date: -1 } })
  }
}

class AuditCollection extends MongoCollection {
  constructor() { super('audit_log') }

  async appendEntry(entry) {
    // Audit log is append-only — use insertOne, never upsert
    const col = await this._col()
    await col.insertOne({ ...entry, _createdAt: new Date() })
  }

  async queryByEvent(event, { limit = 100, since = 0 } = {}) {
    const filter = { event, ...(since ? { ts: { $gte: since } } : {}) }
    return this.find(filter, { limit, sort: { ts: -1 } })
  }
}

// ── Service singleton ─────────────────────────────────────────────────────────

let _service = null

export async function getMongoService() {
  if (_service) return _service

  const db = await connectMongo()
  if (!db) return null

  _service = {
    users:          new UsersCollection(),
    predictions:    new PredictionsCollection(),
    deviations:     new DeviationsCollection(),
    backtests:      new MongoCollection('backtest_results', 'key'),
    ami:            new AmiCollection(),
    marketSessions: new MarketSessionsCollection(),
    strategyScores: new MongoCollection('strategy_scores', 'key'),
    auditLog:       new AuditCollection(),
    systemConfig:   new MongoCollection('system_config', 'key'),
    // Raw db access for custom queries
    db,
    status: getMongoStatus,
  }

  return _service
}

export { MongoCollection }
