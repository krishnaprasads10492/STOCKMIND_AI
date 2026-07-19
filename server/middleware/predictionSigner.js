/**
 * predictionSigner.js — HMAC-SHA256 signing and verification for prediction payloads.
 *
 * Signs prediction payloads before sending to frontend so the client can verify
 * the payload was not tampered with in transit.
 *
 * Frontend verification:
 *   import { verifyPrediction } from '@utils/hmac.js'
 *   const ok = verifyPrediction(payload, import.meta.env.VITE_HMAC_VERIFY_KEY)
 *
 * Secret key priority:
 *   1. PREDICTION_HMAC_SECRET (dedicated key — recommended)
 *   2. DATA_PASSWORD (fallback — works but ties prediction integrity to the data key)
 *   3. 'default' (dev-only fallback — logs a warning)
 */

import crypto from 'crypto'

function _getKey() {
  const key = process.env.PREDICTION_HMAC_SECRET ?? process.env.DATA_PASSWORD
  if (!key) {
    console.warn('[PredictionSigner] PREDICTION_HMAC_SECRET not set — using insecure fallback. Set it in .env')
    return 'default'
  }
  return key
}

/**
 * Sign a prediction payload before sending to the frontend.
 * Adds _hmac (HMAC-SHA256 hex) and _ts (timestamp ms) fields.
 * @param {object} payload  Prediction payload object
 * @returns {object}        Payload with _hmac and _ts appended
 */
export function signPrediction(payload) {
  const key = _getKey()
  const sig = crypto
    .createHmac('sha256', key)
    .update(JSON.stringify(payload))
    .digest('hex')
  return { ...payload, _hmac: sig, _ts: Date.now() }
}

/**
 * Verify a prediction payload server-side (e.g. when reprocessing stored predictions).
 * @param {object} payload  Payload with _hmac field
 * @returns {boolean}       true if valid, false if tampered or unsigned
 */
export function verifyPredictionServer(payload) {
  if (!payload || typeof payload !== 'object') return false
  const { _hmac, ...rest } = payload
  if (!_hmac) return false

  const key      = _getKey()
  const expected = crypto
    .createHmac('sha256', key)
    .update(JSON.stringify(rest))
    .digest('hex')

  try {
    return crypto.timingSafeEqual(
      Buffer.from(_hmac,    'hex'),
      Buffer.from(expected, 'hex')
    )
  } catch {
    return false
  }
}
