/**
 * databases.js — Multi-database configuration registry.
 *
 * StockMind AI supports 5 storage backends:
 *   1. LOCAL  — AES-256-GCM + Argon2id encrypted files (default, always available)
 *   2. SQLITE — Single-file relational DB (no server needed, zero-config)
 *   3. POSTGRES — Full PostgreSQL (production-grade, multi-user)
 *   4. MONGODB — Document store (flexible schema, predictions + analytics)
 *   5. REDIS  — In-memory cache + session store (sub-ms latency)
 *
 * Each backend is independently enabled/disabled via environment variables.
 * Multiple can be active simultaneously with role assignments.
 *
 * Data routing:
 *   users        → PRIMARY_DB (default: LOCAL)
 *   predictions  → PREDICTIONS_DB (default: LOCAL, can use MONGODB)
 *   sessions     → SESSION_DB (default: LOCAL, can use REDIS)
 *   analytics    → ANALYTICS_DB (default: LOCAL, can use POSTGRES)
 *   audit_log    → AUDIT_DB (default: LOCAL, immutable append-only)
 *   cache        → CACHE_DB (default: LOCAL, can use REDIS)
 */

// ── Environment helpers ───────────────────────────────────────────────────────

function env(key, fallback = '') {
  return process.env[key] ?? fallback
}

function envBool(key, fallback = false) {
  const v = process.env[key]
  if (v === undefined) return fallback
  return ['true', '1', 'yes'].includes(v.toLowerCase())
}

function envInt(key, fallback = 0) {
  const v = parseInt(process.env[key], 10)
  return isNaN(v) ? fallback : v
}

// ── SQLite config ─────────────────────────────────────────────────────────────

export const SQLITE_CONFIG = {
  enabled:  envBool('SQLITE_ENABLED', false),
  path:     env('SQLITE_PATH', './data/stockmind.db'),
  // WAL mode for concurrent reads
  pragmas: {
    journal_mode: 'WAL',
    foreign_keys: 'ON',
    synchronous:  'NORMAL',
    cache_size:   '-32000',   // 32 MB cache
    temp_store:   'MEMORY',
  },
  // Encrypt SQLite file with SQLCipher if available
  encryptionKey: env('SQLITE_ENCRYPTION_KEY', ''),
  poolSize:      envInt('SQLITE_POOL_SIZE', 5),
  busyTimeout:   envInt('SQLITE_BUSY_TIMEOUT_MS', 5000),
}

// ── PostgreSQL config ─────────────────────────────────────────────────────────

export const POSTGRES_CONFIG = {
  enabled:  envBool('POSTGRES_ENABLED', false),
  host:     env('POSTGRES_HOST', 'localhost'),
  port:     envInt('POSTGRES_PORT', 5432),
  database: env('POSTGRES_DB', 'stockmind'),
  user:     env('POSTGRES_USER', 'stockmind'),
  password: env('POSTGRES_PASSWORD', ''),
  // Connection pooling
  pool: {
    min:     envInt('POSTGRES_POOL_MIN', 2),
    max:     envInt('POSTGRES_POOL_MAX', 10),
    acquire: envInt('POSTGRES_POOL_ACQUIRE_MS', 30000),
    idle:    envInt('POSTGRES_POOL_IDLE_MS', 10000),
  },
  ssl: envBool('POSTGRES_SSL', false)
    ? {
        rejectUnauthorized: envBool('POSTGRES_SSL_VERIFY', true),
        ca:  env('POSTGRES_SSL_CA', ''),
        key: env('POSTGRES_SSL_KEY', ''),
        cert: env('POSTGRES_SSL_CERT', ''),
      }
    : false,
  // Connection string takes precedence if set
  connectionString: env('POSTGRES_URL', ''),
  // Schema prefix for multi-tenant
  schema: env('POSTGRES_SCHEMA', 'public'),
  // Statement timeout (ms)
  statementTimeout: envInt('POSTGRES_STATEMENT_TIMEOUT_MS', 30000),
}

// ── MongoDB config ────────────────────────────────────────────────────────────

export const MONGODB_CONFIG = {
  enabled:  envBool('MONGODB_ENABLED', false),
  uri:      env('MONGODB_URI', 'mongodb://localhost:27017/stockmind'),
  database: env('MONGODB_DB', 'stockmind'),
  options: {
    maxPoolSize:       envInt('MONGODB_POOL_MAX', 10),
    minPoolSize:       envInt('MONGODB_POOL_MIN', 2),
    serverSelectionTimeoutMS: envInt('MONGODB_TIMEOUT_MS', 5000),
    socketTimeoutMS:   envInt('MONGODB_SOCKET_TIMEOUT_MS', 45000),
    connectTimeoutMS:  envInt('MONGODB_CONNECT_TIMEOUT_MS', 10000),
    retryWrites:       true,
    w:                 'majority',
    // TLS
    tls:               envBool('MONGODB_TLS', false),
    tlsCAFile:         env('MONGODB_TLS_CA', ''),
    tlsCertificateKeyFile: env('MONGODB_TLS_CERT', ''),
  },
  // Atlas connection string takes precedence
  atlasUri: env('MONGODB_ATLAS_URI', ''),
  // Per-collection encryption (field-level)
  fieldEncryption: envBool('MONGODB_FIELD_ENCRYPT', false),
  encryptionKey:   env('MONGODB_ENCRYPTION_KEY', ''),
}

// ── Redis config ──────────────────────────────────────────────────────────────

export const REDIS_CONFIG = {
  enabled:  envBool('REDIS_ENABLED', false),
  host:     env('REDIS_HOST', 'localhost'),
  port:     envInt('REDIS_PORT', 6379),
  password: env('REDIS_PASSWORD', ''),
  db:       envInt('REDIS_DB', 0),
  // TLS
  tls:      envBool('REDIS_TLS', false),
  // Retry strategy
  maxRetries:       envInt('REDIS_MAX_RETRIES', 3),
  retryDelayMs:     envInt('REDIS_RETRY_DELAY_MS', 200),
  connectTimeoutMs: envInt('REDIS_CONNECT_TIMEOUT_MS', 5000),
  commandTimeoutMs: envInt('REDIS_COMMAND_TIMEOUT_MS', 3000),
  // Key namespacing
  keyPrefix:  env('REDIS_KEY_PREFIX', 'stockmind:'),
  // Default TTLs (seconds)
  ttl: {
    session:    envInt('REDIS_SESSION_TTL', 28800),    // 8 hours
    cache:      envInt('REDIS_CACHE_TTL', 300),        // 5 min
    rateLimit:  envInt('REDIS_RATELIMIT_TTL', 900),    // 15 min
    prediction: envInt('REDIS_PREDICTION_TTL', 86400), // 24 hours
  },
  // Connection string takes precedence
  url: env('REDIS_URL', ''),
  // Sentinel / Cluster
  sentinel: {
    enabled:     envBool('REDIS_SENTINEL', false),
    masterName:  env('REDIS_SENTINEL_MASTER', 'mymaster'),
    sentinels:   env('REDIS_SENTINEL_NODES', '').split(',')
                   .filter(Boolean)
                   .map(s => { const [h, p] = s.split(':'); return { host: h, port: parseInt(p) } }),
  },
}

// ── Data routing configuration ────────────────────────────────────────────────

/**
 * Data routing determines which backend stores each data category.
 * Options: 'local' | 'sqlite' | 'postgres' | 'mongodb' | 'redis'
 *
 * Rules:
 * - A backend must be enabled to be used
 * - Falls back to 'local' if the configured backend is disabled
 * - 'local' is ALWAYS available as the ultimate fallback
 */
export const DATA_ROUTING = {
  users:       env('DB_USERS',       'local'),
  predictions: env('DB_PREDICTIONS', 'local'),
  sessions:    env('DB_SESSIONS',    'local'),
  analytics:   env('DB_ANALYTICS',   'local'),
  audit:       env('DB_AUDIT',       'local'),
  cache:       env('DB_CACHE',       'local'),
  ami:         env('DB_AMI',         'local'),
  strategies:  env('DB_STRATEGIES',  'local'),
  backtest:    env('DB_BACKTEST',    'local'),
}

// ── Active backends summary ───────────────────────────────────────────────────

export function getActiveBackends() {
  return {
    local:    true,  // always enabled
    sqlite:   SQLITE_CONFIG.enabled,
    postgres: POSTGRES_CONFIG.enabled,
    mongodb:  MONGODB_CONFIG.enabled,
    redis:    REDIS_CONFIG.enabled,
  }
}

export function resolveBackend(dataCategory) {
  const configured = DATA_ROUTING[dataCategory] ?? 'local'
  const active     = getActiveBackends()
  if (active[configured]) return configured
  // Fallback chain
  if (active.sqlite)   return 'sqlite'
  return 'local'
}

export default {
  sqlite:   SQLITE_CONFIG,
  postgres: POSTGRES_CONFIG,
  mongodb:  MONGODB_CONFIG,
  redis:    REDIS_CONFIG,
  routing:  DATA_ROUTING,
  getActiveBackends,
  resolveBackend,
}
