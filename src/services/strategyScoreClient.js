/**
 * @fileoverview Strategy Intelligence scoring client.
 * Calls the backend which proxies to the Python AI engine.
 */

import { apiFetch } from './apiClient.js'

/**
 * Score a single symbol with all 10 AI algorithms.
 * @param {string} symbol
 * @param {string} exchange
 * @param {string} regime
 * @param {string} token
 * @returns {Promise<object>}
 */
export async function scoreSymbol(symbol, exchange = 'NSE', regime = 'trending', token) {
  const res = await apiFetch('/api/strategy-score/single', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ symbol, exchange, regime }),
    timeoutMs: 35_000,
  })
  return res.json()
}

/**
 * Score multiple symbols in one batch call.
 * @param {Array<{symbol: string, exchange: string, regime: string}>} symbols
 * @param {string} token
 * @returns {Promise<{results: object[], count: number}>}
 */
export async function scoreSymbolBatch(symbols, token) {
  const res = await apiFetch('/api/strategy-score/batch', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ symbols }),
    timeoutMs: 90_000,
  })
  return res.json()
}

/**
 * Fetch user's scoring history.
 * @param {string} token
 * @returns {Promise<object[]>}
 */
export async function fetchScoreHistory(token) {
  const res = await apiFetch('/api/strategy-score/history', {
    headers: { 'x-session-token': token },
  })
  return res.json()
}

/**
 * Trigger CSV export download.
 * @param {string} token
 */
export function exportScoresCSV(token) {
  const a = document.createElement('a')
  a.href = `/api/strategy-score/export?token=${encodeURIComponent(token)}`
  a.download = `strategy-scores-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
}

/**
 * Get self-optimizer health report.
 * @param {string} token
 * @returns {Promise<object>}
 */
export async function fetchOptimizerHealth(token) {
  const res = await apiFetch('/api/self-optimizer/health', {
    headers: { 'x-session-token': token },
  })
  return res.json()
}

/**
 * Record a prediction outcome for self-optimization.
 * @param {object} outcome
 * @param {string} token
 */
export async function recordOutcome(outcome, token) {
  const res = await apiFetch('/api/self-optimizer/outcome', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify(outcome),
  })
  return res.json()
}

/**
 * Run optimization cycle (admin only).
 * @param {string} token
 */
export async function runOptimizationCycle(token) {
  const res = await apiFetch('/api/self-optimizer/optimize', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({}),
  })
  return res.json()
}

/**
 * Approve or reject an optimization cycle (admin only).
 * @param {number} cycle
 * @param {boolean} approved
 * @param {object} params
 * @param {string} token
 */
export async function approveOptimization(cycle, approved, params, token) {
  const res = await apiFetch('/api/self-optimizer/approve', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ cycle, approved, params }),
  })
  return res.json()
}
