#!/usr/bin/env node
/**
 * setupSuperAdmin.js — One-time super-admin vault generator
 *
 * Run this ONCE on your machine. Never run it on a shared system.
 *
 *   node server/scripts/setupSuperAdmin.js
 *
 * What it does:
 *   1. Asks you to choose a passphrase (only you ever know this)
 *   2. Asks your super-admin username + password for the app
 *   3. Writes admin.vault — a one-way HMAC hash (safe to commit to git)
 *      + an encrypted credentials blob inside the vault
 *      The passphrase is the ONLY key — vault is useless without it
 *
 * Security guarantees:
 *   ✓ Passphrase never stored anywhere (not on disk, not in code)
 *   ✓ admin.vault reveals nothing — it's a one-way hash + ciphertext
 *   ✓ Other users who get the app CANNOT access your superadmin
 *   ✓ You can unlock superadmin on ANY system by typing your passphrase
 *   ✓ Works without git — just needs admin.vault to travel with the app
 */

import crypto  from 'crypto'
import fs      from 'fs'
import path    from 'path'
import readline from 'readline'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT      = path.resolve(__dirname, '../..')
const VAULT_PATH= path.join(ROOT, 'server', 'config', 'admin.vault')

const APP_ID = 'stockmind-ai-superadmin-vault-v1'

// ── Crypto helpers ────────────────────────────────────────────────────────────

function deriveKey(passphrase, salt) {
  // PBKDF2 with 600k iterations — makes brute force expensive
  return crypto.pbkdf2Sync(passphrase, salt + APP_ID, 600_000, 32, 'sha512')
}

function hmacVerifier(passphrase, salt) {
  // One-way HMAC — stored in vault to verify passphrase without storing it
  return crypto.createHmac('sha256', passphrase + APP_ID)
    .update(salt).digest('hex')
}

function encrypt(plaintext, key) {
  const iv     = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`
}

// ── Interactive prompt ────────────────────────────────────────────────────────

function prompt(question, hidden = false) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    if (hidden && process.stdin.isTTY) process.stdin.setRawMode(true)

    if (hidden) {
      process.stdout.write(question)
      let answer = ''
      process.stdin.setRawMode(true)
      process.stdin.resume()
      process.stdin.setEncoding('utf8')
      const onData = (char) => {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdin.removeListener('data', onData)
          process.stdout.write('\n')
          rl.close()
          resolve(answer)
        } else if (char === '\u0008' || char === '\u007f') {
          if (answer.length > 0) { answer = answer.slice(0, -1); process.stdout.write('\b \b') }
        } else {
          answer += char
          process.stdout.write('*')
        }
      }
      process.stdin.on('data', onData)
    } else {
      rl.question(question, answer => { rl.close(); resolve(answer.trim()) })
    }
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n╔══════════════════════════════════════════════════════╗')
console.log('║   StockMind AI — Super-Admin Vault Setup             ║')
console.log('╚══════════════════════════════════════════════════════╝\n')
console.log('This runs ONCE on your machine. Sets up your personal superadmin.')
console.log('The passphrase you choose is the ONLY way to unlock your account.')
console.log('It is NEVER stored anywhere — keep it in your head or password manager.\n')

const passphrase = await prompt('Choose your superadmin passphrase: ', true)
if (passphrase.length < 8) {
  console.error('\n✗ Passphrase too short (minimum 8 characters). Run again.')
  process.exit(1)
}

const confirm = await prompt('Confirm passphrase: ', true)
if (passphrase !== confirm) {
  console.error('\n✗ Passphrases do not match. Run again.')
  process.exit(1)
}

console.log('\nNow set your superadmin app credentials (what you log into the app with):')
const username = await prompt('Super-admin username [Krishna.s]: ') || 'Krishna.s'
const password = await prompt('Super-admin password [Krishnasai@108]: ', true) || 'Krishnasai@108'

if (password.length < 8) {
  console.error('\n✗ App password too short (minimum 8 characters). Run again.')
  process.exit(1)
}

// ── Generate vault ─────────────────────────────────────────────────────────

const salt      = crypto.randomBytes(32).toString('hex')
const key       = deriveKey(passphrase, salt)
const verifier  = hmacVerifier(passphrase, salt)

const payload = JSON.stringify({
  username,
  password,
  role: 'super-admin',
  preferences: {
    defaultModule:  'indices-india',
    defaultCapital: 10000,
    riskPerTrade:   1.5,
    jurisdiction:   'IN',
  },
})

const encrypted = encrypt(payload, key)

const vault = {
  version:   2,
  salt,
  verifier,        // HMAC of passphrase — used to check passphrase is correct
  credentials: encrypted,  // AES-256-GCM encrypted credentials
  hint:        username,   // only username shown (no password)
  createdAt:   new Date().toISOString(),
  app:         APP_ID,
}

fs.writeFileSync(VAULT_PATH, JSON.stringify(vault, null, 2), 'utf8')

console.log('\n✓ Vault written to: server/config/admin.vault')
console.log('  This file is SAFE to commit to git / copy with the app.')
console.log('  It is useless without your passphrase.\n')
console.log('✓ Your super-admin:')
console.log(`  Username: ${username}`)
console.log('  Password: [hidden]')
console.log('\nTo unlock on any system:')
console.log('  1. Run the app: node start.js --dev')
console.log('  2. Go to: http://localhost:4098/superadmin-unlock')
console.log('  3. Enter your passphrase')
console.log('  4. Your super-admin account is created and you are logged in\n')
console.log('⚠  REMEMBER your passphrase. There is no recovery if you forget it.')
