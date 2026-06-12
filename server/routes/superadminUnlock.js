/**
 * superadminUnlock.js — Personal Identity Token unlock route
 *
 * POST /api/superadmin/unlock
 *   Body: { passphrase }
 *   Verifies passphrase against admin.vault HMAC
 *   If correct: creates superadmin account (if not exists) + returns session
 *   Passphrase is NEVER logged, stored, or echoed back
 *
 * GET /api/superadmin/vault-status
 *   Returns: { vaultExists, hint } — safe to expose (no secret data)
 *
 * Security:
 *   - Rate limited: 3 attempts per 15 minutes per IP
 *   - Timing-safe comparison (prevents timing attacks)
 *   - No information leakage on wrong passphrase
 *   - Passphrase cleared from memory immediately after use
 *   - All attempts logged to audit trail
 */

import { Router }   from 'express'
import crypto       from 'crypto'
import fs           from 'fs'
import path         from 'path'
import { fileURLToPath } from 'url'
import rateLimit    from 'express-rate-limit'
import { createUser, loginStep2, generateAccessKey,
         getUserByUsername } from '../services/authService.js'
import { auditLog } from '../storage/auditLog.js'

const router    = Router()
const __dirname = fileURLToPath(new URL('.', import.meta.url))
const VAULT_PATH= path.resolve(__dirname, '../config/admin.vault')
const APP_ID    = 'stockmind-ai-superadmin-vault-v1'

// ── Rate limiter: 3 attempts per 15 min ──────────────────────────────────────
const unlockLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             3,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many unlock attempts. Try again in 15 minutes.' },
  skipSuccessfulRequests: true,   // only count failures
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadVault() {
  try {
    if (!fs.existsSync(VAULT_PATH)) return null
    const raw = fs.readFileSync(VAULT_PATH, 'utf8').trim()
    if (!raw || raw === 'placeholder') return null
    const vault = JSON.parse(raw)
    if (vault.version !== 2 || !vault.salt || !vault.verifier || !vault.credentials) return null
    return vault
  } catch { return null }
}

function deriveKey(passphrase, salt) {
  return crypto.pbkdf2Sync(passphrase, salt + APP_ID, 600_000, 32, 'sha512')
}

function hmacVerifier(passphrase, salt) {
  return crypto.createHmac('sha256', passphrase + APP_ID)
    .update(salt).digest('hex')
}

function decrypt(encryptedStr, key) {
  const [ivHex, tagHex, ctHex] = encryptedStr.split(':')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key,
    Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(ctHex, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}

function verifyPassphrase(passphrase, vault) {
  try {
    const expected = hmacVerifier(passphrase, vault.salt)
    const actual   = vault.verifier
    // Pad to equal length for timingSafeEqual
    const a = Buffer.from(expected.padEnd(128, '0'))
    const b = Buffer.from(actual.padEnd(128, '0'))
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch { return false }
}

// ── GET /api/superadmin/vault-status ─────────────────────────────────────────
// Safe to call unauthenticated — reveals no secret data

router.get('/vault-status', (req, res) => {
  const vault = loadVault()
  if (!vault) {
    return res.json({
      vaultExists: false,
      hint:        null,
      message:     'No superadmin vault configured. Run: node server/scripts/setupSuperAdmin.js',
    })
  }
  res.json({
    vaultExists: true,
    hint:        vault.hint ?? 'superadmin',
    createdAt:   vault.createdAt ?? null,
    message:     'Vault present. Enter your passphrase to unlock.',
  })
})

// ── POST /api/superadmin/unlock ───────────────────────────────────────────────
// Core unlock endpoint — verify passphrase, create account if needed, return session

router.post('/unlock', unlockLimiter, async (req, res) => {
  const ip = req.ip ?? 'unknown'

  // Validate input
  const passphrase = typeof req.body?.passphrase === 'string'
    ? req.body.passphrase
    : ''

  if (!passphrase || passphrase.length < 4) {
    return res.status(400).json({ error: 'Passphrase required' })
  }

  // Load vault
  const vault = loadVault()
  if (!vault) {
    auditLog('superadmin_unlock_no_vault', { ip })
    return res.status(404).json({
      error: 'No superadmin vault found on this system.',
      setup: 'Run: node server/scripts/setupSuperAdmin.js — then copy admin.vault with the app.',
    })
  }

  // Verify passphrase (timing-safe)
  const correct = verifyPassphrase(passphrase, vault)

  // Clear passphrase from memory as soon as possible
  // (JS doesn't guarantee this but it's best effort)
  req.body.passphrase = ''.padEnd(passphrase.length, '*')

  if (!correct) {
    auditLog('superadmin_unlock_failed', { ip, hint: vault.hint })
    // Same response as wrong passphrase — no info leakage
    return res.status(401).json({ error: 'Invalid passphrase' })
  }

  // Decrypt credentials
  let creds
  try {
    const key = deriveKey(passphrase, vault.salt)
    creds = JSON.parse(decrypt(vault.credentials, key))
  } catch (e) {
    auditLog('superadmin_unlock_decrypt_fail', { ip })
    return res.status(500).json({ error: 'Vault decryption failed — vault may be corrupt' })
  }

  // Create superadmin account if it doesn't exist yet on this system
  const existing = getUserByUsername(creds.username)
  if (!existing) {
    const result = await createUser({
      username:          creds.username,
      password:          creds.password,
      role:              'super-admin',
      preferences:       creds.preferences ?? {},
      mustChangePassword: false,
    }, 'superadmin-vault')

    if (!result.ok) {
      auditLog('superadmin_unlock_create_failed', { ip, error: result.error })
      return res.status(500).json({ error: `Failed to create account: ${result.error}` })
    }
    auditLog('superadmin_unlock_created', { ip, username: creds.username })
  }

  // Generate a fresh 12-digit access key valid for 1 day
  const user = getUserByUsername(creds.username)
  if (!user) return res.status(500).json({ error: 'Account lookup failed after creation' })

  const keyResult = generateAccessKey(user.userId, 1)  // 1 day
  if (!keyResult.ok) return res.status(500).json({ error: 'Key generation failed' })

  auditLog('superadmin_unlock_success', { ip, username: creds.username })

  // Return everything needed to log in — user pastes key into login screen
  return res.json({
    ok:        true,
    message:   `Super-admin "${creds.username}" is ready on this system.`,
    username:  creds.username,
    key:       keyResult.key,        // 12-digit key — valid 24h
    expiresAt: keyResult.expiresAt,
    note:      'Use this key at Step 2 of the login screen. Key expires in 24 hours.',
    warning:   'This key was shown ONCE. It cannot be retrieved again.',
  })
})

export default router
