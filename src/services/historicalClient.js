/**
 * @fileoverview Historical market data client.
 * Connects to the server-side historical data service which aggregates
 * Yahoo Finance, Stooq, FRED, and Alpha Vantage.
 */

import { apiFetch } from './apiClient.js'

/**
 * Fetch historical OHLCV data for a symbol.
 *
 * @param {string} symbol    — ticker (e.g. 'RELIANCE', 'AAPL', '^NSEI')
 * @param {string} exchange  — exchange (e.g. 'NSE', 'NYSE')
 * @param {string} interval  — '1d' | '1wk' | '1mo' | '1h' | '30m' | '15m' | '5m'
 * @param {string} from      — ISO date string (e.g. '2023-01-01')
 * @param {string} to        — ISO date string (e.g. '2024-01-01')
 * @param {string} token     — session token
 * @returns {Promise<{ symbol, interval, fromDate, toDate, data: Array, source: string }>}
 */
export async function fetchHistoricalOHLCV(symbol, exchange, interval, from, to, token) {
  const params = new URLSearchParams()
  params.set('symbol', symbol)
  if (exchange) params.set('exchange', exchange)
  if (interval) params.set('interval', interval)
  if (from)     params.set('from', from)
  if (to)       params.set('to', to)

  const res = await apiFetch(`/api/historical/ohlcv?${params}`, {
    headers: { 'x-session-token': token },
    timeoutMs: 20_000,
  })
  return res.json()
}

/**
 * Fetch macroeconomic data from FRED.
 *
 * @param {string} indicator — FRED series ID (e.g. 'GDP', 'CPIAUCSL', 'FEDFUNDS', 'UNRATE')
 * @param {string} token
 * @returns {Promise<{ indicator, data: Array<{date, value}>, source: string }>}
 */
export async function fetchMacroData(indicator, token) {
  const params = new URLSearchParams({ indicator })
  const res = await apiFetch(`/api/historical/macro?${params}`, {
    headers: { 'x-session-token': token },
    timeoutMs: 15_000,
  })
  return res.json()
}

/**
 * Fetch fundamental data for a stock.
 *
 * @param {string} symbol
 * @param {string} token
 * @returns {Promise<{ symbol, pe, eps, revenue, marketCap, dividendYield, beta, source: string }>}
 */
export async function fetchFundamentals(symbol, token) {
  const params = new URLSearchParams({ symbol })
  const res = await apiFetch(`/api/historical/fundamentals?${params}`, {
    headers: { 'x-session-token': token },
    timeoutMs: 15_000,
  })
  return res.json()
}

/**
 * Fetch earnings calendar for a symbol.
 *
 * @param {string} symbol
 * @param {string} token
 * @returns {Promise<{ symbol, next: object, history: Array, source: string }>}
 */
export async function fetchEarningsCalendar(symbol, token) {
  const params = new URLSearchParams({ symbol })
  const res = await apiFetch(`/api/historical/earnings?${params}`, {
    headers: { 'x-session-token': token },
    timeoutMs: 15_000,
  })
  return res.json()
}

/**
 * Fetch dividend history for a symbol.
 *
 * @param {string} symbol
 * @param {string} token
 * @returns {Promise<{ symbol, dividends: Array<{date, amount}>, source: string }>}
 */
export async function fetchDividendHistory(symbol, token) {
  const params = new URLSearchParams({ symbol })
  const res = await apiFetch(`/api/historical/dividends?${params}`, {
    headers: { 'x-session-token': token },
    timeoutMs: 15_000,
  })
  return res.json()
}
