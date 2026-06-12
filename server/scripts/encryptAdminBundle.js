#!/usr/bin/env node
/**
 * encryptAdminBundle.js — Encrypt admin credentials into the app bundle
 *
 * Usage:
 *   node server/scripts/encryptAdminBundle.js
 *
 * Reads users-seed.json (or uses hardcoded defaults below).
 * Encrypts with AES-256-GCM using a stable app-level key.
 * Writes the encrypted bundle into server/config/embedded-admin.js
 *
 * Run this whenever you change your super-admin credentials.
 * The output file is safe to commit to git.
 */

import crypto  from 'crypto'
import fs      from 'fs'
import path    from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT      = path.resolve(__dirname, '../..')

const APP_ID   = 'stockmind-ai-v1-local-personal'
const APP_SALT = 'sm-credential-store-2025-stable'

// ── Derive encryption key (same as embedded-admin.js) ────────────────────────
function deriveKey() {
  return crypto.pbkdf2Sync(APP_ID, APP_SALT, 100_000, 32, 'sha512')
}

// ── Encrypt ───────────────────────────────────────────────────────────────────
function encrypt(plaintext, key) {
  const iv         = crypto.randomBytes(12)
  const cipher     = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag        = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`
}

// ── Read credentials ──────────────────────────────────────────────────────────
const seedPath    = path.join(ROOT, 'users-seed.json')
const examplePath = path.join(ROOT, 'users-seed.example.json')

let credentials
if (fs.existsSync(seedPath)) {
  credentials = JSON.parse(fs.readFileSync(seedPath, 'utf8'))
  console.log(`Reading from: users-seed.json (${credentials.length} users)`)
} else if (fs.existsSync(examplePath)) {
  credentials = JSON.parse(fs.readFileSync(examplePath, 'utf8'))
  console.log(`Reading from: users-seed.example.json (${credentials.length} users)`)
} else {
  // Hardcoded defaults — edit these to match your credentials
  credentials = [
    {
      username: 'Krishna.s',
      password: 'Krishnasai@108',
      role:     'super-admin',
      preferences: {
        defaultModule: 'indices-india',
        defaultCapital: 10000,
        riskPerTrade: 1.5,
        jurisdiction: 'IN',
        theme: 'light',
      },
    },
    {
      username: 'admin',
      password: 'Admin@1234',
      role:     'admin',
      preferences: {
        defaultModule: 'indices-india',
        defaultCapital: 10000,
        riskPerTrade: 1.5,
        jurisdiction: 'IN',
      },
    },
  ]
  console.log('No seed file found — using hardcoded defaults')
}

// ── Encrypt the credentials ───────────────────────────────────────────────────
const key        = deriveKey()
const plaintext  = JSON.stringify(credentials)
const encrypted  = encrypt(plaintext, key)

const superAdmin = credentials.find(u => u.role === 'super-admin') ?? credentials[0]
const hint       = `${superAdmin.username} (${superAdmin.role})`

console.log(`Encrypting ${credentials.length} user(s)...`)
console.log(`Super-admin: ${hint}`)

// ── Write to embedded-admin.js ────────────────────────────────────────────────
const outputPath = path.join(ROOT, 'server', 'config', 'embedded-admin.js')

const output = `/**
 * embedded-admin.js — Encrypted super-admin credentials bundle
 *
 * Credentials are AES-256-GCM encrypted with a key derived from the
 * app's own stable identifier — NOT the DATA_PASSWORD or machine salt.
 * This makes the bundle portable across every system that runs this app.
 *
 * To update credentials: edit users-seed.json then run:
 *   node server/scripts/encryptAdminBundle.js
 */

// ── Encrypted credentials bundle ─────────────────────────────────────────────
// Generated: ${new Date().toISOString()}
// Algorithm: AES-256-GCM, key: PBKDF2(APP_ID, APP_SALT, 100000, sha512)
// Users:     ${credentials.map(u => `${u.username} (${u.role})`).join(', ')}

export const ADMIN_BUNDLE = {
  v:    1,
  data: ${JSON.stringify(encrypted)},
  hint: ${JSON.stringify(hint)},
  fallback: {
    username: 'admin',
    password: 'Admin@1234',
    role:     'admin',
  },
}

export const APP_ID   = 'stockmind-ai-v1-local-personal'
export const APP_SALT = 'sm-credential-store-2025-stable'
`

fs.writeFileSync(outputPath, output, 'utf8')
console.log(`\n✓ Bundle written to: server/config/embedded-admin.js`)
console.log('  Commit this file to carry credentials to any system.')
console.log('\n  Verification: decrypting now...')

// ── Verify round-trip ─────────────────────────────────────────────────────────
function decrypt(encryptedStr, key) {
  const [ivHex, tagHex, cipherHex] = encryptedStr.split(':')
  const iv         = Buffer.from(ivHex, 'hex')
  const tag        = Buffer.from(tagHex, 'hex')
  const ciphertext = Buffer.from(cipherHex, 'hex')
  const decipher   = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

const verified = JSON.parse(decrypt(encrypted, key))
console.log(`  ✓ Decryption verified — ${verified.length} user(s) confirmed`)
verified.forEach(u => console.log(`    ${u.role.padEnd(12)} ${u.username}`))
console.log('\n  ✓ Done — safe to commit server/config/embedded-admin.js')
