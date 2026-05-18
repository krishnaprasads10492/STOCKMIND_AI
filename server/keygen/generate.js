#!/usr/bin/env node
/**
 * StockMind AI — Key Generator
 *
 * Usage:
 *   npm run keygen admin
 *   npm run keygen admin 60          (custom expiry days, default 30)
 *
 * DATA_PASSWORD env var must match the password used when the server started.
 * Default: stockmind-local-dev-password
 *
 * The 12-digit key is printed ONCE and never stored.
 */

import crypto from 'crypto'
import { initEncryption } from '../storage/fileStore.js'
import { getUserByUsername, setUserKeyHash } from '../services/authService.js'

const DATA_PASSWORD = process.env.DATA_PASSWORD ?? 'stockmind-local-dev-password'
initEncryption(DATA_PASSWORD)

const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
const username   = args[0]
const daysValid  = Number(args[1] ?? 30)

if (!username) {
  console.error('\nUsage:  npm run keygen <username>')
  console.error('        npm run keygen <username> <days>')
  console.error('\nExample: npm run keygen admin')
  console.error('         npm run keygen admin 60\n')
  process.exit(1)
}

const user = getUserByUsername(username)
if (!user) {
  console.error(`\n✗ User "${username}" not found.`)
  console.error('  Check users-seed.json or create the user via the Admin panel.\n')
  process.exit(1)
}

const digits    = Array.from({ length: 12 }, () => crypto.randomInt(0, 10)).join('')
const formatted = `${digits.slice(0,4)}-${digits.slice(4,8)}-${digits.slice(8,12)}`
const keyHash   = crypto.createHmac('sha256', digits).update(user.userId).digest('hex')
const expiresAt = new Date(Date.now() + daysValid * 86_400_000).toISOString()

const result = setUserKeyHash(user.userId, keyHash, expiresAt)
if (!result.ok) { console.error('Failed to store key:', result.error); process.exit(1) }

console.log('\n╔══════════════════════════════════════╗')
console.log('║     StockMind AI — Access Key        ║')
console.log('╠══════════════════════════════════════╣')
console.log(`║  User    : ${username.padEnd(26)}║`)
console.log(`║  Key     : ${formatted.padEnd(26)}║`)
console.log(`║  Expires : ${expiresAt.slice(0,10).padEnd(26)}║`)
console.log('╠══════════════════════════════════════╣')
console.log('║  ⚠  This key will NOT be shown again ║')
console.log('╚══════════════════════════════════════╝\n')
