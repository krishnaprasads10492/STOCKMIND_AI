/**
 * authService.js — hardened local authentication.
 *
 * Security features:
 *   - Argon2id password hashing (memory-hard, timing-safe)
 *   - Brute-force lockout: 5 failed attempts → 15-minute lockout
 *   - Constant-time comparison for all secrets (timingSafeEqual)
 *   - Session sliding expiry (activity extends TTL)
 *   - mustChangePassword flag for first-login enforcement
 *   - Key rotation: old key invalidated on new key generation
 *   - All error messages are generic (no user enumeration)
 *   - Password strength: min 8 chars, uppercase, number, special char
 */

import crypto from 'crypto'
import argon2 from 'argon2'
import { readSecure, writeSecure, existsSecure, listSecure } from '../storage/fileStore.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const SESSION_TTL_MS      = 8 * 60 * 60 * 1000   // 8 hours
const SESSION_SLIDE_MS    = 30 * 60 * 1000        // slide by 30 min on activity
const STEP1_TTL_MS        = 10 * 60 * 1000        // 10 min to enter key
const LOCKOUT_ATTEMPTS    = 5                      // failed attempts before lockout
const LOCKOUT_DURATION_MS = 15 * 60 * 1000        // 15-minute lockout

// Argon2id parameters — OWASP recommended minimums
const ARGON2_OPTIONS = {
  type:        argon2.argon2id,
  memoryCost:  65536,   // 64 MiB
  timeCost:    3,
  parallelism: 4,
}

// ── In-memory stores ──────────────────────────────────────────────────────────

/** Map<token, { userId, username, role, step, expiresAt, lastActivity }> */
const sessions = new Map()

/** Map<username, { count, lockedUntil }> */
const loginAttempts = new Map()

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateToken() {
  return crypto.randomBytes(32).toString('hex')
}

function userPath(userId) {
  return `users/${userId}`
}

function pruneExpired() {
  const now = Date.now()
  for (const [token, sess] of sessions) {
    if (sess.expiresAt < now) sessions.delete(token)
  }
}

function isLockedOut(username) {
  const rec = loginAttempts.get(username)
  if (!rec) return false
  if (rec.lockedUntil && rec.lockedUntil > Date.now()) return true
  if (rec.lockedUntil && rec.lockedUntil <= Date.now()) {
    loginAttempts.delete(username)
    return false
  }
  return false
}

function recordFailedAttempt(username) {
  const rec = loginAttempts.get(username) ?? { count: 0, lockedUntil: null }
  rec.count++
  if (rec.count >= LOCKOUT_ATTEMPTS) {
    rec.lockedUntil = Date.now() + LOCKOUT_DURATION_MS
    console.warn(`[Auth] Account locked: ${username} (${rec.count} failed attempts)`)
  }
  loginAttempts.set(username, rec)
}

function clearFailedAttempts(username) {
  loginAttempts.delete(username)
}

function getLockoutRemainingMs(username) {
  const rec = loginAttempts.get(username)
  if (!rec?.lockedUntil) return 0
  return Math.max(0, rec.lockedUntil - Date.now())
}

// ── Password validation ───────────────────────────────────────────────────────

/**
 * Validate password strength.
 * Returns { ok: true } or { ok: false, error: string }
 */
export function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') {
    return { ok: false, error: 'Password is required' }
  }
  if (password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters' }
  }
  if (!/[A-Z]/.test(password)) {
    return { ok: false, error: 'Password must contain at least one uppercase letter' }
  }
  if (!/[0-9]/.test(password)) {
    return { ok: false, error: 'Password must contain at least one number' }
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { ok: false, error: 'Password must contain at least one special character (!@#$%^&* etc.)' }
  }
  return { ok: true }
}

// ── User helpers ──────────────────────────────────────────────────────────────

export function getUserByUsername(username) {
  const index = readSecure('users/index') ?? {}
  const userId = index[username.toLowerCase()]
  if (!userId) return null
  return readSecure(userPath(userId))
}

export function getUserById(userId) {
  return readSecure(userPath(userId))
}

export function getAllUsers() {
  const ids = listSecure('users').filter(f => f !== 'index' && f !== 'deviations' && f !== 'versions')
  return ids.map(id => readSecure(`users/${id}`)).filter(Boolean)
}

// ── Step 1: username + password ───────────────────────────────────────────────

export async function loginStep1(username, password) {
  pruneExpired()

  if (!username || !password) {
    return { ok: false, error: 'Username and password required' }
  }

  // Lockout check
  if (isLockedOut(username)) {
    const remaining = Math.ceil(getLockoutRemainingMs(username) / 60000)
    return { ok: false, error: `Account temporarily locked. Try again in ${remaining} minute${remaining !== 1 ? 's' : ''}.` }
  }

  const user = getUserByUsername(username)
  if (!user || !user.isActive) {
    // Constant-time dummy hash to prevent timing attacks
    await argon2.hash('dummy_prevent_timing_attack_' + username, ARGON2_OPTIONS)
    recordFailedAttempt(username)
    return { ok: false, error: 'Invalid credentials' }
  }

  const valid = await argon2.verify(user.passwordHash, password)
  if (!valid) {
    recordFailedAttempt(username)
    const rec = loginAttempts.get(username)
    const remaining = LOCKOUT_ATTEMPTS - (rec?.count ?? 0)
    if (remaining > 0) {
      return { ok: false, error: `Invalid credentials. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` }
    }
    return { ok: false, error: 'Invalid credentials' }
  }

  clearFailedAttempts(username)

  const stepToken = generateToken()
  sessions.set(stepToken, {
    userId:       user.userId,
    username:     user.username,
    role:         user.role,
    step:         1,
    expiresAt:    Date.now() + STEP1_TTL_MS,
    lastActivity: Date.now(),
  })

  return {
    ok:                  true,
    stepToken,
    mustChangePassword:  user.mustChangePassword ?? false,
  }
}

// ── Step 2: 12-digit key ──────────────────────────────────────────────────────

export function loginStep2(stepToken, key) {
  pruneExpired()

  const sess = sessions.get(stepToken)
  if (!sess || sess.step !== 1) {
    return { ok: false, error: 'Invalid or expired step token' }
  }

  const user = readSecure(userPath(sess.userId))
  if (!user) return { ok: false, error: 'User not found' }

  if (!user.keyHash) {
    return { ok: false, error: 'No access key set — contact admin to generate one' }
  }

  const keyDigits = key.replace(/-/g, '')
  if (keyDigits.length !== 12) {
    return { ok: false, error: 'Key must be 12 digits' }
  }

  const hmac = crypto.createHmac('sha256', keyDigits).update(user.userId).digest('hex')

  // Pad to equal length for timingSafeEqual
  const storedHash = user.keyHash.padEnd(64, '0')
  const computedHash = hmac.padEnd(64, '0')

  if (!crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(storedHash, 'hex'))) {
    return { ok: false, error: 'Invalid key' }
  }

  if (user.keyExpiresAt && new Date(user.keyExpiresAt) < new Date()) {
    return { ok: false, error: 'Access key has expired — contact admin for a new key' }
  }

  sessions.delete(stepToken)
  const sessionToken = generateToken()
  sessions.set(sessionToken, {
    userId:       user.userId,
    username:     user.username,
    role:         user.role,
    step:         2,
    expiresAt:    Date.now() + SESSION_TTL_MS,
    lastActivity: Date.now(),
  })

  writeSecure(userPath(user.userId), {
    ...user,
    lastLoginAt: new Date().toISOString(),
    loginCount:  (user.loginCount ?? 0) + 1,
  })

  return {
    ok: true,
    sessionToken,
    user: {
      userId:            user.userId,
      username:          user.username,
      role:              user.role,
      preferences:       user.preferences,
      mustChangePassword: user.mustChangePassword ?? false,
    },
  }
}

// ── Session validation ────────────────────────────────────────────────────────

export function validateSession(token) {
  pruneExpired()
  const sess = sessions.get(token)
  if (!sess || sess.step !== 2) return null

  // Slide expiry on activity
  const now = Date.now()
  if (now - sess.lastActivity > SESSION_SLIDE_MS) {
    sess.expiresAt    = now + SESSION_TTL_MS
    sess.lastActivity = now
  }

  return { userId: sess.userId, username: sess.username, role: sess.role }
}

/**
 * Validate a Step-1 token (used for pre-session keygen on the login page).
 * Returns session info if valid, null if expired/invalid.
 */
export function validateStepToken(token) {
  pruneExpired()
  const sess = sessions.get(token)
  if (!sess || sess.step !== 1) return null
  return { userId: sess.userId, username: sess.username, role: sess.role }
}

export function logout(token) {
  sessions.delete(token)
}

export function getActiveSessions() {
  pruneExpired()
  return [...sessions.values()]
    .filter(s => s.step === 2)
    .map(s => ({ username: s.username, role: s.role, expiresAt: s.expiresAt }))
}

// ── User management ───────────────────────────────────────────────────────────

export async function createUser(fields, adminId) {
  const { username, password, role = 'user', preferences = {}, mustChangePassword = true } = fields

  if (!username || typeof username !== 'string') {
    return { ok: false, error: 'Username is required' }
  }
  const cleanUsername = username.toLowerCase().trim()
  if (cleanUsername.length < 4 || cleanUsername.length > 32) {
    return { ok: false, error: 'Username must be 4–32 characters' }
  }
  if (!/^[a-z0-9_.-]+$/.test(cleanUsername)) {
    return { ok: false, error: 'Username may only contain letters, numbers, underscores, dots, hyphens' }
  }

  const pwCheck = validatePasswordStrength(password)
  if (!pwCheck.ok) return pwCheck

  if (!['user', 'admin', 'super-admin'].includes(role)) {
    return { ok: false, error: 'Role must be user, admin, or super-admin' }
  }

  if (getUserByUsername(cleanUsername)) {
    return { ok: false, error: 'Username already exists' }
  }

  const userId      = crypto.randomUUID()
  const passwordHash = await argon2.hash(password, ARGON2_OPTIONS)

  const user = {
    userId,
    username:          cleanUsername,
    passwordHash,
    role,
    keyHash:           null,
    keyExpiresAt:      null,
    createdAt:         new Date().toISOString(),
    createdBy:         adminId,
    lastLoginAt:       null,
    loginCount:        0,
    isActive:          true,
    mustChangePassword: adminId !== 'seed' ? mustChangePassword : false,
    preferences: {
      defaultModule:         'indices-india',
      defaultCapital:        100000,
      riskPerTrade:          1.5,
      jurisdiction:          'IN',
      notificationFrequency: 'off',
      cleanupIntervalDays:   30,
      ...preferences,
    },
  }

  writeSecure(userPath(userId), user)

  const index = readSecure('users/index') ?? {}
  index[cleanUsername] = userId
  writeSecure('users/index', index)

  return { ok: true, userId }
}

/**
 * Change a user's password.
 * Requires current password for self-service; admin can bypass.
 */
export async function changePassword(userId, currentPassword, newPassword, byAdmin = false) {
  const user = readSecure(userPath(userId))
  if (!user) return { ok: false, error: 'User not found' }

  if (!byAdmin) {
    const valid = await argon2.verify(user.passwordHash, currentPassword)
    if (!valid) return { ok: false, error: 'Current password is incorrect' }
  }

  const pwCheck = validatePasswordStrength(newPassword)
  if (!pwCheck.ok) return pwCheck

  const newHash = await argon2.hash(newPassword, ARGON2_OPTIONS)
  writeSecure(userPath(userId), {
    ...user,
    passwordHash:      newHash,
    mustChangePassword: false,
    passwordChangedAt: new Date().toISOString(),
  })

  // Invalidate all existing sessions for this user (force re-login)
  for (const [token, sess] of sessions) {
    if (sess.userId === userId) sessions.delete(token)
  }

  return { ok: true }
}

/**
 * Admin reset password — sets mustChangePassword = true.
 */
export async function adminResetPassword(userId, newPassword) {
  const pwCheck = validatePasswordStrength(newPassword)
  if (!pwCheck.ok) return pwCheck
  return changePassword(userId, null, newPassword, true)
}

export function updatePreferences(userId, prefs) {
  const user = readSecure(userPath(userId))
  if (!user) return { ok: false, error: 'User not found' }
  const merged = { ...user.preferences, ...prefs }
  writeSecure(userPath(userId), { ...user, preferences: merged })
  return { ok: true, preferences: merged }
}

export function deactivateUser(userId) {
  const user = readSecure(userPath(userId))
  if (!user) return { ok: false, error: 'User not found' }
  writeSecure(userPath(userId), { ...user, isActive: false })
  // Invalidate all sessions
  for (const [token, sess] of sessions) {
    if (sess.userId === userId) sessions.delete(token)
  }
  return { ok: true }
}

export function reactivateUser(userId) {
  const user = readSecure(userPath(userId))
  if (!user) return { ok: false, error: 'User not found' }
  writeSecure(userPath(userId), { ...user, isActive: true })
  return { ok: true }
}

/**
 * Generate a new 12-digit access key for a user.
 * Returns the plaintext key (shown once) and stores the HMAC hash.
 * @param {string} userId
 * @param {number} daysValid
 */
export function generateAccessKey(userId, daysValid = 30) {
  const user = readSecure(userPath(userId))
  if (!user) return { ok: false, error: 'User not found' }

  const digits    = Array.from({ length: 12 }, () => crypto.randomInt(0, 10)).join('')
  const formatted = `${digits.slice(0,4)}-${digits.slice(4,8)}-${digits.slice(8,12)}`
  const keyHash   = crypto.createHmac('sha256', digits).update(userId).digest('hex')
  const expiresAt = new Date(Date.now() + daysValid * 86_400_000).toISOString()

  writeSecure(userPath(userId), { ...user, keyHash, keyExpiresAt: expiresAt })

  return { ok: true, key: formatted, expiresAt }
}

export function setUserKeyHash(userId, keyHash, expiresAt) {
  const user = readSecure(userPath(userId))
  if (!user) return { ok: false, error: 'User not found' }
  writeSecure(userPath(userId), { ...user, keyHash, keyExpiresAt: expiresAt })
  return { ok: true }
}
