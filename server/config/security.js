/**
 * security.js — Military-grade security configuration.
 *
 * Covers:
 *   - Rate limiting tiers (per endpoint class)
 *   - Request signing / HMAC verification
 *   - Session fingerprinting (IP + User-Agent binding)
 *   - Content Security Policy nonces
 *   - IP allowlist/blocklist
 *   - Anomaly detection thresholds
 *   - Key derivation parameters (Argon2id)
 *   - Audit log HMAC chain config
 *   - TLS / HSTS settings (for non-local deployments)
 */

function env(key, fallback = '') { return process.env[key] ?? fallback }
function envBool(key, fb = false) {
  const v = process.env[key]
  return v === undefined ? fb : ['true','1','yes'].includes(v.toLowerCase())
}
function envInt(key, fb = 0) { const v = parseInt(process.env[key], 10); return isNaN(v) ? fb : v }

// ── Argon2id KDF parameters (for file store key derivation) ──────────────────
// OWASP 2024 recommended minimums — NIST SP 800-132 compliant
export const KDF_PARAMS = {
  algorithm:   'argon2id',
  memoryCost:  envInt('KDF_MEMORY_COST',  131072),  // 128 MiB (was 64 MiB)
  timeCost:    envInt('KDF_TIME_COST',    4),        // iterations
  parallelism: envInt('KDF_PARALLELISM',  4),
  saltLength:  32,                                   // 256-bit salt
  keyLength:   32,                                   // 256-bit key output
  // Fallback to PBKDF2 if argon2 not available
  pbkdf2: {
    iterations: envInt('KDF_PBKDF2_ITERATIONS', 600000), // NIST 2024 minimum
    algorithm:  'sha512',
  }
}

// ── Encryption parameters ─────────────────────────────────────────────────────
export const ENCRYPTION = {
  algorithm:    'aes-256-gcm',
  ivLength:     12,       // 96-bit IV (GCM standard)
  tagLength:    16,       // 128-bit auth tag
  keyLength:    32,       // 256-bit key
  // Additional authenticated data — binds ciphertext to a purpose
  aadEnabled:   envBool('ENC_AAD_ENABLED', true),
  // Integrity layer: HMAC-SHA512 over [IV + TAG + CIPHERTEXT]
  hmacEnabled:  envBool('ENC_HMAC_ENABLED', true),
  hmacAlgorithm: 'sha512',
  hmacLength:   64,       // 512-bit
  // Key rotation: encrypted files include a version byte
  keyVersion:   envInt('ENC_KEY_VERSION', 1),
}

// ── Session security ──────────────────────────────────────────────────────────
export const SESSION = {
  tokenLength:      32,           // 256-bit random token
  step1TtlMs:       10 * 60 * 1000,   // 10 min to enter key
  fullSessionTtlMs: 8 * 60 * 60 * 1000, // 8 hours
  slidingWindowMs:  30 * 60 * 1000,    // extend by 30 min on activity
  maxConcurrent:    envInt('SESSION_MAX_CONCURRENT', 5),  // max simultaneous sessions per user
  // Fingerprinting — bind session to client properties
  fingerprint: {
    enabled:     envBool('SESSION_FINGERPRINT', true),
    bindIp:      envBool('SESSION_BIND_IP', false),   // false = allow IP change (mobile)
    bindUa:      envBool('SESSION_BIND_UA', true),    // bind to User-Agent
    bindAccept:  envBool('SESSION_BIND_ACCEPT', false),
  },
}

// ── Brute-force protection ────────────────────────────────────────────────────
export const BRUTE_FORCE = {
  maxAttempts:       envInt('AUTH_MAX_ATTEMPTS', 5),
  lockoutDurationMs: envInt('AUTH_LOCKOUT_MS', 15 * 60 * 1000),  // 15 min
  progressiveDelay:  envBool('AUTH_PROGRESSIVE_DELAY', true),
  // IP-level blocking (separate from account lockout)
  ipMaxAttempts:     envInt('AUTH_IP_MAX_ATTEMPTS', 20),
  ipBlockDurationMs: envInt('AUTH_IP_BLOCK_MS', 60 * 60 * 1000), // 1 hour
}

// ── Rate limiting tiers ───────────────────────────────────────────────────────
export const RATE_LIMITS = {
  // Auth endpoints — tightest
  auth: {
    windowMs:  15 * 60 * 1000,
    max:       envInt('RATELIMIT_AUTH', 10),
    message:   'Too many auth attempts. Try again in 15 minutes.',
  },
  // Key generation — very sensitive
  keygen: {
    windowMs:  60 * 60 * 1000,
    max:       envInt('RATELIMIT_KEYGEN', 5),
    message:   'Too many key generation requests.',
  },
  // Prediction / AI endpoints — moderate
  prediction: {
    windowMs:  60 * 1000,
    max:       envInt('RATELIMIT_PREDICTION', 30),
    message:   'Too many prediction requests. Slow down.',
  },
  // Image analysis — resource-intensive
  imageAnalysis: {
    windowMs:  60 * 1000,
    max:       envInt('RATELIMIT_IMAGE', 10),
    message:   'Too many image analysis requests.',
  },
  // General API
  api: {
    windowMs:  60 * 1000,
    max:       envInt('RATELIMIT_API', 300),
    message:   'Rate limit exceeded.',
  },
  // Admin endpoints
  admin: {
    windowMs:  60 * 1000,
    max:       envInt('RATELIMIT_ADMIN', 60),
    message:   'Admin rate limit exceeded.',
  },
}

// ── IP allowlist / blocklist ──────────────────────────────────────────────────
export const IP_CONTROL = {
  // Allowlist mode: if non-empty, ONLY these IPs are accepted
  allowlist: env('IP_ALLOWLIST', '').split(',').filter(Boolean).map(s => s.trim()),
  // Blocklist: always reject these IPs
  blocklist: env('IP_BLOCKLIST', '').split(',').filter(Boolean).map(s => s.trim()),
  // Always allow localhost
  alwaysAllowLocal: envBool('IP_ALLOW_LOCAL', true),
  // Log blocked IPs
  logBlocked: envBool('IP_LOG_BLOCKED', true),
}

// ── Request signing (HMAC-SHA256) ─────────────────────────────────────────────
// For internal backend-to-backend calls (Node.js → Python)
export const REQUEST_SIGNING = {
  enabled:         envBool('REQUEST_SIGNING_ENABLED', false),
  secret:          env('REQUEST_SIGNING_SECRET', ''),
  algorithm:       'sha256',
  headerName:      'x-stockmind-sig',
  timestampHeader: 'x-stockmind-ts',
  maxAgeMs:        envInt('REQUEST_SIGNING_MAX_AGE_MS', 30000), // 30s replay window
}

// ── Audit log configuration ───────────────────────────────────────────────────
export const AUDIT_LOG = {
  enabled:      envBool('AUDIT_LOG_ENABLED', true),
  // HMAC chain: each entry includes HMAC of previous entry → tamper-evident
  hmacChain:    envBool('AUDIT_HMAC_CHAIN', true),
  hmacAlgo:     'sha512',
  // Events to log
  events: {
    login:           envBool('AUDIT_LOGIN',         true),
    loginFailed:     envBool('AUDIT_LOGIN_FAILED',  true),
    logout:          envBool('AUDIT_LOGOUT',        true),
    keyGenerated:    envBool('AUDIT_KEYGEN',        true),
    userCreated:     envBool('AUDIT_USER_CREATE',   true),
    userDeactivated: envBool('AUDIT_USER_DEACT',    true),
    passwordChanged: envBool('AUDIT_PW_CHANGE',     true),
    dataAccess:      envBool('AUDIT_DATA_ACCESS',   false), // high volume
    prediction:      envBool('AUDIT_PREDICTION',    false), // high volume
    adminAction:     envBool('AUDIT_ADMIN',         true),
    ghostMode:       envBool('AUDIT_GHOST',         true),
    suspiciousActivity: envBool('AUDIT_SUSPICIOUS', true),
  },
  // Retention
  retentionDays: envInt('AUDIT_RETENTION_DAYS', 365),
  // Export format: 'json' | 'csv'
  exportFormat:  env('AUDIT_EXPORT_FORMAT', 'json'),
}

// ── Content Security Policy ───────────────────────────────────────────────────
export const CSP = {
  noncesEnabled: envBool('CSP_NONCES', false),    // add nonces to script/style tags
  reportUri:     env('CSP_REPORT_URI', ''),
  // Additional trusted sources beyond defaults
  extraScriptSrc: env('CSP_EXTRA_SCRIPT', '').split(',').filter(Boolean),
  extraConnectSrc: env('CSP_EXTRA_CONNECT', '').split(',').filter(Boolean),
  // External market data APIs that need to be in connect-src
  marketApis: [
    'https://query1.finance.yahoo.com',
    'https://query2.finance.yahoo.com',
    'https://stream.binance.com',
    'https://finnhub.io',
    'https://api.coingecko.com',
    'https://api.fred.stlouisfed.org',
  ],
}

// ── Data masking rules ────────────────────────────────────────────────────────
// Fields that must be masked in logs, error messages, and API responses
export const DATA_MASKING = {
  fields: ['password', 'passwordHash', 'keyHash', 'token', 'sessionToken',
           'stepToken', 'apiKey', 'secret', 'accessToken', 'refreshToken',
           'encryptionKey', 'hmacSecret', 'privateKey'],
  // Replacement value in logs
  maskValue: '[REDACTED]',
  // Partial masking for keys shown to users (show first 4, mask rest)
  partialMask: true,
}

// ── Anomaly detection thresholds ─────────────────────────────────────────────
export const ANOMALY = {
  // Unusual request patterns
  requestBurstWindow:   5000,   // ms
  requestBurstMax:      50,     // requests in window = flag
  // Impossible travel
  impossibleTravelKmh:  1000,   // flag if IP geolocation changes faster than this
  // Off-hours access (configurable business hours)
  offHoursAlert:        envBool('ANOMALY_OFF_HOURS', false),
  businessHoursStart:   envInt('BIZ_HOURS_START', 6),   // 6 AM
  businessHoursEnd:     envInt('BIZ_HOURS_END', 23),    // 11 PM
}

// ── Secure defaults ───────────────────────────────────────────────────────────
export const SECURE_HEADERS = {
  hsts:                  envBool('HSTS_ENABLED', false),  // false for local
  hstsMaxAge:            envInt('HSTS_MAX_AGE', 31536000),
  hstsIncludeSubDomains: envBool('HSTS_SUBDOMAINS', true),
  referrerPolicy:        'strict-origin-when-cross-origin',
  permissionsPolicy:     'camera=(), microphone=(self), geolocation=()',
  // Remove server header
  removeServerHeader:    true,
}

export default {
  kdf:           KDF_PARAMS,
  encryption:    ENCRYPTION,
  session:       SESSION,
  bruteForce:    BRUTE_FORCE,
  rateLimits:    RATE_LIMITS,
  ipControl:     IP_CONTROL,
  requestSigning: REQUEST_SIGNING,
  auditLog:      AUDIT_LOG,
  csp:           CSP,
  dataMasking:   DATA_MASKING,
  anomaly:       ANOMALY,
  secureHeaders: SECURE_HEADERS,
}
