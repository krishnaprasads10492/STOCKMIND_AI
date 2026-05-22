#!/usr/bin/env node
/**
 * migrateToMongo.js — One-shot migration from encrypted local files → MongoDB Atlas.
 *
 * Run AFTER setting MONGODB_ATLAS_URI in your .env:
 *   node server/scripts/migrateToMongo.js
 *
 * What it migrates:
 *   ✓ Users (without passwordHash / keyHash — those stay local)
 *   ✓ Prediction batches
 *   ✓ Deviation records
 *   ✓ Backtest results
 *   ✓ AMI records (scenarios, danger-log, mtf-signals)
 *   ✓ Market sessions
 *   ✗ Audit log (stays local — HMAC chain requires sequential local writes)
 *   ✗ System salt / encryption keys (never leave local storage)
 *
 * Safe to re-run — uses upsert, won't duplicate data.
 * Local files are NOT deleted — they remain as fallback.
 */

import path from 'path'
import { fileURLToPath } from 'url'
const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Load .env
import { readFileSync, existsSync } from 'fs'
const envPath = path.resolve(__dirname, '../../.env')
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=')
    if (k && v.length && !process.env[k]) process.env[k.trim()] = v.join('=').trim()
  })
}

// Init encryption (needed to read local files)
const DATA_PASSWORD = process.env.DATA_PASSWORD ?? 'stockmind-local-dev-password'
import { initEncryption, listSecure, readSecure } from '../storage/fileStore.js'
await initEncryption(DATA_PASSWORD)

import { connectMongo, getMongoService } from '../services/mongoService.js'

// ── Progress tracker ──────────────────────────────────────────────────────────

let migrated = 0, skipped = 0, errors = 0
const startTime = Date.now()

function log(category, count, detail = '') {
  console.log(`  [${category.padEnd(18)}] ${String(count).padStart(5)} records ${detail}`)
}

function err(category, e) {
  errors++
  console.error(`  [${category}] ERROR: ${e.message}`)
}

// ── Connect ───────────────────────────────────────────────────────────────────

console.log('\n🔄 StockMind AI — MongoDB Migration\n')
console.log('Connecting to MongoDB Atlas...')

const db = await connectMongo()
if (!db) {
  console.error('\n❌ Cannot connect to MongoDB. Check MONGODB_ATLAS_URI in .env\n')
  process.exit(1)
}

const mongo = await getMongoService()
console.log('✓ Connected\n')
console.log('Migrating data categories:\n')

// ── 1. Users ──────────────────────────────────────────────────────────────────

try {
  const index = readSecure('users/index') ?? {}
  let userCount = 0
  for (const [username, userId] of Object.entries(index)) {
    const user = readSecure(`users/${userId}`)
    if (!user) continue
    // Strip sensitive fields — store profile only
    const { passwordHash: _, keyHash: __, ...safeUser } = user
    await mongo.users.upsert(userId, { ...safeUser, username: username.toLowerCase() })
    userCount++
    migrated++
  }
  log('users', userCount, '(passwords remain local)')
} catch (e) { err('users', e) }

// ── 2. Prediction batches ────────────────────────────────────────────────────

try {
  const months = listSecure('predictions').filter(f => /^\d{4}-\d{2}$/.test(f))
  let batchCount = 0
  for (const month of months) {
    const files = listSecure(`predictions/${month}`).filter(f => f.includes('_batch_'))
    for (const file of files) {
      const batch = readSecure(`predictions/${month}/${file}`)
      if (!batch?.batchId) continue
      await mongo.predictions.upsert(batch.batchId, batch)
      batchCount++
      migrated++
    }
  }
  log('prediction_batches', batchCount, `across ${months.length} months`)
} catch (e) { err('prediction_batches', e) }

// ── 3. Deviation records ─────────────────────────────────────────────────────

try {
  const devFiles = listSecure('predictions/deviations')
  let devCount = 0
  for (const file of devFiles) {
    const data = readSecure(`predictions/deviations/${file}`)
    if (!data?.symbol) continue
    const records = data.records ?? []
    for (const rec of records) {
      if (!rec.id && !rec.ts) continue
      const id = rec.id ?? `${rec.symbol}_${rec.ts}`
      await mongo.deviations.upsert(id, { ...rec, symbol: data.symbol })
      devCount++
      migrated++
    }
  }
  log('deviations', devCount)
} catch (e) { err('deviations', e) }

// ── 4. Backtest results ──────────────────────────────────────────────────────

try {
  const files = listSecure('backtest')
  let btCount = 0
  for (const file of files) {
    const result = readSecure(`backtest/${file}`)
    if (!result?.symbol) continue
    const key = `${result.symbol}_${(result.modelVersion ?? 'unknown').replace(/[^a-z0-9_]/gi, '_')}`
    await mongo.backtests.upsert(key, result)
    btCount++
    migrated++
  }
  log('backtest_results', btCount)
} catch (e) { err('backtest_results', e) }

// ── 5. AMI records ───────────────────────────────────────────────────────────

try {
  const types = ['scenarios', 'trendlines', 'danger-log', 'mtf-signals']
  let amiCount = 0
  const symbols = listSecure('ami')
  for (const symbol of symbols) {
    for (const type of types) {
      const ids = listSecure(`ami/${symbol}/${type}`)
      for (const id of ids) {
        const record = readSecure(`ami/${symbol}/${type}/${id}`)
        if (!record) continue
        await mongo.ami.upsert(id, { ...record, symbol, type })
        amiCount++
        migrated++
      }
    }
  }
  log('ami_records', amiCount, `across ${symbols.length} symbols`)
} catch (e) { err('ami_records', e) }

// ── 6. Market sessions ───────────────────────────────────────────────────────

try {
  let sessionCount = 0
  const dates = listSecure('market-sessions')
  for (const date of dates) {
    const symbols = listSecure(`market-sessions/${date}`)
    for (const symbol of symbols) {
      const record = readSecure(`market-sessions/${date}/${symbol}`)
      if (!record) continue
      await mongo.marketSessions.upsertSession(symbol, date, record)
      sessionCount++
      migrated++
    }
  }
  log('market_sessions', sessionCount, `across ${dates.length} dates`)
} catch (e) { err('market_sessions', e) }

// ── Summary ───────────────────────────────────────────────────────────────────

const duration = ((Date.now() - startTime) / 1000).toFixed(1)
console.log('\n─────────────────────────────────────────')
console.log(`✓ Migration complete in ${duration}s`)
console.log(`  Migrated: ${migrated}`)
console.log(`  Skipped:  ${skipped}`)
console.log(`  Errors:   ${errors}`)
if (errors > 0) console.log('  ⚠ Check errors above — local files unchanged')
console.log('\nNext steps:')
console.log('  1. Set MONGODB_ENABLED=true in .env')
console.log('  2. Set all DB_* routes to "mongodb" in .env')
console.log('  3. Restart: node start.js --dev')
console.log('  4. Verify data at https://cloud.mongodb.com\n')

process.exit(errors > 0 ? 1 : 0)
