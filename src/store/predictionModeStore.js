/**
 * predictionModeStore — Dual-mode prediction engine state.
 *
 * Two modes run simultaneously:
 *
 *   LEARNING mode  — generates predictions, tracks deviation from actual,
 *                    adjusts weights to improve accuracy over time.
 *                    Uses wider confidence intervals, more exploratory.
 *
 *   REAL-WORLD mode — uses the calibrated weights from Learning mode,
 *                     projects as accurately as possible.
 *                     Tighter signals, higher confidence threshold.
 *
 * Auto-refresh: every 60 seconds during market hours.
 * Deviation tracking: compares each prediction to actual price at expiry.
 */

import { create } from 'zustand'

const STORE_KEY = 'sm_pred_mode'
const HISTORY_KEY = 'sm_pred_history'

const AUTO_REFRESH_MS = 60_000  // 1 minute

// ── Deviation tracker ─────────────────────────────────────────────────────────

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') } catch { return [] }
}

function saveHistory(h) {
  // Keep last 500 entries
  const trimmed = h.slice(-500)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed))
}

/**
 * Compute adaptive weight adjustments from deviation history.
 * Returns a multiplier (0.8–1.2) to apply to probability scores.
 */
function computeAdaptiveWeight(history, instrType = 'spot') {
  const relevant = history.filter(h => h.instrType === instrType && h.deviation != null)
  if (relevant.length < 5) return 1.0  // not enough data yet

  // Mean absolute deviation — lower = more accurate = higher weight
  const mad = relevant.slice(-20).reduce((sum, h) => sum + Math.abs(h.deviation), 0) / Math.min(20, relevant.length)
  const accuracy = relevant.slice(-20).filter(h => h.correct).length / Math.min(20, relevant.length)

  // Weight: 0.8 if accuracy < 50%, 1.2 if accuracy > 80%
  const weight = 0.8 + (accuracy * 0.4)
  return Math.round(weight * 100) / 100
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const usePredictionModeStore = create((set, get) => {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') } catch { return {} } })()

  return {
    // Mode state
    activeMode:    saved.activeMode    ?? 'both',   // 'learning' | 'realworld' | 'both'
    autoRefresh:   saved.autoRefresh   ?? true,
    refreshIntervalMs: AUTO_REFRESH_MS,
    lastRefreshedAt:   null,
    nextRefreshAt:     null,
    refreshCount:      0,

    // Deviation history for adaptive learning
    deviationHistory: loadHistory(),

    // Adaptive weights per instrument type (updated from history)
    adaptiveWeights: {
      spot:    computeAdaptiveWeight(loadHistory(), 'spot'),
      futures: computeAdaptiveWeight(loadHistory(), 'futures'),
      options: computeAdaptiveWeight(loadHistory(), 'options'),
    },

    // Learning mode stats
    learningStats: {
      totalPredictions: 0,
      correctPredictions: 0,
      avgDeviation: 0,
      lastUpdated: null,
    },

    setMode(mode) {
      localStorage.setItem(STORE_KEY, JSON.stringify({ ...saved, activeMode: mode }))
      set({ activeMode: mode })
    },

    setAutoRefresh(enabled) {
      localStorage.setItem(STORE_KEY, JSON.stringify({ ...saved, autoRefresh: enabled }))
      set({ autoRefresh: enabled })
    },

    markRefreshed() {
      const now = Date.now()
      set({
        lastRefreshedAt: now,
        nextRefreshAt:   now + AUTO_REFRESH_MS,
        refreshCount:    get().refreshCount + 1,
      })
    },

    /**
     * Record a prediction outcome for adaptive learning.
     * @param {object} prediction - the original signal
     * @param {number} actualPrice - price at expiry/resolution
     * @param {string} outcome - 'T1_HIT' | 'T2_HIT' | 'T3_HIT' | 'SL_HIT' | 'TIMEOUT'
     */
    recordOutcome(prediction, actualPrice, outcome) {
      const deviation = actualPrice - prediction.entryPrice
      const deviationPct = (deviation / prediction.entryPrice) * 100
      const correct = outcome === 'T1_HIT' || outcome === 'T2_HIT' || outcome === 'T3_HIT'

      const entry = {
        id:           prediction.id,
        symbol:       prediction.symbol,
        instrType:    prediction.instrType ?? 'spot',
        entryPrice:   prediction.entryPrice,
        actualPrice,
        deviation:    Math.round(deviationPct * 100) / 100,
        outcome,
        correct,
        probability:  prediction.probability,
        grade:        prediction.grade,
        ts:           Date.now(),
      }

      const history = [...get().deviationHistory, entry]
      saveHistory(history)

      // Recompute adaptive weights
      const adaptiveWeights = {
        spot:    computeAdaptiveWeight(history, 'spot'),
        futures: computeAdaptiveWeight(history, 'futures'),
        options: computeAdaptiveWeight(history, 'options'),
      }

      // Update learning stats
      const recent = history.slice(-100)
      const learningStats = {
        totalPredictions:   history.length,
        correctPredictions: history.filter(h => h.correct).length,
        avgDeviation:       Math.round(recent.reduce((s, h) => s + Math.abs(h.deviation ?? 0), 0) / recent.length * 100) / 100,
        lastUpdated:        new Date().toISOString(),
      }

      set({ deviationHistory: history, adaptiveWeights, learningStats })
    },

    getAccuracyPct() {
      const h = get().deviationHistory
      if (!h.length) return null
      return Math.round((h.filter(x => x.correct).length / h.length) * 100)
    },

    getWeightForInstrType(instrType) {
      return get().adaptiveWeights[instrType] ?? 1.0
    },

    clearHistory() {
      localStorage.removeItem(HISTORY_KEY)
      set({
        deviationHistory: [],
        adaptiveWeights: { spot: 1.0, futures: 1.0, options: 1.0 },
        learningStats: { totalPredictions: 0, correctPredictions: 0, avgDeviation: 0, lastUpdated: null },
      })
    },
  }
})

// ── Mode labels ───────────────────────────────────────────────────────────────

export const MODE_META = {
  learning:   { label: 'Learning',    icon: '🧠', color: 'var(--color-ai)',   desc: 'Exploratory — tracks deviation, adapts weights' },
  realworld:  { label: 'Real-World',  icon: '🎯', color: 'var(--color-bull)', desc: 'Calibrated — uses learned weights for accuracy' },
  both:       { label: 'Dual Mode',   icon: '⚡', color: 'var(--color-accent)', desc: 'Both modes run simultaneously' },
}
