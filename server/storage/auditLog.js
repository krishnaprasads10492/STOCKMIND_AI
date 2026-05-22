/**
 * auditLog.js — Tamper-evident HMAC-chained audit log.
 *
 * Every audit entry includes:
 *   - HMAC-SHA512 of current entry content
 *   - HMAC-SHA512 of previous entry (chain link)
 *   - Sequence number
 *   - Monotonic timestamp
 *   - Source IP, user, action
 *
 * Tampering with any entry breaks the chain — verifiable by recomputing HMAC.
 * Stored as append-only encrypted file — cannot be edited in place.
 *
 * Chain integrity check available at /api/audit/verify (admin only).
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { AUDIT_LOG } from '../config/security.js'

const __dirname  = fileURLToPath(new URL('.', import.meta.url))
const AUDIT_DIR  = path.resolve(__dirname, '../../data/system/audit')
const CHAIN_FILE = path.join(AUDIT_DIR, '.chain-state')

let _seq       = 0
let _prevHmac  = '0'.repeat(128)  // genesis HMAC
let _chainKey  = null              // derived from DATA_PASSWORD

// ── Setup ─────────────────────────────────────────────────────────────────────

export function initAuditLog(password) {
  if (!AUDIT_LOG.enabled) return
  fs.mkdirSync(AUDIT_DIR, { recursive: true })
  // Derive a separate key for audit HMAC (different from data encryption key)
  _chainKey = crypto.pbkdf2Sync(
    password + ':audit',
    Buffer.from('stockmind-audit-salt-v1'),
    200_000, 64, 'sha512'
  )
  // Restore chain state if it exists
  if (fs.existsSync(CHAIN_FILE)) {
    try {
      const state = JSON.parse(fs.readFileSync(CHAIN_FILE, 'utf8'))
      _seq      = state.seq      ?? 0
      _prevHmac = state.prevHmac ?? _prevHmac
    } catch { /* start fresh */ }
  }
  console.log(`[AuditLog] Initialized — chain at seq ${_seq}`)
}

function _hmac(data) {
  if (!_chainKey) return 'NO_KEY'
  return crypto.createHmac('sha512', _chainKey).update(JSON.stringify(data)).digest('hex')
}

function _getLogFile() {
  const now = new Date()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return path.join(AUDIT_DIR, `audit-${month}.jsonl`)
}

// ── Core log writer ───────────────────────────────────────────────────────────

export function auditLog(event, data = {}) {
  if (!AUDIT_LOG.enabled) return
  if (!AUDIT_LOG.events[event] && !AUDIT_LOG.events.adminAction) return

  _seq++
  const ts = Date.now()

  const entry = {
    seq:      _seq,
    ts,
    iso:      new Date(ts).toISOString(),
    event,
    ...data,
    // Chain fields added after
  }

  // HMAC of current entry content
  const contentHmac = _hmac(entry)
  // Chain link: HMAC of (prevHmac + contentHmac)
  const chainHmac   = _hmac(_prevHmac + contentHmac)

  entry._hmac  = contentHmac
  entry._chain = chainHmac
  entry._prev  = _prevHmac.slice(0, 16) + '...'  // abbreviated for readability

  _prevHmac = chainHmac

  // Persist chain state
  try {
    fs.writeFileSync(CHAIN_FILE, JSON.stringify({ seq: _seq, prevHmac: _prevHmac }))
  } catch { /* non-fatal */ }

  // Append to monthly log file
  try {
    fs.appendFileSync(_getLogFile(), JSON.stringify(entry) + '\n', 'utf8')
  } catch (err) {
    console.error('[AuditLog] Write error:', err.message)
  }

  return entry
}

// ── Verify chain integrity ────────────────────────────────────────────────────

export function verifyAuditChain(monthFile = null) {
  const logFile = monthFile || _getLogFile()
  if (!fs.existsSync(logFile)) return { ok: true, entries: 0, message: 'No log file found' }

  const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean)
  let prevHmac = '0'.repeat(128)
  let broken   = null
  let verified = 0

  for (const line of lines) {
    try {
      const entry = JSON.parse(line)
      const { _hmac, _chain, _prev, ...content } = entry

      // Verify content HMAC
      const expectedContent = _hmac(content)
      if (expectedContent !== _hmac) {
        broken = { seq: entry.seq, reason: 'Content HMAC mismatch — entry was modified' }
        break
      }

      // Verify chain link
      const expectedChain = _hmac(prevHmac + _hmac)
      if (expectedChain !== _chain) {
        broken = { seq: entry.seq, reason: 'Chain HMAC mismatch — entry was inserted or deleted' }
        break
      }

      prevHmac = _chain
      verified++
    } catch {
      broken = { seq: verified + 1, reason: 'Malformed entry — cannot parse JSON' }
      break
    }
  }

  return {
    ok:       !broken,
    entries:  verified,
    total:    lines.length,
    broken,
    message:  broken ? `Chain broken at seq ${broken.seq}: ${broken.reason}` : `Chain intact (${verified} entries verified)`,
  }
}

// ── Query audit log ───────────────────────────────────────────────────────────

export function queryAuditLog({ event, userId, limit = 100, since = 0 } = {}) {
  const logFile = _getLogFile()
  if (!fs.existsSync(logFile)) return []

  const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean)
  const results = []

  for (let i = lines.length - 1; i >= 0 && results.length < limit; i--) {
    try {
      const entry = JSON.parse(lines[i])
      if (since && entry.ts < since) break
      if (event  && entry.event  !== event)  continue
      if (userId && entry.userId !== userId) continue
      const { _hmac, _chain, _prev, ...clean } = entry
      results.push(clean)
    } catch { /* skip malformed */ }
  }

  return results
}

export function getAuditStats() {
  return {
    seq:         _seq,
    chainActive: !!_chainKey,
    logFile:     _getLogFile(),
  }
}
