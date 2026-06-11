/**
 * derivatives.js — Derivatives Strategy Matrix routes.
 *
 * POST /api/derivatives/matrix     — compute 14 strategy types
 * GET  /api/derivatives/strategies — list available strategy types
 *
 * Black-Scholes implemented in Node.js — no external deps.
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { sanitizeTicker } from '../utils/sanitize.js'

const router = Router()

// ── Black-Scholes math ────────────────────────────────────────────────────────

/**
 * Standard normal CDF approximation (Abramowitz & Stegun 26.2.17).
 * @param {number} x
 * @returns {number}
 */
function normCDF(x) {
  if (x < -8) return 0
  if (x >  8) return 1
  const a1 =  0.254829592
  const a2 = -0.284496736
  const a3 =  1.421413741
  const a4 = -1.453152027
  const a5 =  1.061405429
  const p  =  0.3275911
  const sign = x < 0 ? -1 : 1
  const t = 1 / (1 + p * Math.abs(x))
  const poly = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))))
  return 0.5 * (1 + sign * (1 - poly * Math.exp(-x * x / 2)))
}

/**
 * Standard normal PDF.
 * @param {number} x
 * @returns {number}
 */
function normPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

/**
 * Black-Scholes option price.
 * @param {number} S  — spot price
 * @param {number} K  — strike price
 * @param {number} T  — time to expiry in years
 * @param {number} r  — risk-free rate (decimal, e.g. 0.065)
 * @param {number} sigma — implied volatility (decimal, e.g. 0.20)
 * @param {'call'|'put'} type
 * @returns {number}
 */
function bsPrice(S, K, T, r, sigma, type) {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T))
  const d2 = d1 - sigma * Math.sqrt(T)
  if (type === 'call') {
    return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2)
  }
  return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1)
}

/**
 * Black-Scholes Greeks.
 * @returns {{ delta, gamma, theta, vega }}
 */
function bsGreeks(S, K, T, r, sigma, type) {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0 }
  }
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T))
  const d2 = d1 - sigma * Math.sqrt(T)
  const nd1 = normPDF(d1)
  const sqrtT = Math.sqrt(T)

  const delta = type === 'call' ? normCDF(d1) : normCDF(d1) - 1
  const gamma = nd1 / (S * sigma * sqrtT)
  // Theta per calendar day
  const thetaBase = -(S * nd1 * sigma) / (2 * sqrtT) - r * K * Math.exp(-r * T)
  const theta = type === 'call'
    ? (thetaBase * normCDF(d2)) / 365
    : (thetaBase * normCDF(-d2) + r * K * Math.exp(-r * T)) / 365
  const vega = S * nd1 * sqrtT / 100  // per 1% IV move

  return {
    delta: Math.round(delta * 10000) / 10000,
    gamma: Math.round(gamma * 10000) / 10000,
    theta: Math.round(theta * 100) / 100,
    vega:  Math.round(vega  * 100) / 100,
  }
}

/**
 * Probability of profit (simplified — probability of expiring ITM).
 * @param {number} S
 * @param {number} K
 * @param {number} T
 * @param {number} sigma
 * @param {'call'|'put'} type
 * @returns {number} 0–1
 */
function pop(S, K, T, sigma, type) {
  if (T <= 0 || sigma <= 0) return 0
  const d2 = (Math.log(S / K) + (-0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T))
  return type === 'call' ? normCDF(d2) : normCDF(-d2)
}

// ── Strategy definitions ──────────────────────────────────────────────────────

const STRATEGY_TYPES = [
  'Covered Call', 'Protective Put', 'Bull Call Spread', 'Bear Put Spread',
  'Long Straddle', 'Short Straddle', 'Long Strangle', 'Short Strangle',
  'Iron Condor', 'Iron Butterfly', 'Calendar Spread', 'Diagonal Spread',
  'Ratio Spread', 'Collar',
]

// Market view → recommended strategies
const VIEW_STRATEGIES = {
  Bullish:     ['Covered Call', 'Bull Call Spread', 'Protective Put', 'Collar'],
  Bearish:     ['Bear Put Spread', 'Protective Put', 'Short Straddle', 'Short Strangle'],
  Neutral:     ['Iron Condor', 'Iron Butterfly', 'Short Straddle', 'Short Strangle'],
  Volatile:    ['Long Straddle', 'Long Strangle', 'Ratio Spread', 'Diagonal Spread'],
  'Range-bound': ['Iron Condor', 'Iron Butterfly', 'Covered Call', 'Calendar Spread'],
}

// ── Compute a single strategy ─────────────────────────────────────────────────

function computeStrategy(name, S, K, T, r, sigma, lotSize, capital) {
  const step = S * 0.02  // ~2% OTM step
  const K_otm_call = K + step
  const K_otm_put  = K - step
  const K_far_call = K + 2 * step
  const K_far_put  = K - 2 * step

  let legs = []
  let netPremium = 0
  let maxProfit = 0
  let maxLoss = 0
  let breakevens = []
  let popVal = 0
  let netGreeks = { delta: 0, gamma: 0, theta: 0, vega: 0 }

  const callATM  = bsPrice(S, K, T, r, sigma, 'call')
  const putATM   = bsPrice(S, K, T, r, sigma, 'put')
  const callOTM  = bsPrice(S, K_otm_call, T, r, sigma, 'call')
  const putOTM   = bsPrice(S, K_otm_put,  T, r, sigma, 'put')
  const callFar  = bsPrice(S, K_far_call, T, r, sigma, 'call')
  const putFar   = bsPrice(S, K_far_put,  T, r, sigma, 'put')

  const gATMC = bsGreeks(S, K, T, r, sigma, 'call')
  const gATMP = bsGreeks(S, K, T, r, sigma, 'put')
  const gOTMC = bsGreeks(S, K_otm_call, T, r, sigma, 'call')
  const gOTMP = bsGreeks(S, K_otm_put,  T, r, sigma, 'put')
  const gFarC = bsGreeks(S, K_far_call, T, r, sigma, 'call')
  const gFarP = bsGreeks(S, K_far_put,  T, r, sigma, 'put')

  switch (name) {
    case 'Covered Call':
      // Long stock + short ATM call
      netPremium = callATM
      maxProfit  = (K - S + callATM) * lotSize
      maxLoss    = (S - callATM) * lotSize
      breakevens = [S - callATM]
      popVal     = pop(S, K, T, sigma, 'call')
      legs = [{ action: 'Long', type: 'Stock', strike: S, premium: 0 }, { action: 'Short', type: 'Call', strike: K, premium: callATM }]
      netGreeks  = { delta: 1 - gATMC.delta, gamma: -gATMC.gamma, theta: -gATMC.theta, vega: -gATMC.vega }
      break

    case 'Protective Put':
      // Long stock + long ATM put
      netPremium = -putATM
      maxProfit  = Infinity
      maxLoss    = (S - K + putATM) * lotSize
      breakevens = [S + putATM]
      popVal     = 1 - pop(S, K, T, sigma, 'put')
      legs = [{ action: 'Long', type: 'Stock', strike: S, premium: 0 }, { action: 'Long', type: 'Put', strike: K, premium: putATM }]
      netGreeks  = { delta: 1 + gATMP.delta, gamma: gATMP.gamma, theta: gATMP.theta, vega: gATMP.vega }
      break

    case 'Bull Call Spread':
      netPremium = -(callATM - callOTM)
      maxProfit  = (K_otm_call - K - (callATM - callOTM)) * lotSize
      maxLoss    = (callATM - callOTM) * lotSize
      breakevens = [K + callATM - callOTM]
      popVal     = pop(S, K + callATM - callOTM, T, sigma, 'call')
      legs = [{ action: 'Long', type: 'Call', strike: K, premium: callATM }, { action: 'Short', type: 'Call', strike: K_otm_call, premium: callOTM }]
      netGreeks  = { delta: gATMC.delta - gOTMC.delta, gamma: gATMC.gamma - gOTMC.gamma, theta: gATMC.theta - gOTMC.theta, vega: gATMC.vega - gOTMC.vega }
      break

    case 'Bear Put Spread':
      netPremium = -(putATM - putOTM)
      maxProfit  = (K - K_otm_put - (putATM - putOTM)) * lotSize
      maxLoss    = (putATM - putOTM) * lotSize
      breakevens = [K - (putATM - putOTM)]
      popVal     = pop(S, K - (putATM - putOTM), T, sigma, 'put')
      legs = [{ action: 'Long', type: 'Put', strike: K, premium: putATM }, { action: 'Short', type: 'Put', strike: K_otm_put, premium: putOTM }]
      netGreeks  = { delta: gATMP.delta - gOTMP.delta, gamma: gATMP.gamma - gOTMP.gamma, theta: gATMP.theta - gOTMP.theta, vega: gATMP.vega - gOTMP.vega }
      break

    case 'Long Straddle':
      netPremium = -(callATM + putATM)
      maxProfit  = Infinity
      maxLoss    = (callATM + putATM) * lotSize
      breakevens = [K - callATM - putATM, K + callATM + putATM]
      popVal     = 1 - (normCDF((Math.log(S / (K + callATM + putATM)) / (sigma * Math.sqrt(T))) + 0.5 * sigma * Math.sqrt(T)) -
                        normCDF((Math.log(S / (K - callATM - putATM)) / (sigma * Math.sqrt(T))) + 0.5 * sigma * Math.sqrt(T)))
      legs = [{ action: 'Long', type: 'Call', strike: K, premium: callATM }, { action: 'Long', type: 'Put', strike: K, premium: putATM }]
      netGreeks  = { delta: gATMC.delta + gATMP.delta, gamma: gATMC.gamma + gATMP.gamma, theta: gATMC.theta + gATMP.theta, vega: gATMC.vega + gATMP.vega }
      break

    case 'Short Straddle':
      netPremium = callATM + putATM
      maxProfit  = (callATM + putATM) * lotSize
      maxLoss    = Infinity
      breakevens = [K - callATM - putATM, K + callATM + putATM]
      popVal     = 0.68  // ~1 std dev range
      legs = [{ action: 'Short', type: 'Call', strike: K, premium: callATM }, { action: 'Short', type: 'Put', strike: K, premium: putATM }]
      netGreeks  = { delta: -(gATMC.delta + gATMP.delta), gamma: -(gATMC.gamma + gATMP.gamma), theta: -(gATMC.theta + gATMP.theta), vega: -(gATMC.vega + gATMP.vega) }
      break

    case 'Long Strangle':
      netPremium = -(callOTM + putOTM)
      maxProfit  = Infinity
      maxLoss    = (callOTM + putOTM) * lotSize
      breakevens = [K_otm_put - callOTM - putOTM, K_otm_call + callOTM + putOTM]
      popVal     = 0.45
      legs = [{ action: 'Long', type: 'Call', strike: K_otm_call, premium: callOTM }, { action: 'Long', type: 'Put', strike: K_otm_put, premium: putOTM }]
      netGreeks  = { delta: gOTMC.delta + gOTMP.delta, gamma: gOTMC.gamma + gOTMP.gamma, theta: gOTMC.theta + gOTMP.theta, vega: gOTMC.vega + gOTMP.vega }
      break

    case 'Short Strangle':
      netPremium = callOTM + putOTM
      maxProfit  = (callOTM + putOTM) * lotSize
      maxLoss    = Infinity
      breakevens = [K_otm_put - callOTM - putOTM, K_otm_call + callOTM + putOTM]
      popVal     = 0.72
      legs = [{ action: 'Short', type: 'Call', strike: K_otm_call, premium: callOTM }, { action: 'Short', type: 'Put', strike: K_otm_put, premium: putOTM }]
      netGreeks  = { delta: -(gOTMC.delta + gOTMP.delta), gamma: -(gOTMC.gamma + gOTMP.gamma), theta: -(gOTMC.theta + gOTMP.theta), vega: -(gOTMC.vega + gOTMP.vega) }
      break

    case 'Iron Condor':
      // Short OTM call + long far call + short OTM put + long far put
      netPremium = callOTM + putOTM - callFar - putFar
      maxProfit  = netPremium * lotSize
      maxLoss    = (step - netPremium) * lotSize
      breakevens = [K_otm_put - netPremium, K_otm_call + netPremium]
      popVal     = 0.68
      legs = [
        { action: 'Short', type: 'Call', strike: K_otm_call, premium: callOTM },
        { action: 'Long',  type: 'Call', strike: K_far_call, premium: callFar },
        { action: 'Short', type: 'Put',  strike: K_otm_put,  premium: putOTM  },
        { action: 'Long',  type: 'Put',  strike: K_far_put,  premium: putFar  },
      ]
      netGreeks = { delta: 0, gamma: -(gOTMC.gamma + gOTMP.gamma), theta: -(gOTMC.theta + gOTMP.theta), vega: -(gOTMC.vega + gOTMP.vega) }
      break

    case 'Iron Butterfly':
      // Short ATM call + short ATM put + long OTM call + long OTM put
      netPremium = callATM + putATM - callOTM - putOTM
      maxProfit  = netPremium * lotSize
      maxLoss    = (step - netPremium) * lotSize
      breakevens = [K - netPremium, K + netPremium]
      popVal     = 0.55
      legs = [
        { action: 'Short', type: 'Call', strike: K,           premium: callATM },
        { action: 'Short', type: 'Put',  strike: K,           premium: putATM  },
        { action: 'Long',  type: 'Call', strike: K_otm_call,  premium: callOTM },
        { action: 'Long',  type: 'Put',  strike: K_otm_put,   premium: putOTM  },
      ]
      netGreeks = { delta: 0, gamma: -(gATMC.gamma + gATMP.gamma), theta: -(gATMC.theta + gATMP.theta), vega: -(gATMC.vega + gATMP.vega) }
      break

    case 'Calendar Spread':
      // Short near-term ATM call + long far-term ATM call (approximate with 2x T)
      {
        const callFarT = bsPrice(S, K, T * 2, r, sigma, 'call')
        const gFarT    = bsGreeks(S, K, T * 2, r, sigma, 'call')
        netPremium = -(callFarT - callATM)
        maxProfit  = (callFarT - callATM) * lotSize * 0.5  // approximate
        maxLoss    = (callFarT - callATM) * lotSize
        breakevens = [K - (callFarT - callATM) * 0.5, K + (callFarT - callATM) * 0.5]
        popVal     = 0.55
        legs = [{ action: 'Short', type: 'Call', strike: K, premium: callATM }, { action: 'Long', type: 'Call', strike: K, premium: callFarT, expiry: '2x' }]
        netGreeks = { delta: gFarT.delta - gATMC.delta, gamma: gFarT.gamma - gATMC.gamma, theta: gFarT.theta - gATMC.theta, vega: gFarT.vega - gATMC.vega }
      }
      break

    case 'Diagonal Spread':
      {
        const callFarOTM = bsPrice(S, K_otm_call, T * 2, r, sigma, 'call')
        const gFarOTM    = bsGreeks(S, K_otm_call, T * 2, r, sigma, 'call')
        netPremium = -(callFarOTM - callATM)
        maxProfit  = (K_otm_call - K) * lotSize * 0.4
        maxLoss    = (callFarOTM - callATM) * lotSize
        breakevens = [K + callFarOTM - callATM]
        popVal     = 0.50
        legs = [{ action: 'Short', type: 'Call', strike: K, premium: callATM }, { action: 'Long', type: 'Call', strike: K_otm_call, premium: callFarOTM, expiry: '2x' }]
        netGreeks = { delta: gFarOTM.delta - gATMC.delta, gamma: gFarOTM.gamma - gATMC.gamma, theta: gFarOTM.theta - gATMC.theta, vega: gFarOTM.vega - gATMC.vega }
      }
      break

    case 'Ratio Spread':
      // Long 1 ATM call + short 2 OTM calls
      netPremium = callATM - 2 * callOTM
      maxProfit  = (K_otm_call - K + netPremium) * lotSize
      maxLoss    = Infinity
      breakevens = [K - netPremium, 2 * K_otm_call - K + netPremium]
      popVal     = 0.60
      legs = [{ action: 'Long', type: 'Call', strike: K, premium: callATM }, { action: 'Short', type: 'Call', strike: K_otm_call, premium: callOTM, qty: 2 }]
      netGreeks = { delta: gATMC.delta - 2 * gOTMC.delta, gamma: gATMC.gamma - 2 * gOTMC.gamma, theta: gATMC.theta - 2 * gOTMC.theta, vega: gATMC.vega - 2 * gOTMC.vega }
      break

    case 'Collar':
      // Long stock + long OTM put + short OTM call
      netPremium = callOTM - putOTM
      maxProfit  = (K_otm_call - S + netPremium) * lotSize
      maxLoss    = (S - K_otm_put - netPremium) * lotSize
      breakevens = [S - netPremium]
      popVal     = 0.65
      legs = [
        { action: 'Long',  type: 'Stock', strike: S,           premium: 0       },
        { action: 'Long',  type: 'Put',   strike: K_otm_put,   premium: putOTM  },
        { action: 'Short', type: 'Call',  strike: K_otm_call,  premium: callOTM },
      ]
      netGreeks = { delta: 1 + gOTMP.delta - gOTMC.delta, gamma: gOTMP.gamma - gOTMC.gamma, theta: gOTMP.theta - gOTMC.theta, vega: gOTMP.vega - gOTMC.vega }
      break

    default:
      break
  }

  // Determine moneyness
  let moneyness = 'ATM'
  if (name === 'Bull Call Spread' || name === 'Covered Call') moneyness = 'ATM'
  else if (name === 'Iron Condor' || name === 'Short Strangle') moneyness = 'OTM'
  else if (name === 'Protective Put' || name === 'Collar') moneyness = 'OTM'

  // Round values
  const round2 = v => (typeof v === 'number' && isFinite(v)) ? Math.round(v * 100) / 100 : v

  return {
    name,
    moneyness,
    netPremium:  round2(netPremium),
    maxProfit:   isFinite(maxProfit) ? round2(maxProfit) : null,
    maxLoss:     isFinite(maxLoss)   ? round2(maxLoss)   : null,
    breakevens:  breakevens.map(round2),
    pop:         Math.round(Math.min(0.99, Math.max(0.01, popVal)) * 100) / 100,
    greeks: {
      delta: round2(netGreeks.delta),
      gamma: round2(netGreeks.gamma),
      theta: round2(netGreeks.theta),
      vega:  round2(netGreeks.vega),
    },
    legs,
    lotSize,
    capitalRequired: round2(Math.abs(maxLoss ?? 0) + Math.abs(netPremium) * lotSize),
  }
}

// ── POST /api/derivatives/matrix ─────────────────────────────────────────────

router.post('/matrix', requireAuth, (req, res) => {
  const { symbol: rawSymbol, exchange = 'NSE', expiry, basePrice, capital, marketView = 'Neutral' } = req.body

  const symbol = sanitizeTicker(rawSymbol)
  if (!symbol) return res.status(400).json({ error: 'Invalid symbol' })
  if (!basePrice || basePrice <= 0) return res.status(400).json({ error: 'basePrice required' })

  const S = Number(basePrice)
  // Use correct strike step per symbol
  const STRIKE_STEPS_MAP = {
    NIFTY: 50, BANKNIFTY: 100, FINNIFTY: 50, MIDCPNIFTY: 25,
    SENSEX: 100, NIFTY50: 50, default: 50,
  }
  const LOT_SIZES_MAP = {
    NIFTY: 25, BANKNIFTY: 15, FINNIFTY: 40, MIDCPNIFTY: 75,
    SENSEX: 10, NIFTY50: 25, default: 25,
  }
  const symKey = (symbol ?? '').replace(/\d+/g, '').toUpperCase()
  const strikeStep = STRIKE_STEPS_MAP[symKey] ?? STRIKE_STEPS_MAP.default
  const K = Math.round(S / strikeStep) * strikeStep  // ATM strike

  // Time to expiry in years
  let T = 30 / 365  // default 30 days
  if (expiry) {
    const expiryMs = new Date(expiry).getTime() - Date.now()
    if (expiryMs > 0) T = expiryMs / (365 * 24 * 60 * 60 * 1000)
  }

  const r     = 0.065   // RBI repo rate ~6.5%
  const sigma = 0.18    // default IV ~18% for NSE
  const lotSize = LOT_SIZES_MAP[symKey] ?? LOT_SIZES_MAP.default

  const recommended = VIEW_STRATEGIES[marketView] ?? []

  const strategies = STRATEGY_TYPES.map(name => {
    try {
      const result = computeStrategy(name, S, K, T, r, sigma, lotSize, capital ?? 100000)
      return { ...result, recommended: recommended.includes(name) }
    } catch (err) {
      console.warn(`[Derivatives] Strategy compute error for ${name}:`, err.message)
      return { name, error: err.message, recommended: recommended.includes(name) }
    }
  })

  // Sort: recommended first, then by PoP descending
  strategies.sort((a, b) => {
    if (a.recommended && !b.recommended) return -1
    if (!a.recommended && b.recommended) return 1
    return (b.pop ?? 0) - (a.pop ?? 0)
  })

  res.json({
    ok: true,
    symbol,
    exchange,
    basePrice: S,
    strike: K,
    expiry: expiry ?? null,
    T: Math.round(T * 365),
    marketView,
    strategies,
  })
})

// ── GET /api/derivatives/strategies ──────────────────────────────────────────

router.get('/strategies', requireAuth, (_req, res) => {
  res.json({ strategies: STRATEGY_TYPES, viewMap: VIEW_STRATEGIES })
})

export default router
