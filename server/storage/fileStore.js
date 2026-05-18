/**
 * fileStore.js — encrypted local file storage.
 *
 * AES-256-GCM encryption on every read/write.
 * Key derived from admin password via PBKDF2.
 * No external DB — everything is JSON files on disk.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DATA_ROOT = path.resolve(__dirname, '../../data')
const SALT_FILE = path.join(DATA_ROOT, 'system', '.salt')

const PBKDF2_ITERATIONS = 100_000
const KEY_LEN = 32
const IV_LEN = 12
const TAG_LEN = 16

let _encKey = null // Buffer — set once on startup

// ── Key management ────────────────────────────────────────────────────────────

function getSalt() {
  const saltPath = SALT_FILE
  if (fs.existsSync(saltPath)) {
    return fs.readFileSync(saltPath)
  }
  const salt = crypto.randomBytes(32)
  fs.mkdirSync(path.dirname(saltPath), { recursive: true })
  fs.writeFileSync(saltPath, salt)
  return salt
}

/**
 * Derive and cache the encryption key from the admin password.
 * Must be called once at server startup before any file operations.
 * @param {string} password
 */
export function initEncryption(password) {
  const salt = getSalt()
  _encKey = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LEN, 'sha256')
}

function getKey() {
  if (!_encKey) throw new Error('Encryption not initialised — call initEncryption() first')
  return _encKey
}

// ── Core encrypt / decrypt ────────────────────────────────────────────────────

function encrypt(plaintext) {
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Layout: [IV (12)] [TAG (16)] [CIPHERTEXT]
  return Buffer.concat([iv, tag, encrypted])
}

function decrypt(buf) {
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN)
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv)
  decipher.setAuthTag(tag)
  return decipher.update(ciphertext) + decipher.final('utf8')
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Write an object as an encrypted JSON file.
 * @param {string} relPath - relative to data/
 * @param {object} data
 */
export function writeSecure(relPath, data) {
  const fullPath = path.join(DATA_ROOT, relPath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  const json = JSON.stringify(data, null, 2)
  const encrypted = encrypt(json)
  fs.writeFileSync(fullPath + '.enc', encrypted)
}

/**
 * Read and decrypt an encrypted JSON file.
 * @param {string} relPath - relative to data/ (without .enc)
 * @returns {object|null}
 */
export function readSecure(relPath) {
  const fullPath = path.join(DATA_ROOT, relPath) + '.enc'
  if (!fs.existsSync(fullPath)) return null
  try {
    const buf = fs.readFileSync(fullPath)
    const json = decrypt(buf)
    return JSON.parse(json)
  } catch {
    console.error('[fileStore] Decryption failed for', relPath)
    return null
  }
}

/**
 * Check if an encrypted file exists.
 * @param {string} relPath
 */
export function existsSecure(relPath) {
  return fs.existsSync(path.join(DATA_ROOT, relPath) + '.enc')
}

/**
 * Delete an encrypted file.
 * @param {string} relPath
 */
export function deleteSecure(relPath) {
  const fullPath = path.join(DATA_ROOT, relPath) + '.enc'
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath)
}

/**
 * List all .enc files in a directory (returns base names without .enc).
 * @param {string} relDir
 * @returns {string[]}
 */
export function listSecure(relDir) {
  const fullDir = path.join(DATA_ROOT, relDir)
  if (!fs.existsSync(fullDir)) return []
  return fs.readdirSync(fullDir)
    .filter(f => f.endsWith('.enc'))
    .map(f => f.replace(/\.enc$/, ''))
}

/**
 * Append a row to a plain CSV file (not encrypted — summary data only).
 * @param {string} relPath
 * @param {string} row - CSV row string (no newline needed)
 */
export function appendCsv(relPath, row) {
  const fullPath = path.join(DATA_ROOT, relPath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.appendFileSync(fullPath, row + '\n', 'utf8')
}

/**
 * Read a plain CSV file.
 * @param {string} relPath
 * @returns {string}
 */
export function readCsv(relPath) {
  const fullPath = path.join(DATA_ROOT, relPath)
  if (!fs.existsSync(fullPath)) return ''
  return fs.readFileSync(fullPath, 'utf8')
}

export { DATA_ROOT }
