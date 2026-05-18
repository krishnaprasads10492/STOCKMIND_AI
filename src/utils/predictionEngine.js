/**
 * predictionEngine.js — instrument-aware signal generation.
 *
 * Generates calibrated mock signals with correct pricing for:
 *   - Spot (stocks / indices)
 *   - Futures (index/stock futures with lot size, basis, OI)
 *   - Options CE/PE (premium, Greeks, IV, intrinsic/time value)
 *   - Derivative recommendations (best strikes/contracts for an index)
 *
 * Replace the mock math with real AI inference calls when the backend
 * model is ready. The output schema is identical regardless of source.
 */

import { clampProbability } from './clamp.js'
import { DISCLAIMERS, JURISDICTIONS } from './constants.js'
import { getMarketSession, getNextTradingDay } from './marketHours.js'

const JURISDICTION = import.meta.env.VITE_DISCLAIMER_JURISDICTION ?? JURISDICTIONS.IN

// ── Strike step per underlying ────────────────────────────────────────────────
const STRIKE_STEPS = {
  NIFTY: 50, BANKNIFTY: 100, FINNIFTY: 50, MIDCPNIFTY: 25, SENSEX: 100,
  NIFTY50: 50, default: 50,
}

function getStep(symbol) {
  return STRIKE_STEPS[symbol] ?? STRIKE_STEPS.default
}

function getATM(price, symbol) {
  const step = getStep(symbol)
  return Math.round(price / step) * step
}

// ── Black-Scholes approximation for option premium ────────────────────────────
// Simplified — good enough for mock data that looks realistic
function bsApprox(S, K, T, iv, type) {
  // S=spot, K=strike, T=time to expiry (years), iv=annualised vol (0-1)
  const d1 = (Math.log(S / K) + (0.05 + iv * iv / 2) * T) / (iv * Math.sqrt(T))
  const d2 = d1 - iv * Math.sqrt(T)
  const N  = x => 0.5 * (1 + erf(x / Math.SQRT2))
  if (type === 'CE') return Math.max(0, S * N(d1) - K * Math.exp(-0.05 * T) * N(d2))
  return Math.max(0, K * Math.exp(-0.05 * T) * N(-d2) - S * N(-d1))
}

function erf(x) {
  // Abramowitz & Stegun approximation
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return x >= 0 ? y : -y
}

// ── Greeks ────────────────────────────────────────────────────────────────────
function calcGreeks(S, K, T, iv, type) {
  const d1 = (Math.log(S / K) + (0.05 + iv * iv / 2) * T) / (iv * Math.sqrt(T))
  const d2 = d1 - iv * Math.sqrt(T)
  const N  = x => 0.5 * (1 + erf(x / Math.SQRT2))
  const n  = x => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI)

  const delta = type === 'CE' ? N(d1) : N(d1) - 1
  const gamma = n(d1) / (S * iv * Math.sqrt(T))
  const theta = (-(S * n(d1) * iv) / (2 * Math.sqrt(T)) - 0.05 * K * Math.exp(-0.05 * T) * (type === 'CE' ? N(d2) : N(-d2))) / 365
  const vega  = S * n(d1) * Math.sqrt(T) / 100

  return {
    delta: Math.round(delta * 1000) / 1000,
    gamma: Math.round(gamma * 100000) / 100000,
    theta: Math.round(theta * 100) / 100,
    vega:  Math.round(vega * 100) / 100,
  }
}

// ── Shared signal skeleton ────────────────────────────────────────────────────
function baseSignal(rank, prob, type, entry, sl, t1, t2, t3, capital, riskPct, reasons, extra = {}) {
  const maxRisk = capital * (riskPct / 100)
  const rr      = Math.abs(t1 - entry) / Math.abs(entry - sl)
  const grade   = prob >= 80 ? 'A+' : prob >= 70 ? 'A' : prob >= 60 ? 'B' : prob >= 50 ? 'C' : 'D'

  // Validity: if market is closed, signals are for next trading day
  const moduleId  = extra._moduleId ?? 'indices-india'
  const session   = getMarketSession(moduleId)
  const isNextDay = !session.isLive && moduleId !== 'crypto'
  const nextDay   = isNextDay ? getNextTradingDay(moduleId) : null

  // Validity timestamp: next day open if market closed, else 15 min per rank
  let validityMs
  if (isNextDay) {
    // Valid until end of next trading day (15:30 IST)
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(15, 30, 0, 0)
    validityMs = tomorrow.getTime()
  } else {
    validityMs = Date.now() + (16 - rank) * 15 * 60 * 1000
  }

  return {
    rank,
    id:                 crypto.randomUUID(),
    type,
    entryPrice:         Math.round(entry * 100) / 100,
    entryZoneLow:       Math.round((entry - Math.abs(entry - sl) * 0.1) * 100) / 100,
    entryZoneHigh:      Math.round((entry + Math.abs(entry - sl) * 0.1) * 100) / 100,
    t1Price:            Math.round(t1 * 100) / 100,
    t2Price:            Math.round(t2 * 100) / 100,
    t3Price:            Math.round(t3 * 100) / 100,
    stopLoss:           Math.round(sl * 100) / 100,
    immediateOptimalSL: Math.round((sl + (entry - sl) * 0.35) * 100) / 100,
    maxRisk:            Math.round(maxRisk),
    riskRewardRatio:    Math.round(rr * 100) / 100,
    validity:           new Date(validityMs).toISOString(),
    validityBars:       Math.max(4, 16 - rank),
    probability:        prob,
    grade,
    t1Probability:      prob,
    t2Probability:      clampProbability(prob - 18),
    t3Probability:      clampProbability(prob - 38),
    slProbability:      clampProbability(100 - prob),
    regime:             'trending',
    reasons,
    suppressed:         false,
    suppressReason:     null,
    disclaimer:         DISCLAIMERS[JURISDICTION],
    hmacSignature:      '',
    // Next-day prediction metadata
    isNextDay,
    nextTradingDay:     nextDay,
    predictionContext:  isNextDay ? `Next day prediction for ${nextDay} (based on EOD close)` : 'Intraday prediction',
    ...extra,
  }
}

// ── SPOT signal generator ─────────────────────────────────────────────────────
export function generateSpotSignals(params) {
  const { basePrice, capital, riskPct, direction } = params
  const signals = []

  for (let i = 0; i < 16; i++) {
    const prob   = clampProbability(Math.round(88 - i * 2.4 + (Math.random() * 5 - 2.5)))
    const isLong = direction === 'long' ? true : direction === 'short' ? false : i % 3 !== 2
    const noise  = basePrice * 0.003
    const entry  = basePrice + (Math.random() * noise * 2 - noise)
    const atr    = basePrice * 0.008
    const sl     = isLong ? entry - atr * (1.2 + Math.random() * 0.6) : entry + atr * (1.2 + Math.random() * 0.6)
    const t1     = isLong ? entry + atr * 1.8 : entry - atr * 1.8
    const t2     = isLong ? entry + atr * 3.0 : entry - atr * 3.0
    const t3     = isLong ? entry + atr * 4.5 : entry - atr * 4.5

    signals.push(baseSignal(i + 1, prob, isLong ? 'LONG' : 'SHORT', entry, sl, t1, t2, t3, capital, riskPct, [
      `EMA(20) ${isLong ? '>' : '<'} EMA(50) — ${isLong ? 'bullish' : 'bearish'} alignment`,
      `RSI(14) = ${Math.round(isLong ? 45 + Math.random() * 20 : 35 + Math.random() * 20)} — ${isLong ? 'not overbought' : 'not oversold'}`,
      `Volume ${(1.1 + Math.random() * 0.6).toFixed(1)}x 20-day SMA`,
      `ATR(14) = ${atr.toFixed(1)} — ${atr / basePrice < 0.01 ? 'low' : 'moderate'} volatility`,
    ]))
  }
  return signals
}

// ── FUTURES signal generator ──────────────────────────────────────────────────
export function generateFuturesSignals(params) {
  const { symbol, basePrice, capital, riskPct, direction, lotSize = 25 } = params
  const signals = []

  // Futures trade at a basis premium (typically +0.1% to +0.5% over spot)
  const basis     = basePrice * (0.001 + Math.random() * 0.004)
  const futPrice  = basePrice + basis

  for (let i = 0; i < 16; i++) {
    const prob   = clampProbability(Math.round(86 - i * 2.3 + (Math.random() * 5 - 2.5)))
    const isLong = direction === 'long' ? true : direction === 'short' ? false : i % 3 !== 2
    const atr    = futPrice * 0.009
    const entry  = futPrice + (Math.random() * atr * 0.4 - atr * 0.2)
    const sl     = isLong ? entry - atr * 1.3 : entry + atr * 1.3
    const t1     = isLong ? entry + atr * 1.8 : entry - atr * 1.8
    const t2     = isLong ? entry + atr * 3.2 : entry - atr * 3.2
    const t3     = isLong ? entry + atr * 5.0 : entry - atr * 5.0

    // Lot-based P&L
    const lotsAffordable = Math.floor((capital * riskPct / 100) / (Math.abs(entry - sl) * lotSize))
    const lotCount = Math.max(1, lotsAffordable)
    const maxRiskLots = Math.abs(entry - sl) * lotSize * lotCount

    signals.push(baseSignal(i + 1, prob, isLong ? 'LONG' : 'SHORT', entry, sl, t1, t2, t3, capital, riskPct, [
      `Futures basis: +${basis.toFixed(1)} (${((basis / basePrice) * 100).toFixed(2)}% premium)`,
      `OI ${isLong ? 'increasing' : 'decreasing'} — ${isLong ? 'bullish' : 'bearish'} buildup`,
      `${lotCount} lot${lotCount > 1 ? 's' : ''} × ${lotSize} = ${(lotCount * lotSize).toLocaleString('en-IN')} units`,
      `Max risk: ₹${maxRiskLots.toLocaleString('en-IN')} (${lotCount} lot${lotCount > 1 ? 's' : ''})`,
    ], {
      instrType:  'futures',
      lotSize,
      lotCount,
      basis:      Math.round(basis * 100) / 100,
      maxRisk:    Math.round(maxRiskLots),
    }))
  }
  return signals
}

// ── OPTIONS signal generator ──────────────────────────────────────────────────
export function generateOptionsSignals(params) {
  const { symbol, basePrice, capital, riskPct, optionMeta, lotSize: paramLotSize } = params
  if (!optionMeta) return generateSpotSignals(params)

  const { strike, optType, expiry, T: expiryT, daysLeft, breakeven, indexMoveNeeded } = optionMeta
  const lotSize = optionMeta.lotSize ?? paramLotSize ?? 25
  const signals = []

  // Use actual T from optionMeta if available, else estimate
  const T  = expiryT ?? (0.04 + Math.random() * 0.06)
  const iv = 0.15 + Math.random() * 0.12

  // Current premium using BS approximation
  const currentPremium = optionMeta.premium ?? bsApprox(basePrice, strike, T, iv, optType)
  const greeks = optionMeta.greeks ?? calcGreeks(basePrice, strike, T, iv, optType)

  // Index prediction: how likely is the index to reach breakeven?
  // Based on ATR-implied move probability over the expiry window
  const atr = basePrice * 0.009
  const dailyVol = atr / Math.sqrt(1)
  const periodVol = dailyVol * Math.sqrt(Math.max(1, daysLeft ?? 14))
  const zScore = Math.abs(indexMoveNeeded ?? (breakeven - basePrice)) / periodVol
  // Probability of reaching breakeven (one-tailed normal)
  const probReachBreakeven = clampProbability(Math.round((1 - Math.min(0.95, zScore * 0.3)) * 100))

  for (let i = 0; i < 16; i++) {
    const prob   = clampProbability(Math.round(probReachBreakeven - i * 2 + (Math.random() * 4 - 2)))
    const isBullish = optType === 'CE'

    const entry = Math.max(0.5, currentPremium * (0.95 + Math.random() * 0.1))
    const sl    = Math.max(0.1, entry * (0.4 + Math.random() * 0.15))
    const t1    = entry * (1.5 + Math.random() * 0.3)
    const t2    = entry * (2.2 + Math.random() * 0.4)
    const t3    = entry * (3.0 + Math.random() * 0.5)

    const lotsAffordable = Math.floor((capital * riskPct / 100) / (entry * lotSize))
    const lotCount = Math.max(1, lotsAffordable)
    const maxRiskLots = (entry - sl) * lotSize * lotCount

    // Index levels corresponding to option targets
    const indexAtT1 = isBullish ? strike + t1 : strike - t1
    const indexAtSL = isBullish ? strike + sl  : strike - sl

    signals.push(baseSignal(i + 1, prob, isBullish ? 'LONG' : 'SHORT', entry, sl, t1, t2, t3, capital, riskPct, [
      `${optType} ${strike} | IV: ${(iv * 100).toFixed(1)}% | ${daysLeft ?? Math.round(T * 365)}d to expiry`,
      `Delta: ${greeks.delta?.toFixed(3) ?? 'N/A'} | Theta: ${greeks.theta?.toFixed(2) ?? 'N/A'}/day`,
      `Index needs ${indexMoveNeeded > 0 ? '+' : ''}${(indexMoveNeeded ?? 0).toFixed(0)} pts → breakeven at ${(breakeven ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
      `${lotCount} lot${lotCount > 1 ? 's' : ''} × ${lotSize} = ₹${(entry * lotSize * lotCount).toLocaleString('en-IN', { maximumFractionDigits: 0 })} premium`,
    ], {
      instrType:   'options',
      optType,
      strike,
      expiry,
      iv:          Math.round(iv * 1000) / 10,
      ...greeks,
      lotSize,
      lotCount,
      maxRisk:     Math.round(maxRiskLots),
      underlying:  symbol,
      breakeven:   optionMeta.breakeven,
      indexMoveNeeded: optionMeta.indexMoveNeeded,
      indexAtT1:   Math.round(indexAtT1),
      indexAtSL:   Math.round(indexAtSL),
      probReachBreakeven,
    }))
  }
  return signals
}

// ── DERIVATIVE RECOMMENDER ────────────────────────────────────────────────────
/**
 * Given an index (e.g. NIFTY50), scan all nearby strikes and the futures
 * contract, score each by expected profit potential, and return the top 16
 * ranked recommendations.
 *
 * Scoring factors:
 *   - Probability of profit (based on delta, IV, time)
 *   - Risk-reward ratio
 *   - Capital efficiency (premium vs potential gain)
 *   - OI buildup signal
 */
export function generateDerivativeRecommendations(params) {
  const { symbol, basePrice, capital, riskPct, direction } = params
  const step    = getStep(symbol)
  const atm     = getATM(basePrice, symbol)
  const T       = 0.04 + Math.random() * 0.06
  const iv      = 0.16 + Math.random() * 0.10
  const lotSize = symbol === 'BANKNIFTY' ? 15 : symbol === 'FINNIFTY' ? 40 : 25

  const candidates = []

  // ── Futures ──
  const basis    = basePrice * (0.001 + Math.random() * 0.003)
  const futEntry = basePrice + basis
  const futAtr   = futEntry * 0.009
  const futSL    = futEntry - futAtr * 1.3
  const futT1    = futEntry + futAtr * 2.0
  const futT2    = futEntry + futAtr * 3.5
  const futT3    = futEntry + futAtr * 5.5
  const futProb  = clampProbability(Math.round(72 + Math.random() * 12))
  const futRR    = (futT1 - futEntry) / (futEntry - futSL)

  candidates.push({
    label:       `${symbol} Futures`,
    instrType:   'futures',
    symbol:      `${symbol}FUT`,
    entry:       futEntry,
    sl:          futSL,
    t1: futT1, t2: futT2, t3: futT3,
    prob:        futProb,
    rr:          futRR,
    score:       futProb * futRR * 0.8,
    lotSize,
    basis,
    reasons: [
      `Futures basis +${basis.toFixed(1)} (${((basis / basePrice) * 100).toFixed(2)}%)`,
      `OI buildup — bullish sentiment`,
      `ATR(14) = ${futAtr.toFixed(0)} — moderate volatility`,
    ],
  })

  // ── Options: scan ATM ± 4 strikes, both CE and PE ──
  const strikesToScan = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map(n => atm + n * step)

  for (const strike of strikesToScan) {
    for (const optType of ['CE', 'PE']) {
      // Skip direction-filtered options
      if (direction === 'long'  && optType === 'PE') continue
      if (direction === 'short' && optType === 'CE') continue

      const premium = bsApprox(basePrice, strike, T, iv, optType)
      if (premium < 1) continue  // too far OTM

      const greeks  = calcGreeks(basePrice, strike, T, iv, optType)
      const sl      = Math.max(0.5, premium * 0.45)
      const t1      = premium * 1.6
      const t2      = premium * 2.4
      const t3      = premium * 3.5
      const rr      = (t1 - premium) / (premium - sl)

      // Probability of profit — higher delta = higher prob for CE, lower for PE
      const probBase = optType === 'CE'
        ? clampProbability(Math.round(Math.abs(greeks.delta) * 100 * 0.85 + 30 + Math.random() * 10))
        : clampProbability(Math.round(Math.abs(greeks.delta) * 100 * 0.85 + 30 + Math.random() * 10))

      // Capital efficiency: how much gain per rupee of premium
      const capitalEff = (t1 - premium) / premium

      // Score: weighted combination
      const score = probBase * rr * capitalEff * (optType === 'CE' ? 1 : 0.95)

      const moneyness = strike === atm ? 'ATM' : strike > atm
        ? `OTM +${strike - atm}` : `ITM ${strike - atm}`

      candidates.push({
        label:     `${symbol} ${strike} ${optType} (${moneyness})`,
        instrType: 'options',
        symbol:    `${symbol}${strike}${optType}`,
        optType,
        strike,
        entry:     Math.round(premium * 100) / 100,
        sl:        Math.round(sl * 100) / 100,
        t1: Math.round(t1 * 100) / 100,
        t2: Math.round(t2 * 100) / 100,
        t3: Math.round(t3 * 100) / 100,
        prob:      probBase,
        rr:        Math.round(rr * 100) / 100,
        score,
        iv:        Math.round(iv * 1000) / 10,
        ...greeks,
        lotSize,
        reasons: [
          `${optType} ${strike} (${moneyness}) | IV: ${(iv * 100).toFixed(1)}%`,
          `Delta: ${greeks.delta.toFixed(3)} | Theta: ${greeks.theta.toFixed(2)}/day`,
          `Premium ₹${premium.toFixed(1)} | R:R = 1:${rr.toFixed(2)}`,
          `Capital efficiency: ${(capitalEff * 100).toFixed(0)}% gain at T1`,
        ],
      })
    }
  }

  // Sort by score descending, take top 16
  candidates.sort((a, b) => b.score - a.score)
  const top16 = candidates.slice(0, 16)

  // Convert to signal format
  return top16.map((c, i) => {
    const maxRisk = capital * (riskPct / 100)
    const lotCount = Math.max(1, Math.floor(maxRisk / (Math.abs(c.entry - c.sl) * c.lotSize)))
    return baseSignal(
      i + 1, c.prob,
      c.optType === 'PE' ? 'SHORT' : 'LONG',
      c.entry, c.sl, c.t1, c.t2, c.t3,
      capital, riskPct,
      c.reasons,
      {
        instrType:   c.instrType,
        derivLabel:  c.label,
        symbol:      c.symbol,
        optType:     c.optType,
        strike:      c.strike,
        iv:          c.iv,
        delta:       c.delta,
        gamma:       c.gamma,
        theta:       c.theta,
        vega:        c.vega,
        lotSize:     c.lotSize,
        lotCount,
        basis:       c.basis,
        score:       Math.round(c.score * 100) / 100,
        maxRisk:     Math.round(Math.abs(c.entry - c.sl) * c.lotSize * lotCount),
      }
    )
  })
}

// ── Main dispatcher ───────────────────────────────────────────────────────────
export function generateSignals(params) {
  const { instrType, isIndexDerivRec } = params
  // Inject moduleId so baseSignal can determine next-day context
  const enriched = { ...params, _moduleId: params.moduleId ?? 'indices-india' }

  if (isIndexDerivRec) return generateDerivativeRecommendations(enriched)
  if (instrType === 'futures') return generateFuturesSignals(enriched)
  if (instrType === 'options') return generateOptionsSignals(enriched)
  return generateSpotSignals(enriched)
}
