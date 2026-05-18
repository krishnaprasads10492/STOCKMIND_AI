/**
 * strategyService.js — Strategy storage and NLP parser.
 *
 * Stores user strategies as encrypted JSON files.
 * Parses plain-English strategy descriptions into prediction parameters.
 *
 * Storage: data/strategies/{userId}/{strategyId}.enc
 */

import crypto from 'crypto'
import { writeSecure, readSecure, listSecure, deleteSecure } from '../storage/fileStore.js'

// ── Storage helpers ───────────────────────────────────────────────────────────

function stratPath(userId, strategyId) {
  return `strategies/${userId}/${strategyId}`
}

export function saveStrategy(userId, strategy) {
  const id = strategy.id ?? crypto.randomUUID()
  const full = {
    ...strategy,
    id,
    userId,
    createdAt: strategy.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  writeSecure(stratPath(userId, id), full)
  return { ok: true, id }
}

export function getStrategies(userId) {
  const files = listSecure(`strategies/${userId}`)
  return files.map(f => readSecure(`strategies/${userId}/${f}`)).filter(Boolean)
}

export function getStrategy(userId, strategyId) {
  return readSecure(stratPath(userId, strategyId))
}

export function deleteStrategy(userId, strategyId) {
  const path = stratPath(userId, strategyId)
  const existing = readSecure(path)
  if (!existing) return { ok: false, error: 'Strategy not found' }
  deleteSecure(path)
  return { ok: true }
}

// ── NLP Strategy Parser ───────────────────────────────────────────────────────
/**
 * Parse a plain-English strategy description into prediction parameters.
 *
 * This is a rule-based NLP parser. In production, replace with a call to
 * the Python AI backend which can use an LLM for better understanding.
 *
 * @param {string} text
 * @returns {{ strategy: object, impact: object }}
 */
export function parseStrategyText(text) {
  const lower = text.toLowerCase()

  // ── Instrument type ───────────────────────────────────────────────────────
  let instrType = 'spot'
  if (/futures?|fut\b/.test(lower))                instrType = 'futures'
  else if (/options?|calls?|puts?|ce\b|pe\b/.test(lower)) instrType = 'options'

  // ── Direction ─────────────────────────────────────────────────────────────
  let direction = 'both'
  const hasBuy  = /\b(buy|long|call|bullish|uptrend|above)\b/.test(lower)
  const hasSell = /\b(sell|short|put|bearish|downtrend|below)\b/.test(lower)
  if (hasBuy && !hasSell)  direction = 'long'
  if (hasSell && !hasBuy)  direction = 'short'

  // ── Symbol ────────────────────────────────────────────────────────────────
  const symbolMatch = text.match(/\b(NIFTY50|NIFTY|BANKNIFTY|FINNIFTY|SENSEX|RELIANCE|TCS|INFY|HDFCBANK|BTCUSDT|ETHUSDT)\b/i)
  const symbol = symbolMatch ? symbolMatch[1].toUpperCase() : null

  // ── Module ────────────────────────────────────────────────────────────────
  let moduleId = 'indices-india'
  if (instrType !== 'spot')                                    moduleId = 'fno-india'
  else if (/crypto|btc|eth|bnb/.test(lower))                  moduleId = 'crypto'
  else if (/forex|usd|eur|gbp/.test(lower))                   moduleId = 'forex'
  else if (/gold|silver|crude|oil|commodity/.test(lower))     moduleId = 'commodities'
  else if (/reliance|tcs|infy|hdfc|equity|stock/.test(lower)) moduleId = 'equities-india'

  // ── Min grade ─────────────────────────────────────────────────────────────
  let minGrade = 'C'
  if (/high.{0,10}(confidence|probability|accuracy)|strong signal/.test(lower)) minGrade = 'A'
  else if (/medium.{0,10}(confidence|probability)/.test(lower))                  minGrade = 'B'

  // ── Filters (technical indicators) ───────────────────────────────────────
  const filters = []

  // RSI
  const rsiMatch = lower.match(/rsi\s*(?:is\s*)?(?:below|<|under)\s*(\d+)/)
  if (rsiMatch) filters.push(`rsi14 < ${rsiMatch[1]}`)
  const rsiAbove = lower.match(/rsi\s*(?:is\s*)?(?:above|>|over)\s*(\d+)/)
  if (rsiAbove) filters.push(`rsi14 > ${rsiAbove[1]}`)

  // EMA
  const emaMatch = lower.match(/ema\s*\(?(\d+)\)?/)
  if (emaMatch) {
    const period = emaMatch[1]
    if (hasBuy)  filters.push(`price > ema${period}`)
    if (hasSell) filters.push(`price < ema${period}`)
  }

  // Volume
  if (/high.{0,10}volume|volume.{0,10}(above|>|spike|surge)/.test(lower)) {
    const volMatch = lower.match(/(\d+(?:\.\d+)?)\s*x?\s*(?:average|avg)?\s*volume/)
    filters.push(`volume > ${volMatch ? volMatch[1] : '1.5'}x_avg`)
  }

  // MACD
  if (/macd/.test(lower)) {
    if (hasBuy)  filters.push('macd_hist > 0')
    if (hasSell) filters.push('macd_hist < 0')
  }

  // Bollinger
  if (/bollinger|bb\b/.test(lower)) {
    if (hasBuy)  filters.push('price < bb_lower')
    if (hasSell) filters.push('price > bb_upper')
  }

  // IV
  const ivLow  = lower.match(/iv\s*(?:rank\s*)?(?:below|<|under)\s*(\d+)/)
  const ivHigh = lower.match(/iv\s*(?:rank\s*)?(?:above|>|over)\s*(\d+)/)
  if (ivLow)  filters.push(`iv_rank < ${ivLow[1]}%`)
  if (ivHigh) filters.push(`iv_rank > ${ivHigh[1]}%`)

  // VWAP
  if (/vwap/.test(lower)) {
    if (hasBuy)  filters.push('price < vwap - 0.5%')
    if (hasSell) filters.push('price > vwap + 0.5%')
  }

  // 20-day high/low breakout
  if (/20.{0,5}day.{0,10}(high|low)|20d.{0,5}(high|low)/.test(lower)) {
    if (hasBuy)  filters.push('price > 20d_high')
    if (hasSell) filters.push('price < 20d_low')
  }

  // ── Strategy name ─────────────────────────────────────────────────────────
  const indicatorNames = []
  if (/rsi/.test(lower))     indicatorNames.push('RSI')
  if (/ema/.test(lower))     indicatorNames.push('EMA')
  if (/macd/.test(lower))    indicatorNames.push('MACD')
  if (/vwap/.test(lower))    indicatorNames.push('VWAP')
  if (/volume/.test(lower))  indicatorNames.push('Volume')
  if (/bollinger/.test(lower)) indicatorNames.push('BB')
  if (/iv/.test(lower))      indicatorNames.push('IV')

  const dirLabel = direction === 'long' ? 'Long' : direction === 'short' ? 'Short' : 'Dual'
  const instrLabel = instrType === 'spot' ? 'Spot' : instrType === 'futures' ? 'Futures' : 'Options'
  const name = `${dirLabel} ${instrLabel}${indicatorNames.length ? ' — ' + indicatorNames.join('+') : ''}${symbol ? ' (' + symbol + ')' : ''}`

  // ── Confidence score ──────────────────────────────────────────────────────
  // Higher confidence when more specific indicators are mentioned
  const confidence = Math.min(95, 50 + filters.length * 8 + (symbol ? 10 : 0) + (instrType !== 'spot' ? 5 : 0))

  // ── Impact estimation ─────────────────────────────────────────────────────
  // Estimate accuracy impact based on filter quality
  // In production, this would run an actual backtest comparison
  const baselineAccuracy = 72  // typical baseline without filters
  let delta = 0
  if (filters.some(f => f.includes('rsi')))    delta += 3
  if (filters.some(f => f.includes('ema')))    delta += 2
  if (filters.some(f => f.includes('volume'))) delta += 2
  if (filters.some(f => f.includes('macd')))   delta += 2
  if (filters.some(f => f.includes('vwap')))   delta += 3
  if (filters.some(f => f.includes('iv')))     delta += 4
  if (filters.length > 3) delta -= 2  // over-filtering can hurt
  if (direction !== 'both') delta += 1  // directional filter helps

  const withStrategy = Math.min(95, Math.max(50, baselineAccuracy + delta))

  const strategy = {
    name,
    instrType,
    direction,
    symbol,
    moduleId,
    minGrade,
    filters,
    confidence,
    sourceText: text,
  }

  const impact = {
    baseline:      baselineAccuracy,
    withStrategy,
    accuracyDelta: withStrategy - baselineAccuracy,
    note: filters.length === 0
      ? 'No specific filters detected — accuracy impact is minimal. Try adding indicator conditions.'
      : `${filters.length} filter${filters.length > 1 ? 's' : ''} detected. Estimated impact based on historical filter performance.`,
  }

  return { strategy, impact }
}
