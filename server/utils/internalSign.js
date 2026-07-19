/**
 * internalSign.js — HMAC-SHA256 request signing for Node.js → Python internal calls.
 *
 * Adds x-stockmind-ts and x-stockmind-sig headers to every request so the
 * Python backend can verify the call originated from this Node.js process.
 *
 * Python side verification (optional, when REQUEST_SIGNING_ENABLED=true):
 *   ts  = request.headers["x-stockmind-ts"]
 *   sig = request.headers["x-stockmind-sig"]
 *   expected = hmac.new(SECRET.encode(), (ts + json.dumps(body)).encode(), sha256).hexdigest()
 *   assert hmac.compare_digest(sig, expected)
 */

import crypto from 'crypto'

const SECRET = process.env.REQUEST_SIGNING_SECRET || process.env.DATA_PASSWORD || 'internal-dev'

/**
 * Generate signed headers for an internal call to the Python backend.
 * @param {object|string} body  Request body (will be JSON-serialized for signing)
 * @returns {object}            Headers object to merge into fetch options
 */
export function signedHeaders(body = '') {
  const ts  = Date.now().toString()
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body)
  const sig = crypto
    .createHmac('sha256', SECRET)
    .update(ts + bodyStr)
    .digest('hex')

  return {
    'x-stockmind-ts':  ts,
    'x-stockmind-sig': sig,
  }
}
