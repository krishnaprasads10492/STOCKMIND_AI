#!/usr/bin/env node
/**
 * setRole.js — Set a user's role in the encrypted user store.
 * Usage: node server/keygen/setRole.js <username> <role>
 * Roles: user | admin | super-admin
 */

import { fileURLToPath } from 'url'
import path from 'path'
import { initEncryption, readSecure, writeSecure } from '../storage/fileStore.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const [,, username, role] = process.argv

if (!username || !role) {
  console.error('Usage: node server/keygen/setRole.js <username> <role>')
  console.error('Roles: user | admin | super-admin')
  process.exit(1)
}

const validRoles = ['user', 'admin', 'super-admin']
if (!validRoles.includes(role)) {
  console.error(`Invalid role "${role}". Must be one of: ${validRoles.join(', ')}`)
  process.exit(1)
}

const DATA_PASSWORD = process.env.DATA_PASSWORD ?? 'stockmind-local-dev-password'

// Use async initEncryption so it matches what the server uses (Argon2id)
await initEncryption(DATA_PASSWORD)

// Find the user in the index
const index = readSecure('users/index')
if (!index) {
  console.error('No user index found — has the server been started at least once?')
  process.exit(1)
}

const userId = index[username.toLowerCase()] ?? index[username]
if (!userId) {
  console.error(`User "${username}" not found in index.`)
  console.log('Available users:', Object.keys(index).join(', '))
  process.exit(1)
}

const user = readSecure(`users/${userId}`)
if (!user) {
  console.error(`Could not read user record for ID ${userId}`)
  process.exit(1)
}

const oldRole = user.role
writeSecure(`users/${userId}`, { ...user, role })
console.log(`✓ Updated ${username} (${userId})`)
console.log(`  Role: ${oldRole} → ${role}`)
