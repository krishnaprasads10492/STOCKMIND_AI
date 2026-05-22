/**
 * dbAdapter.js — Unified multi-database adapter.
 *
 * Routes all read/write operations to the correct backend based on
 * server/config/databases.js DATA_ROUTING configuration.
 *
 * Backends:
 *   local    → AES-256-GCM encrypted files (always available)
 *   sqlite   → Better-SQLite3 (optional, zero-config relational)
 *   postgres → pg client (optional, production relational)
 *   mongodb  → mongodb driver (optional, document store)
 *   redis    → ioredis (optional, cache + sessions)
 *
 * All backends implement the same interface:
 *   write(collection, id, data)        → void
 *   read(collection, id)               → object | null
 *   exists(collection, id)             → boolean
 *   delete(collection, id)             → void
 *   list(collection, opts?)            → string[]
 *   query(collection, filter, opts?)   → object[]
 *   append(collection, id, data)       → void (append to array)
 *
 * The adapter automatically falls back to LOCAL if a configured backend
 * is unavailable (connection failure, missing driver, etc.).
 */

import { resolveBackend, SQLITE_CONFIG, POSTGRES_CONFIG, MONGODB_CONFIG, REDIS_CONFIG } from '../config/databases.js'
import { writeSecure, readSecure, existsSecure, deleteSecure, listSecure } from './fileStore.js'
import { auditLog } from './auditLog.js'

// ── Connection singletons ─────────────────────────────────────────────────────

const _connections = {
  sqlite:   null,
  postgres: null,
  mongodb:  null,
  redis:    null,
}

const _health = {
  sqlite:   { ok: false, lastCheck: 0, error: null },
  postgres: { ok: false, lastCheck: 0, error: null },
  mongodb:  { ok: false, lastCheck: 0, error: null },
  redis:    { ok: false, lastCheck: 0, error: null },
}

// ── SQLite backend ────────────────────────────────────────────────────────────

async function getSQLite() {
  if (_connections.sqlite) return _connections.sqlite
  try {
    const { default: Database } = await import('better-sqlite3')
    const db = new Database(SQLITE_CONFIG.path)
    for (const [k, v] of Object.entries(SQLITE_CONFIG.pragmas)) {
      db.pragma(`${k} = ${v}`)
    }
    // Create generic KV table
    db.exec(`
      CREATE TABLE IF NOT EXISTS kv_store (
        collection TEXT NOT NULL,
        id         TEXT NOT NULL,
        data       TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch()),
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS idx_kv_collection ON kv_store(collection);
      CREATE INDEX IF NOT EXISTS idx_kv_updated ON kv_store(updated_at);
    `)
    _connections.sqlite = db
    _health.sqlite = { ok: true, lastCheck: Date.now(), error: null }
    console.log('[DBAdapter] SQLite connected:', SQLITE_CONFIG.path)
    return db
  } catch (err) {
    _health.sqlite = { ok: false, lastCheck: Date.now(), error: err.message }
    console.warn('[DBAdapter] SQLite unavailable:', err.message)
    return null
  }
}

const _sqliteBackend = {
  async write(collection, id, data) {
    const db = await getSQLite()
    if (!db) throw new Error('SQLite unavailable')
    const json = JSON.stringify(data)
    db.prepare(`
      INSERT INTO kv_store(collection, id, data, updated_at)
      VALUES(?, ?, ?, unixepoch())
      ON CONFLICT(collection, id) DO UPDATE SET data=excluded.data, updated_at=unixepoch()
    `).run(collection, id, json)
  },
  async read(collection, id) {
    const db = await getSQLite()
    if (!db) return null
    const row = db.prepare('SELECT data FROM kv_store WHERE collection=? AND id=?').get(collection, id)
    return row ? JSON.parse(row.data) : null
  },
  async exists(collection, id) {
    const db = await getSQLite()
    if (!db) return false
    const row = db.prepare('SELECT 1 FROM kv_store WHERE collection=? AND id=?').get(collection, id)
    return !!row
  },
  async delete(collection, id) {
    const db = await getSQLite()
    if (!db) return
    db.prepare('DELETE FROM kv_store WHERE collection=? AND id=?').run(collection, id)
  },
  async list(collection, { limit = 1000, offset = 0 } = {}) {
    const db = await getSQLite()
    if (!db) return []
    const rows = db.prepare('SELECT id FROM kv_store WHERE collection=? ORDER BY updated_at DESC LIMIT ? OFFSET ?').all(collection, limit, offset)
    return rows.map(r => r.id)
  },
  async query(collection, filter = {}, { limit = 100 } = {}) {
    const db = await getSQLite()
    if (!db) return []
    const rows = db.prepare(`SELECT data FROM kv_store WHERE collection=? ORDER BY updated_at DESC LIMIT ?`).all(collection, limit)
    const all  = rows.map(r => JSON.parse(r.data))
    return _applyFilter(all, filter)
  },
  async append(collection, id, item) {
    const existing = await _sqliteBackend.read(collection, id) ?? []
    const updated  = Array.isArray(existing) ? [...existing, item] : [existing, item]
    await _sqliteBackend.write(collection, id, updated)
  },
}

// ── PostgreSQL backend ────────────────────────────────────────────────────────

async function getPG() {
  if (_connections.postgres) return _connections.postgres
  try {
    const { default: pg } = await import('pg')
    const cfg = POSTGRES_CONFIG.connectionString
      ? { connectionString: POSTGRES_CONFIG.connectionString, ssl: POSTGRES_CONFIG.ssl }
      : {
          host: POSTGRES_CONFIG.host, port: POSTGRES_CONFIG.port,
          database: POSTGRES_CONFIG.database, user: POSTGRES_CONFIG.user,
          password: POSTGRES_CONFIG.password, ssl: POSTGRES_CONFIG.ssl,
          max:              POSTGRES_CONFIG.pool.max,
          idleTimeoutMillis: POSTGRES_CONFIG.pool.idle,
          connectionTimeoutMillis: POSTGRES_CONFIG.pool.acquire,
          statement_timeout: POSTGRES_CONFIG.statementTimeout,
        }
    const pool = new pg.Pool(cfg)
    // Create generic KV table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kv_store (
        collection TEXT NOT NULL,
        id         TEXT NOT NULL,
        data       JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS idx_kv_pg_collection ON kv_store(collection);
      CREATE INDEX IF NOT EXISTS idx_kv_pg_data       ON kv_store USING gin(data);
    `)
    _connections.postgres = pool
    _health.postgres = { ok: true, lastCheck: Date.now(), error: null }
    console.log('[DBAdapter] PostgreSQL connected:', POSTGRES_CONFIG.host)
    return pool
  } catch (err) {
    _health.postgres = { ok: false, lastCheck: Date.now(), error: err.message }
    console.warn('[DBAdapter] PostgreSQL unavailable:', err.message)
    return null
  }
}

const _pgBackend = {
  async write(collection, id, data) {
    const db = await getPG(); if (!db) throw new Error('PostgreSQL unavailable')
    await db.query(`
      INSERT INTO kv_store(collection, id, data, updated_at) VALUES($1,$2,$3,now())
      ON CONFLICT(collection, id) DO UPDATE SET data=$3, updated_at=now()
    `, [collection, id, data])
  },
  async read(collection, id) {
    const db = await getPG(); if (!db) return null
    const r = await db.query('SELECT data FROM kv_store WHERE collection=$1 AND id=$2', [collection, id])
    return r.rows[0]?.data ?? null
  },
  async exists(collection, id) {
    const db = await getPG(); if (!db) return false
    const r = await db.query('SELECT 1 FROM kv_store WHERE collection=$1 AND id=$2', [collection, id])
    return r.rowCount > 0
  },
  async delete(collection, id) {
    const db = await getPG(); if (!db) return
    await db.query('DELETE FROM kv_store WHERE collection=$1 AND id=$2', [collection, id])
  },
  async list(collection, { limit = 1000, offset = 0 } = {}) {
    const db = await getPG(); if (!db) return []
    const r = await db.query('SELECT id FROM kv_store WHERE collection=$1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3', [collection, limit, offset])
    return r.rows.map(row => row.id)
  },
  async query(collection, filter = {}, { limit = 100 } = {}) {
    const db = await getPG(); if (!db) return []
    const r = await db.query('SELECT data FROM kv_store WHERE collection=$1 ORDER BY updated_at DESC LIMIT $2', [collection, limit])
    return _applyFilter(r.rows.map(row => row.data), filter)
  },
  async append(collection, id, item) {
    const existing = await _pgBackend.read(collection, id) ?? []
    const updated  = Array.isArray(existing) ? [...existing, item] : [existing, item]
    await _pgBackend.write(collection, id, updated)
  },
}

// ── MongoDB backend ───────────────────────────────────────────────────────────

async function getMongo() {
  if (_connections.mongodb) return _connections.mongodb
  try {
    const { MongoClient } = await import('mongodb')
    const uri = MONGODB_CONFIG.atlasUri || MONGODB_CONFIG.uri
    const client = new MongoClient(uri, MONGODB_CONFIG.options)
    await client.connect()
    const db = client.db(MONGODB_CONFIG.database)
    _connections.mongodb = db
    _health.mongodb = { ok: true, lastCheck: Date.now(), error: null }
    console.log('[DBAdapter] MongoDB connected')
    return db
  } catch (err) {
    _health.mongodb = { ok: false, lastCheck: Date.now(), error: err.message }
    console.warn('[DBAdapter] MongoDB unavailable:', err.message)
    return null
  }
}

const _mongoBackend = {
  async write(collection, id, data) {
    const db = await getMongo(); if (!db) throw new Error('MongoDB unavailable')
    await db.collection(collection).replaceOne({ _id: id }, { _id: id, ...data, _updatedAt: new Date() }, { upsert: true })
  },
  async read(collection, id) {
    const db = await getMongo(); if (!db) return null
    const doc = await db.collection(collection).findOne({ _id: id })
    if (!doc) return null
    const { _id, _updatedAt, ...rest } = doc
    return rest
  },
  async exists(collection, id) {
    const db = await getMongo(); if (!db) return false
    return !!(await db.collection(collection).countDocuments({ _id: id }, { limit: 1 }))
  },
  async delete(collection, id) {
    const db = await getMongo(); if (!db) return
    await db.collection(collection).deleteOne({ _id: id })
  },
  async list(collection, { limit = 1000, offset = 0 } = {}) {
    const db = await getMongo(); if (!db) return []
    const docs = await db.collection(collection).find({}, { projection: { _id: 1 } }).sort({ _updatedAt: -1 }).skip(offset).limit(limit).toArray()
    return docs.map(d => d._id)
  },
  async query(collection, filter = {}, { limit = 100 } = {}) {
    const db = await getMongo(); if (!db) return []
    const docs = await db.collection(collection).find(filter).sort({ _updatedAt: -1 }).limit(limit).toArray()
    return docs.map(({ _id, _updatedAt, ...rest }) => rest)
  },
  async append(collection, id, item) {
    const db = await getMongo(); if (!db) throw new Error('MongoDB unavailable')
    await db.collection(collection).updateOne(
      { _id: id },
      { $push: { items: item }, $set: { _updatedAt: new Date() } },
      { upsert: true }
    )
  },
}

// ── Redis backend (cache/sessions) ────────────────────────────────────────────

async function getRedis() {
  if (_connections.redis) return _connections.redis
  try {
    const { default: Redis } = await import('ioredis')
    const opts = REDIS_CONFIG.url
      ? REDIS_CONFIG.url
      : {
          host: REDIS_CONFIG.host, port: REDIS_CONFIG.port,
          password: REDIS_CONFIG.password || undefined,
          db:       REDIS_CONFIG.db,
          tls:      REDIS_CONFIG.tls ? {} : undefined,
          keyPrefix: REDIS_CONFIG.keyPrefix,
          retryStrategy: n => n > REDIS_CONFIG.maxRetries ? null : REDIS_CONFIG.retryDelayMs * n,
          connectTimeout: REDIS_CONFIG.connectTimeoutMs,
          commandTimeout: REDIS_CONFIG.commandTimeoutMs,
        }
    const client = new Redis(opts)
    client.on('error', err => {
      _health.redis = { ok: false, lastCheck: Date.now(), error: err.message }
    })
    await client.ping()
    _connections.redis = client
    _health.redis = { ok: true, lastCheck: Date.now(), error: null }
    console.log('[DBAdapter] Redis connected')
    return client
  } catch (err) {
    _health.redis = { ok: false, lastCheck: Date.now(), error: err.message }
    console.warn('[DBAdapter] Redis unavailable:', err.message)
    return null
  }
}

const _redisBackend = {
  _ttl: (collection) => {
    if (collection === 'sessions') return REDIS_CONFIG.ttl.session
    if (collection === 'cache')    return REDIS_CONFIG.ttl.cache
    if (collection.startsWith('ratelimit')) return REDIS_CONFIG.ttl.rateLimit
    return REDIS_CONFIG.ttl.prediction
  },
  async write(collection, id, data) {
    const db = await getRedis(); if (!db) throw new Error('Redis unavailable')
    await db.set(`${collection}:${id}`, JSON.stringify(data), 'EX', this._ttl(collection))
  },
  async read(collection, id) {
    const db = await getRedis(); if (!db) return null
    const v = await db.get(`${collection}:${id}`)
    return v ? JSON.parse(v) : null
  },
  async exists(collection, id) {
    const db = await getRedis(); if (!db) return false
    return (await db.exists(`${collection}:${id}`)) === 1
  },
  async delete(collection, id) {
    const db = await getRedis(); if (!db) return
    await db.del(`${collection}:${id}`)
  },
  async list(collection, { limit = 100 } = {}) {
    const db = await getRedis(); if (!db) return []
    const keys = await db.keys(`${collection}:*`)
    return keys.slice(0, limit).map(k => k.replace(`${collection}:`, ''))
  },
  async query(collection, filter = {}, { limit = 100 } = {}) {
    const keys = await this.list(collection, { limit })
    const results = await Promise.all(keys.map(id => this.read(collection, id)))
    return _applyFilter(results.filter(Boolean), filter)
  },
  async append(collection, id, item) {
    const db = await getRedis(); if (!db) throw new Error('Redis unavailable')
    const key = `${collection}:${id}:list`
    await db.rpush(key, JSON.stringify(item))
    await db.expire(key, this._ttl(collection))
  },
}

// ── LOCAL backend (encrypted files — always available) ────────────────────────

const _localBackend = {
  async write(collection, id, data) {
    writeSecure(`${collection}/${id}`, data)
  },
  async read(collection, id) {
    return readSecure(`${collection}/${id}`)
  },
  async exists(collection, id) {
    return existsSecure(`${collection}/${id}`)
  },
  async delete(collection, id) {
    deleteSecure(`${collection}/${id}`)
  },
  async list(collection, { limit = 1000 } = {}) {
    return listSecure(collection).slice(0, limit)
  },
  async query(collection, filter = {}, { limit = 100 } = {}) {
    const ids  = listSecure(collection).slice(0, limit * 2)
    const all  = ids.map(id => readSecure(`${collection}/${id}`)).filter(Boolean)
    return _applyFilter(all, filter).slice(0, limit)
  },
  async append(collection, id, item) {
    const existing = readSecure(`${collection}/${id}`) ?? []
    const updated  = Array.isArray(existing) ? [...existing, item] : [existing, item]
    writeSecure(`${collection}/${id}`, updated)
  },
}

// ── Filter helper ─────────────────────────────────────────────────────────────

function _applyFilter(items, filter) {
  if (!filter || Object.keys(filter).length === 0) return items
  return items.filter(item => {
    for (const [k, v] of Object.entries(filter)) {
      if (item[k] !== v) return false
    }
    return true
  })
}

// ── Backend selector ──────────────────────────────────────────────────────────

function _getBackend(backendName) {
  switch (backendName) {
    case 'sqlite':   return _sqliteBackend
    case 'postgres': return _pgBackend
    case 'mongodb':  return _mongoBackend
    case 'redis':    return _redisBackend
    default:         return _localBackend
  }
}

// ── Public unified adapter ────────────────────────────────────────────────────

class DBAdapter {
  /**
   * Write an object to the appropriate backend for this data category.
   * @param {string} category — 'users' | 'predictions' | 'sessions' | 'analytics' | etc.
   * @param {string} collection — sub-collection (e.g. 'users/2026-05')
   * @param {string} id
   * @param {object} data
   */
  async write(category, collection, id, data) {
    const backend = resolveBackend(category)
    try {
      await _getBackend(backend).write(collection, id, data)
    } catch (err) {
      console.warn(`[DBAdapter] ${backend} write failed, falling back to local:`, err.message)
      await _localBackend.write(collection, id, data)
    }
  }

  async read(category, collection, id) {
    const backend = resolveBackend(category)
    try {
      return await _getBackend(backend).read(collection, id)
    } catch (err) {
      console.warn(`[DBAdapter] ${backend} read failed, falling back to local:`, err.message)
      return _localBackend.read(collection, id)
    }
  }

  async exists(category, collection, id) {
    const backend = resolveBackend(category)
    try {
      return await _getBackend(backend).exists(collection, id)
    } catch {
      return _localBackend.exists(collection, id)
    }
  }

  async delete(category, collection, id) {
    const backend = resolveBackend(category)
    try {
      await _getBackend(backend).delete(collection, id)
    } catch {
      await _localBackend.delete(collection, id)
    }
  }

  async list(category, collection, opts) {
    const backend = resolveBackend(category)
    try {
      return await _getBackend(backend).list(collection, opts)
    } catch {
      return _localBackend.list(collection, opts)
    }
  }

  async query(category, collection, filter, opts) {
    const backend = resolveBackend(category)
    try {
      return await _getBackend(backend).query(collection, filter, opts)
    } catch {
      return _localBackend.query(collection, filter, opts)
    }
  }

  async append(category, collection, id, item) {
    const backend = resolveBackend(category)
    try {
      await _getBackend(backend).append(collection, id, item)
    } catch {
      await _localBackend.append(collection, id, item)
    }
  }

  /** Get health of all configured backends */
  async healthCheck() {
    const results = { local: { ok: true } }
    if (SQLITE_CONFIG.enabled) {
      const db = await getSQLite()
      results.sqlite = _health.sqlite
    }
    if (POSTGRES_CONFIG.enabled) {
      const db = await getPG()
      results.postgres = _health.postgres
    }
    if (MONGODB_CONFIG.enabled) {
      const db = await getMongo()
      results.mongodb = _health.mongodb
    }
    if (REDIS_CONFIG.enabled) {
      const db = await getRedis()
      results.redis = _health.redis
    }
    return results
  }

  /** Initialize all configured backends at startup */
  async init() {
    const tasks = []
    if (SQLITE_CONFIG.enabled)   tasks.push(getSQLite().catch(e => console.warn('[DBAdapter] SQLite init:', e.message)))
    if (POSTGRES_CONFIG.enabled) tasks.push(getPG().catch(e => console.warn('[DBAdapter] PG init:', e.message)))
    if (MONGODB_CONFIG.enabled)  tasks.push(getMongo().catch(e => console.warn('[DBAdapter] Mongo init:', e.message)))
    if (REDIS_CONFIG.enabled)    tasks.push(getRedis().catch(e => console.warn('[DBAdapter] Redis init:', e.message)))
    await Promise.allSettled(tasks)
    console.log('[DBAdapter] Initialized. Active backends:', await this.healthCheck())
  }
}

export const DB = new DBAdapter()
export default DB
