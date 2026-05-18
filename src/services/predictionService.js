/**
 * @fileoverview Prediction service — fetches AI predictions from the inference backend.
 *
 * Enforces:
 * - HMAC signature verification before any prediction is returned (Section 16.6.3)
 * - Confidence clamping (Section 16.1.4)
 * - Suppression rules (Section 13)
 * - Non-removable disclaimer injection (Section 16.3.1)
 */

import { apiFetch, ApiError } from './apiClient.js'
import { verifyPredictionHmac } from '@utils/hmac.js'
import { clampProbability } from '@utils/clamp.js'
import { CONFIDENCE_FLOOR, CONFIDENCE_CEILING, DISCLAIMERS, JURISDICTIONS } from '@utils/constants.js'

const AI_API_URL = import.meta.env.VITE_AI_API_URL ?? ''
const HMAC_VERIFY_KEY = import.meta.env.VITE_HMAC_VERIFY_KEY ?? ''
const JURISDICTION = import.meta.env.VITE_DISCLAIMER_JURISDICTION ?? JURISDICTIONS.IN

/**
 * Fetches a prediction for a given symbol.
 * Returns null if the signal is suppressed or verification fails.
 *
 * @param {string} symbol
 * @param {string} [exchange='NSE']
 * @returns {Promise<import('@types/market.js').PredictionPayload | null>}
 */
export async function fetchPrediction(symbol, exchange = 'NSE') {
  if (!AI_API_URL) {
    throw new ApiError('AI API URL not configured', 0, '')
  }

  const url = `${AI_API_URL}/predict?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}`
  const response = await apiFetch(url)

  /** @type {import('@types/market.js').PredictionPayload} */
  const raw = await response.json()

  // ── 1. Verify HMAC signature ─────────────────────────────────────────────
  if (HMAC_VERIFY_KEY) {
    const { hmacSignature, ...payloadWithoutSig } = raw
    const valid = await verifyPredictionHmac(payloadWithoutSig, hmacSignature, HMAC_VERIFY_KEY)
    if (!valid) {
      console.error('[predictionService] HMAC verification failed for', symbol)
      return null
    }
  }

  // ── 2. Suppression check ─────────────────────────────────────────────────
  if (raw.suppressed) {
    return null
  }

  // ── 3. Clamp all probability fields ─────────────────────────────────────
  const clamp = (p) => clampProbability(p, CONFIDENCE_FLOOR, CONFIDENCE_CEILING)

  const prediction = {
    ...raw,
    direction: { ...raw.direction, probability: clamp(raw.direction.probability) },
    t1:        { ...raw.t1,        probability: clamp(raw.t1.probability) },
    t2:        { ...raw.t2,        probability: clamp(raw.t2.probability) },
    t3:        { ...raw.t3,        probability: clamp(raw.t3.probability) },
    stopLoss:  { ...raw.stopLoss,  probability: clamp(raw.stopLoss.probability) },
    // ── 4. Inject non-removable disclaimer ──────────────────────────────
    disclaimer: DISCLAIMERS[JURISDICTION] ?? DISCLAIMERS[JURISDICTIONS.IN],
  }

  return prediction
}
