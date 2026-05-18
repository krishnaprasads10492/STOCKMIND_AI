/**
 * marketDataService.js — tiered quote fetching for one-off price lookups.
 *
 * Priority:
 *   1. 0xramm API  (free, no key, NSE+BSE, full fundamentals)
 *   2. Finnhub     (if VITE_FINNHUB_KEY set)
 *   3. Alpha Vantage (if VITE_ALPHA_VANTAGE_KEY set)
 *   4. Twelve Data  (if VITE_TWELVE_DATA_KEY set)
 *
 * For continuous polling, use marketWebSocket.js / indianMarketFeed.js instead.
 */

import { fetchFromOxramm } from './indianMarketFeed.js'
import { apiFetch } from './apiClient.js'
import { sanitizeTicker } from '@utils/sanitize.js'
import { DATA_TIERS } from '@utils/constants.js'

const ALPHA_VANTAGE_KEY = import.meta.env.VITE_ALPHA_VANTAGE_KEY ?? ''
const FINNHUB_KEY       = import.meta.env.VITE_FINNHUB_KEY       ?? ''
const TWELVE_DATA_KEY   = import.meta.env.VITE_TWELVE_DATA_KEY   ?? ''

/**
 * Fetch a quote for a symbol, trying sources in priority order.
 * Returns a normalised DataPoint or null.
 *
 * @param {string} rawSymbol
 * @param {string} [exchange]
 * @returns {Promise<import('@types/market.js').DataPoint | null>}
 */
export async function fetchQuote(rawSymbol, exchange = 'NSE') {
  const result = sanitizeTicker(rawSymbol)
  if (!result.ok) {
    console.warn('[marketDataService] Invalid ticker:', result.error)
    return null
  }
  const symbol = result.value

  // 1. 0xramm (free, no key, NSE+BSE)
  const oxrammTick = await fetchFromOxramm(symbol, exchange)
  if (oxrammTick) {
    return {
      value:            oxrammTick.price,
      timestamp:        oxrammTick.ts,
      source:           '0xramm',
      reliabilityScore: 0.82,
      latencyMs:        0,
      tier:             DATA_TIERS.TIER_1,
      // Rich data from 0xramm
      open:         oxrammTick.open,
      high:         oxrammTick.high,
      low:          oxrammTick.low,
      volume:       oxrammTick.volume,
      change:       oxrammTick.change,
      changePct:    oxrammTick.changePct,
      week52High:   oxrammTick.week52High,
      week52Low:    oxrammTick.week52Low,
      pe:           oxrammTick.pe,
      marketCap:    oxrammTick.marketCap,
      sector:       oxrammTick.sector,
      companyName:  oxrammTick.companyName,
    }
  }

  // 2. Finnhub
  if (FINNHUB_KEY) {
    try {
      const res = await apiFetch(
        `https://finnhub.io/api/v1/quote?symbol=${symbol}.NS&token=${FINNHUB_KEY}`
      )
      const d = await res.json()
      if (d.c) return {
        value:            d.c,
        timestamp:        Date.now(),
        source:           'finnhub',
        reliabilityScore: 0.75,
        latencyMs:        0,
        tier:             DATA_TIERS.TIER_1,
        open: d.o, high: d.h, low: d.l, change: d.d, changePct: d.dp,
      }
    } catch { /* fall through */ }
  }

  // 3. Alpha Vantage
  if (ALPHA_VANTAGE_KEY) {
    try {
      const res = await apiFetch(
        `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}.NS&apikey=${ALPHA_VANTAGE_KEY}`
      )
      const data = await res.json()
      const price = parseFloat(data['Global Quote']?.['05. price'])
      if (price) return {
        value: price, timestamp: Date.now(), source: 'alpha_vantage',
        reliabilityScore: 0.72, latencyMs: 0, tier: DATA_TIERS.TIER_1,
      }
    } catch { /* fall through */ }
  }

  // 4. Twelve Data
  if (TWELVE_DATA_KEY) {
    try {
      const res = await apiFetch(
        `https://api.twelvedata.com/price?symbol=${symbol}&apikey=${TWELVE_DATA_KEY}`
      )
      const data = await res.json()
      const price = parseFloat(data.price)
      if (price) return {
        value: price, timestamp: Date.now(), source: 'twelve_data',
        reliabilityScore: 0.73, latencyMs: 0, tier: DATA_TIERS.TIER_1,
      }
    } catch { /* fall through */ }
  }

  return null
}
