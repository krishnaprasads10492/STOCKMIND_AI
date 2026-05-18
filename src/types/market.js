/**
 * @fileoverview Shared type definitions (JSDoc) for all market data structures.
 *
 * These mirror the canonical schemas from StockMind-AI-Full-Requirements-Spec.md.
 * When the project migrates to TypeScript, convert these to .ts interfaces.
 *
 * Sections referenced:
 *   §6.2  — PredictionSignal, PredictionBatch
 *   §6.3  — PredictionField
 *   §7.2  — PredictionOutcome
 *   §7.3  — AccuracyStats
 *   §9.4  — BacktestResult
 *   §10.1 — DataPoint, CanonicalOHLCV
 *   §11.3 — CalibrationMetrics
 *   §14.4 — SystemHealth
 *   §5.3  — UserRecord, UserPreferences
 */

// ─────────────────────────────────────────────────────────────────────────────
// Data layer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} DataPoint
 * @property {number}   value
 * @property {number}   timestamp        - Unix ms
 * @property {string}   source
 * @property {number}   reliabilityScore - 0.0 – 1.0
 * @property {number}   latencyMs
 * @property {0|1|2|3}  tier
 */

/**
 * @typedef {Object} CanonicalOHLCV
 * @property {number} timestamp
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 * @property {number} volume
 * @property {string} source
 * @property {number} tier
 * @property {number} reliabilityScore
 */

// ─────────────────────────────────────────────────────────────────────────────
// Prediction layer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {'A+'|'A'|'B'|'C'|'D'} SignalGrade
 */

/**
 * @typedef {'trending'|'ranging'|'volatile'|'low_liquidity'} MarketRegime
 */

/**
 * @typedef {'LONG'|'SHORT'} SignalDirection
 */

/**
 * @typedef {'T1_HIT'|'T2_HIT'|'T3_HIT'|'SL_HIT'|'TIMEOUT'|'PARTIAL_T1'|'PARTIAL_T2'} OutcomeType
 */

/**
 * Per-field probability + confidence breakdown.
 * Raw model probabilities are NEVER used here — always post-calibration.
 *
 * @typedef {Object} PredictionField
 * @property {number}      probability    - Calibrated probability 5–99 (never 0 or 100)
 * @property {number}      confidence     - Composite confidence score 0–100
 * @property {SignalGrade} grade
 * @property {string[]}    reasons        - SHAP-derived explanation bullets (3–8 items)
 */

/**
 * A single ranked prediction signal (one of 16 per batch).
 *
 * @typedef {Object} PredictionSignal
 * @property {number}          rank                 - 1–16, sorted highest probability first
 * @property {string}          id                   - UUID v7
 * @property {SignalDirection} type                 - LONG or SHORT
 * @property {number}          entryPrice
 * @property {number}          entryZoneLow
 * @property {number}          entryZoneHigh
 * @property {number}          t1Price
 * @property {number}          t2Price
 * @property {number}          t3Price
 * @property {number}          stopLoss             - Structure-based SL (ATR + S/R)
 * @property {number}          immediateOptimalSL   - Tighter SL for immediate entry
 * @property {number}          maxRisk              - Capital at risk in currency units
 * @property {number}          riskRewardRatio      - (T1 - entry) / (entry - SL)
 * @property {string}          validity             - ISO-8601 timestamp after which signal is stale
 * @property {number}          validityBars         - Number of candles the signal is valid for
 * @property {number}          probability          - Calibrated direction probability 5–99
 * @property {SignalGrade}     grade
 * @property {number}          t1Probability        - Probability T1 hit before SL
 * @property {number}          t2Probability        - Probability T2 hit before SL
 * @property {number}          t3Probability        - Probability T3 hit before SL
 * @property {number}          slProbability        - Probability SL hit first
 * @property {MarketRegime}    regime
 * @property {string[]}        reasons              - SHAP-derived explanation bullets
 * @property {boolean}         suppressed           - true = signal was suppressed, never render
 * @property {string|null}     suppressReason
 * @property {string}          disclaimer           - Non-removable legal text (injected by service)
 * @property {string}          hmacSignature        - SHA-256 HMAC of payload (verify before render)
 */

/**
 * Full batch of 16 signals returned by one prediction request.
 *
 * @typedef {Object} PredictionBatch
 * @property {string}             requestId
 * @property {string}             symbol
 * @property {string}             exchange
 * @property {number}             generatedAt       - Unix ms
 * @property {MarketRegime}       marketRegime
 * @property {string}             modelVersion
 * @property {number}             userCapital
 * @property {number}             userRiskPct
 * @property {PredictionSignal[]} signals           - Always 16 items, sorted by probability desc
 * @property {number}             suppressedCount   - How many signals were suppressed
 * @property {string}             disclaimer
 */

// ─────────────────────────────────────────────────────────────────────────────
// Outcome tracking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolved outcome for a stored prediction (populated by outcome tracker).
 *
 * @typedef {Object} PredictionOutcome
 * @property {string}      predictionId
 * @property {number}      outcomeResolvedAt    - Unix ms
 * @property {OutcomeType} outcome
 * @property {number}      outcomePrice
 * @property {number}      outcomeBars          - Bars taken to reach outcome
 * @property {string}      actualProbabilityBucket - e.g. "80-90"
 * @property {boolean}     wasCorrect           - T1/T2/T3 hit = true, SL/TIMEOUT = false
 * @property {number}      pnl                  - Gross P&L in currency units
 * @property {number}      pnlAfterCommission
 */

/**
 * Rolling accuracy statistics per instrument / grade / regime.
 *
 * @typedef {Object} AccuracyStats
 * @property {string}  symbol
 * @property {string}  [grade]          - Optional filter
 * @property {string}  [regime]         - Optional filter
 * @property {number}  totalResolved
 * @property {number}  correct          - T1/T2/T3 hit
 * @property {number}  incorrect        - SL hit or timeout
 * @property {number}  accuracyPct      - correct / totalResolved * 100
 * @property {number}  t1HitRate
 * @property {number}  t2HitRate
 * @property {number}  t3HitRate
 * @property {number}  slHitRate
 * @property {number}  avgRR
 * @property {string}  windowDays       - "30" | "60" | "90"
 * @property {string}  computedAt       - ISO-8601
 */

// ─────────────────────────────────────────────────────────────────────────────
// Backtesting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} BacktestRegimeResult
 * @property {number} accuracy
 * @property {number} signals
 */

/**
 * @typedef {Object} BacktestResult
 * @property {string}  symbol
 * @property {string}  modelVersion
 * @property {string}  backtestDate       - ISO-8601
 * @property {string}  dataRange          - e.g. "2023-01-01 to 2026-01-01"
 * @property {number}  totalSignals
 * @property {number}  suppressedSignals
 * @property {number}  resolvedSignals
 * @property {number}  accuracy           - Must be 75–97 to pass gate
 * @property {number}  t1HitRate
 * @property {number}  t2HitRate
 * @property {number}  t3HitRate
 * @property {number}  slHitRate
 * @property {number}  avgRR
 * @property {number}  ece
 * @property {number}  brierScore
 * @property {{ trending: BacktestRegimeResult, ranging: BacktestRegimeResult, volatile: BacktestRegimeResult, low_liquidity: BacktestRegimeResult }} byRegime
 * @property {boolean} passed             - true if all accuracy gate thresholds met
 */

// ─────────────────────────────────────────────────────────────────────────────
// Calibration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} CalibrationMetrics
 * @property {string} symbol
 * @property {string} modelVersion
 * @property {number} ece              - Expected Calibration Error % (must be < 5)
 * @property {number} mce              - Maximum Calibration Error % (must be < 10)
 * @property {number} brierScore
 * @property {number} reliabilitySlope - Should be ~1.0
 * @property {string} computedAt       - ISO-8601
 * @property {'healthy'|'warn'|'critical'} status
 */

// ─────────────────────────────────────────────────────────────────────────────
// System health
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {'full'|'degraded_1'|'degraded_2'|'heuristics_only'|'suspended'} SystemLevel
 */

/**
 * @typedef {Object} SystemHealth
 * @property {SystemLevel} level
 * @property {number}      ece                  - Current ECE across all active models
 * @property {number}      brierScore
 * @property {boolean}     dataFeedHealthy
 * @property {boolean}     aiInferenceHealthy
 * @property {boolean}     storageHealthy
 * @property {number}      activeFeeds          - Number of healthy data feeds
 * @property {number}      totalFeeds
 * @property {string}      lastUpdated          - ISO-8601
 */

// ─────────────────────────────────────────────────────────────────────────────
// User / Auth
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} UserPreferences
 * @property {string}  defaultModule          - e.g. "equities-india"
 * @property {number}  defaultCapital
 * @property {number}  riskPerTrade           - Percentage 0.5–5.0
 * @property {string}  jurisdiction           - IN | US | EU
 * @property {boolean} cloudBackup
 * @property {string}  cloudEmail
 * @property {string}  notificationFrequency  - realtime | hourly | daily | off
 * @property {string}  quietHoursStart        - HH:MM
 * @property {string}  quietHoursEnd          - HH:MM
 * @property {number}  cleanupIntervalDays
 */

/**
 * @typedef {Object} UserRecord
 * @property {string}          userId
 * @property {string}          username
 * @property {'admin'|'user'}  role
 * @property {string}          createdAt        - ISO-8601
 * @property {string}          createdBy        - Admin userId
 * @property {string}          lastLoginAt      - ISO-8601
 * @property {boolean}         isActive
 * @property {UserPreferences} preferences
 */

// ─────────────────────────────────────────────────────────────────────────────
// Market modules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {'equities-india'|'indices-india'|'fno-india'|'crypto'|'forex'|'commodities'|'global-indices'} MarketModuleId
 */

/**
 * @typedef {Object} MarketModule
 * @property {MarketModuleId} id
 * @property {string}         label
 * @property {string[]}       exchanges
 * @property {string}         primaryDataSource
 * @property {boolean}        isLive
 * @property {string}         timezone
 * @property {string}         sessionOpen    - HH:MM local
 * @property {string}         sessionClose   - HH:MM local
 */
