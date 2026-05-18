/**
 * backtestClient.js — API wrappers for backtest and strategy endpoints.
 */

import { apiFetch } from './apiClient.js'
import { useAuthStore } from '@store/authStore.js'

const BASE = '/api'

function authHeaders(token) {
  const t = token ?? useAuthStore.getState().token
  return t ? { 'x-session-token': t } : {}
}

async function safeFetch(url, options = {}) {
  try {
    const res = await apiFetch(url, options)
    return res.json()
  } catch (err) {
    if (err?.status >= 400 && err?.status < 500) return { error: err.message }
    throw err
  }
}

// ── Backtest ──────────────────────────────────────────────────────────────────

/**
 * Run a walk-forward backtest for a symbol.
 * @param {string} symbol
 * @param {string} exchange
 * @param {string} token
 */
export function runBacktest(symbol, exchange = 'NSE', token) {
  return safeFetch(`${BASE}/inference/backtest`, {
    method:  'POST',
    headers: authHeaders(token),
    body:    JSON.stringify({ symbol, exchange, modelVersion: 'v0.2.0' }),
    timeoutMs: 30_000,  // backtest can take a while
  })
}

// ── Strategy builder ──────────────────────────────────────────────────────────

/**
 * Parse a plain-English strategy description into prediction parameters.
 * @param {string} text
 * @param {string} token
 */
export function parseStrategy(text, token) {
  return safeFetch(`${BASE}/strategies/parse`, {
    method:  'POST',
    headers: authHeaders(token),
    body:    JSON.stringify({ text }),
    timeoutMs: 15_000,
  })
}

// ── Strategy CRUD ─────────────────────────────────────────────────────────────

export function saveStrategy(strategy, token) {
  return safeFetch(`${BASE}/strategies`, {
    method:  'POST',
    headers: authHeaders(token),
    body:    JSON.stringify(strategy),
  })
}

export function fetchStrategies(token) {
  return safeFetch(`${BASE}/strategies`, {
    headers: authHeaders(token),
  })
}

export function deleteStrategy(id, token) {
  return safeFetch(`${BASE}/strategies/${encodeURIComponent(id)}`, {
    method:  'DELETE',
    headers: authHeaders(token),
  })
}

export function fetchStrategyBacktest(strategyId, token) {
  return safeFetch(`${BASE}/strategies/${encodeURIComponent(strategyId)}/backtest`, {
    headers: authHeaders(token),
    timeoutMs: 30_000,
  })
}
