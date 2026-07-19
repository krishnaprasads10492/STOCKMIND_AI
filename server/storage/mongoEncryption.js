/**
 * mongoEncryption.js — Field-level AES-256-GCM encryption for MongoDB documents.
 *
 * Security model:
 *   - Every sensitive string field is encrypted with a random IV before Atlas write
 *   - Same plaintext encrypts to different ciphertext every time (IV is random)
 *   - Key is derived per-field via PBKDF2-SHA256(DATA_PASSWORD + "mongo-field-v1" + fieldPath)
 *   - Encrypted fields are stored as: { __enc: true, iv: hex, tag: hex, ct: hex }
 *   - Backward-compatible: if a field does NOT have __enc marker, it is returned as-is
 *   - Fields required for indexes/queries are never encrypted (see SKIP_FIELDS)
 *
 * Usage:
 *   import { encryptDoc, decryptDoc, initMongoEncryption } from '../storage/mongoEncryption.js'
 *   initMongoEncryption(dataPassword)           // call once at startup
 *   const safe = encryptDoc('rama_conversations', doc)  // before insert/update
 *   const plain = decryptDoc('rama_conversations', doc) // after read
 */

import crypto from 'crypto'

// ── Master password + key cache ───────────────────────────────────────────────

let _masterPassword = null
const _keyCache = new Map()  // fieldPath → Buffer(32)

export function initMongoEncryption(password) {
  if (!password || typeof password !== 'string') {
    console.warn('[MongoEnc] initMongoEncryption called with empty password — encryption disabled')
    return
  }
  _masterPassword = password
}

/**
 * Derive a 32-byte AES key for a specific field path.
 * Cached after first derivation — PBKDF2 is expensive.
 * Key material: PBKDF2-SHA256(masterPassword, "mongo-field-v1:" + fieldPath, 100000, 32)
 */
function _deriveKey(fieldPath) {
  if (_keyCache.has(fieldPath)) return _keyCache.get(fieldPath)
  const salt = Buffer.from('mongo-field-v1:' + fieldPath, 'utf8')
  const key  = crypto.pbkdf2Sync(_masterPassword, salt, 100_000, 32, 'sha256')
  _keyCache.set(fieldPath, key)
  return key
}

// ── Fields that MUST NOT be encrypted (used in queries/indexes/TTL) ───────────
// These are needed for MongoDB queries, indexes, sorting, or TTL.

const SKIP_FIELDS = new Set([
  '_id', '_createdAt', '_updatedAt',
  // Index and query fields
  'symbol', 'type', 'userId', 'userRole', 'role',
  'lastMessageAt', 'createdAt', 'updatedAt', 'startedAt', 'generatedAt',
  'savedAt', 'ts', 'date',
  // Boolean/numeric query fields
  'starred', 'pinned', 'importance', 'messageCount', 'totalTokens',
  'tokens', 'loginCount',
  // Provider/type fields used in filtering
  'provider', 'source', 'event', 'intent',
  // Numeric/status fields
  'isActive', 'wasFiltered',
])

// ── Per-collection field maps ─────────────────────────────────────────────────
// Maps collection name → Set of field names to encrypt.
// Fields not listed here but matching GENERIC_FIELDS are also encrypted.

const COLLECTION_FIELDS = {
  rama_conversations: new Set(['title', 'messages', 'username']),
  rama_knowledge:     new Set(['topic', 'content', 'username']),
  users:              new Set(['username', 'email', 'preferences']),
  prediction_batches: new Set(['signals', 'symbol']),
  audit_log:          new Set(['details', 'userId', 'meta']),
}

// Generic field names always encrypted regardless of collection
const GENERIC_FIELDS = new Set(['content', 'message', 'text', 'data', 'details'])

/**
 * Determine whether a field in a given collection should be encrypted.
 */
function _shouldEncrypt(collection, fieldName) {
  if (SKIP_FIELDS.has(fieldName)) return false
  const colFields = COLLECTION_FIELDS[collection]
  if (colFields && colFields.has(fieldName)) return true
  if (GENERIC_FIELDS.has(fieldName)) return true
  return false
}

// ── Core encrypt / decrypt for a single value ─────────────────────────────────

/**
 * Encrypt a string value for a specific field path.
 * Returns: { __enc: true, iv: hex, tag: hex, ct: hex }
 * Non-string values or null/undefined are returned as-is.
 */
function _encryptField(fieldPath, value) {
  if (!_masterPassword) return value
  if (value === null || value === undefined) return value

  // Serialize non-strings (arrays, objects) to JSON
  let plaintext
  if (typeof value === 'string') {
    plaintext = value
  } else if (typeof value === 'object' || Array.isArray(value)) {
    try { plaintext = JSON.stringify(value) } catch { return value }
  } else {
    // Numbers, booleans — not encrypted
    return value
  }

  const key    = _deriveKey(fieldPath)
  const iv     = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()

  return {
    __enc: true,
    iv:    iv.toString('hex'),
    tag:   tag.toString('hex'),
    ct:    ct.toString('hex'),
  }
}

/**
 * Decrypt an encrypted field envelope.
 * If the value does not have __enc marker, returns as-is (backward compat).
 */
function _decryptField(fieldPath, value) {
  if (!_masterPassword) return value
  if (!value || typeof value !== 'object' || value.__enc !== true) return value

  try {
    const key      = _deriveKey(fieldPath)
    const iv       = Buffer.from(value.iv,  'hex')
    const tag      = Buffer.from(value.tag, 'hex')
    const ct       = Buffer.from(value.ct,  'hex')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')

    // Try to parse JSON (for arrays/objects that were serialized)
    try {
      return JSON.parse(plaintext)
    } catch {
      return plaintext
    }
  } catch (err) {
    console.error(`[MongoEnc] Decryption failed for field "${fieldPath}":`, err.message)
    return value  // return encrypted envelope on failure — do not throw
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Encrypt all encryptable fields in a document before MongoDB write.
 * Mutates a shallow copy — does NOT mutate the original.
 * @param {string} collection  MongoDB collection name
 * @param {object} doc         Document to encrypt
 * @returns {object}           New document with sensitive fields encrypted
 */
export function encryptDoc(collection, doc) {
  if (!_masterPassword || !doc || typeof doc !== 'object') return doc
  const result = { ...doc }
  for (const [key, value] of Object.entries(result)) {
    if (_shouldEncrypt(collection, key)) {
      result[key] = _encryptField(`${collection}.${key}`, value)
    }
  }
  return result
}

/**
 * Decrypt all encrypted fields in a document after MongoDB read.
 * Mutates a shallow copy — does NOT mutate the original.
 * Backward-compatible: unencrypted fields pass through untouched.
 * @param {string} collection  MongoDB collection name
 * @param {object} doc         Document read from MongoDB
 * @returns {object}           New document with fields decrypted
 */
export function decryptDoc(collection, doc) {
  if (!doc || typeof doc !== 'object') return doc
  const result = { ...doc }
  for (const [key, value] of Object.entries(result)) {
    // Only attempt decrypt if field has __enc marker
    if (value && typeof value === 'object' && value.__enc === true) {
      result[key] = _decryptField(`${collection}.${key}`, value)
    }
  }
  return result
}

/**
 * Decrypt an array of documents (convenience wrapper for find() results).
 */
export function decryptDocs(collection, docs) {
  if (!Array.isArray(docs)) return docs
  return docs.map(doc => decryptDoc(collection, doc))
}

export default { initMongoEncryption, encryptDoc, decryptDoc, decryptDocs }
