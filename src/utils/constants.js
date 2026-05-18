/**
 * @fileoverview Application-wide constants.
 * All values sourced from the AI-Model-Training spec (Section 16).
 */

// ── Confidence bounds (Section 16.1.4) ───────────────────────────────────────
export const CONFIDENCE_FLOOR   = Number(import.meta.env.VITE_CONFIDENCE_FLOOR   ?? 5)
export const CONFIDENCE_CEILING = Number(import.meta.env.VITE_CONFIDENCE_CEILING ?? 99)

// ── Minimum data history before predictions are allowed (Section 13) ─────────
export const MIN_HISTORY_MONTHS = Number(import.meta.env.VITE_MIN_HISTORY_MONTHS ?? 6)

// ── Signal grades ─────────────────────────────────────────────────────────────
/** @type {readonly string[]} */
export const SIGNAL_GRADES = /** @type {const} */ (['A+', 'A', 'B', 'C', 'D'])

// ── Market regimes ────────────────────────────────────────────────────────────
export const REGIMES = /** @type {const} */ ({
  TRENDING:      'trending',
  RANGING:       'ranging',
  VOLATILE:      'volatile',
  LOW_LIQUIDITY: 'low_liquidity',
})

// ── Calibration thresholds (Section 8.4) ─────────────────────────────────────
export const ECE_WARN_THRESHOLD    = 5   // % — auto-downgrade confidence
export const ECE_CRITICAL_THRESHOLD = 8  // % — suppress all predictions
export const MCE_THRESHOLD         = 10  // %
export const PSI_DRIFT_THRESHOLD   = 0.2

// ── Graceful degradation levels (Section 16.5.2) ─────────────────────────────
export const SYSTEM_LEVELS = /** @type {const} */ ({
  FULL:            'full',
  DEGRADED_1:      'degraded_1',
  DEGRADED_2:      'degraded_2',
  HEURISTICS_ONLY: 'heuristics_only',
  SUSPENDED:       'suspended',
})

// ── Data source tiers (Section 2.2) ──────────────────────────────────────────
export const DATA_TIERS = /** @type {const} */ ({
  TIER_0: 0,  // Yahoo Finance, CoinGecko — long history
  TIER_1: 1,  // Alpha Vantage, Twelve Data, Finnhub
  TIER_2: 2,  // Binance WS, Polygon.io
  TIER_3: 3,  // Private: Zerodha, Bloomberg, etc.
})

// ── Jurisdiction codes for disclaimer rendering (Section 16.8) ───────────────
export const JURISDICTIONS = /** @type {const} */ ({
  IN: 'IN',  // India — SEBI
  US: 'US',  // United States — SEC/FINRA
  EU: 'EU',  // European Union — ESMA/GDPR
})

// ── Non-removable disclaimer text per jurisdiction (Section 16.3.1) ──────────
export const DISCLAIMERS = {
  [JURISDICTIONS.IN]:
    'This platform provides AI-generated market analysis for informational purposes only. ' +
    'It does NOT constitute investment advice, a recommendation to buy or sell any security, ' +
    'or a guarantee of returns. Past performance is not indicative of future results. ' +
    'Please consult a SEBI-registered investment advisor before making any investment decisions. ' +
    'All predictions carry inherent risk of loss.',

  [JURISDICTIONS.US]:
    'This platform provides AI-generated market analysis for informational purposes only. ' +
    'It is NOT personalized investment advice and does NOT constitute a recommendation ' +
    'under SEC or FINRA regulations. Predictions are probabilistic and not guarantees. ' +
    'Consult a registered investment advisor before trading.',

  [JURISDICTIONS.EU]:
    'This platform provides AI-generated market analysis for informational purposes only. ' +
    'It does NOT constitute investment advice under MiFID II or ESMA guidelines. ' +
    'Predictions are probabilistic estimates, not guarantees of future performance. ' +
    'Your capital is at risk. Consult a qualified financial advisor before investing.',
}

// ── Feature flags ─────────────────────────────────────────────────────────────
export const FEATURES = {
  PREDICTIONS:          import.meta.env.VITE_ENABLE_PREDICTIONS          === 'true',
  SENTIMENT:            import.meta.env.VITE_ENABLE_SENTIMENT             === 'true',
  CV_PATTERNS:          import.meta.env.VITE_ENABLE_CV_PATTERNS           === 'true',
  RL_TIMING:            import.meta.env.VITE_ENABLE_RL_TIMING             === 'true',
  STRATEGY_INTELLIGENCE: import.meta.env.VITE_ENABLE_STRATEGY_INTELLIGENCE !== 'false', // on by default
  SELF_OPTIMIZER:       import.meta.env.VITE_ENABLE_SELF_OPTIMIZER        !== 'false', // on by default
}
