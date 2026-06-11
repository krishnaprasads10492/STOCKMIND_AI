/**
 * OptionsPanel — full-featured options selector.
 *
 * Features:
 *   - Moneyness filter: ITM / ATM / OTM (or All)
 *   - Expiry selector: weekly (W) and monthly (M)
 *   - Strike dropdown filtered by moneyness
 *   - CE / PE type toggle
 *   - Full option chain with BS-priced premiums, IV, Delta, OI
 *   - Click any chain row to select that strike+type instantly
 *   - Index-level prediction context: "index needs to reach X for this option to profit"
 */

import { useState, useEffect, useMemo } from 'react'
import styles from './OptionsPanel.module.css'

// ── Config ────────────────────────────────────────────────────────────────────

const STRIKE_STEPS = {
  NIFTY: 50, BANKNIFTY: 100, FINNIFTY: 50, MIDCPNIFTY: 25, SENSEX: 100,
  NIFTY50: 50, NIFTY100: 50, default: 50,
}

const LOT_SIZES = {
  NIFTY: 25, BANKNIFTY: 15, FINNIFTY: 40, MIDCPNIFTY: 75, SENSEX: 10,
  NIFTY50: 25, NIFTY100: 50,
  // Equities
  RELIANCE: 250, TCS: 150, HDFCBANK: 550, INFY: 300, ICICIBANK: 700,
  SBIN: 1500, BAJFINANCE: 125, WIPRO: 1500, AXISBANK: 625, TATAMOTORS: 550,
  default: 25,
}

// ── Math helpers ──────────────────────────────────────────────────────────────

function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return x >= 0 ? y : -y
}

function N(x) { return 0.5 * (1 + erf(x / Math.SQRT2)) }
function n(x) { return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) }

function bsPrice(S, K, T, iv, type) {
  if (T <= 0) return type === 'CE' ? Math.max(0, S - K) : Math.max(0, K - S)
  const d1 = (Math.log(S / K) + (0.05 + iv * iv / 2) * T) / (iv * Math.sqrt(T))
  const d2 = d1 - iv * Math.sqrt(T)
  if (type === 'CE') return Math.max(0, S * N(d1) - K * Math.exp(-0.05 * T) * N(d2))
  return Math.max(0, K * Math.exp(-0.05 * T) * N(-d2) - S * N(-d1))
}

function bsGreeks(S, K, T, iv, type) {
  if (T <= 0) return { delta: type === 'CE' ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, theta: 0, vega: 0 }
  const d1 = (Math.log(S / K) + (0.05 + iv * iv / 2) * T) / (iv * Math.sqrt(T))
  const d2 = d1 - iv * Math.sqrt(T)
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

// Implied IV varies with moneyness (smile)
function impliedIV(strike, atm, baseIV = 0.18) {
  const dist = Math.abs(strike - atm) / atm
  return baseIV + dist * 0.15 + (Math.random() * 0.02 - 0.01)
}

// Realistic OI — higher near ATM, decreasing with distance
function mockOI(strike, atm, lotSize, optType) {
  const dist = Math.abs(strike - atm) / atm
  // CE OI peaks slightly OTM, PE OI peaks slightly OTM on the other side
  const peakDist = optType === 'CE' ? 0.01 : 0.01
  const adjusted = Math.abs(dist - peakDist)
  const base = Math.round((1 - adjusted * 8) * 800000 + Math.random() * 150000)
  return Math.max(5000, Math.min(2000000, base))
}

// Volume — fraction of OI
function mockVolume(oi) {
  return Math.round(oi * (0.05 + Math.random() * 0.15))
}

// ── Expiry generation ─────────────────────────────────────────────────────────

function generateExpiries() {
  const expiries = []
  const now = new Date()

  for (let i = 0; i < 4; i++) {
    const d = new Date(now)
    const day = d.getDay()
    const daysToThursday = (4 - day + 7) % 7 || 7
    d.setDate(d.getDate() + daysToThursday + i * 7)
    const daysLeft = Math.round((d - now) / 86400000)
    expiries.push({
      label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      value: fmtExpiry(d),
      date:  d,
      daysLeft,
      T:     daysLeft / 365,
      type:  'weekly',
    })
  }

  for (let m = 0; m < 3; m++) {
    const month = new Date(now.getFullYear(), now.getMonth() + m + 1, 0)
    while (month.getDay() !== 4) month.setDate(month.getDate() - 1)
    if (!expiries.find(e => e.value === fmtExpiry(month))) {
      const daysLeft = Math.round((month - now) / 86400000)
      expiries.push({
        label: month.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }),
        value: fmtExpiry(month),
        date:  month,
        daysLeft,
        T:     daysLeft / 365,
        type:  'monthly',
      })
    }
  }

  return expiries.sort((a, b) => a.daysLeft - b.daysLeft)
}

function fmtExpiry(date) {
  const dd  = String(date.getDate()).padStart(2, '0')
  const mon = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
  const yy  = String(date.getFullYear()).slice(2)
  return `${dd}${mon}${yy}`
}

// ── Moneyness classification ──────────────────────────────────────────────────

function getMoneyness(strike, atm, optType) {
  if (strike === atm) return 'ATM'
  if (optType === 'CE') return strike < atm ? 'ITM' : 'OTM'
  return strike > atm ? 'ITM' : 'OTM'
}

// ── Main component ────────────────────────────────────────────────────────────

export function OptionsPanel({ underlying, basePrice, onOptionSelect }) {
  const step    = STRIKE_STEPS[underlying] ?? STRIKE_STEPS.default
  const lotSize = LOT_SIZES[underlying]    ?? LOT_SIZES.default
  const atm     = Math.round(basePrice / step) * step

  const expiries = useMemo(() => generateExpiries(), [])

  const [expiry,     setExpiry]     = useState(expiries[0])
  const [optType,    setOptType]    = useState('CE')
  const [moneyness,  setMoneyness]  = useState('ATM')  // ITM | ATM | OTM | ALL
  const [strike,     setStrike]     = useState(atm)
  const [showChain,  setShowChain]  = useState(false)

  // All strikes ATM ± 12
  const allStrikes = useMemo(() => {
    const arr = []
    for (let i = -12; i <= 12; i++) arr.push(atm + i * step)
    return arr
  }, [atm, step])

  // Filtered strikes by moneyness
  const filteredStrikes = useMemo(() => {
    if (moneyness === 'ALL') return allStrikes
    return allStrikes.filter(s => {
      const m = getMoneyness(s, atm, optType)
      return m === moneyness
    })
  }, [allStrikes, moneyness, optType, atm])

  // Auto-select first strike when filter changes
  useEffect(() => {
    if (!filteredStrikes.includes(strike)) {
      setStrike(filteredStrikes[Math.floor(filteredStrikes.length / 2)] ?? atm)
    }
  }, [filteredStrikes]) // eslint-disable-line react-hooks/exhaustive-deps

  // Build option symbol
  const optionSymbol = `${underlying}${expiry.value}${strike}${optType}`

  // Current option data
  const iv      = impliedIV(strike, atm)
  const premium = bsPrice(basePrice, strike, expiry.T, iv, optType)
  const greeks  = bsGreeks(basePrice, strike, expiry.T, iv, optType)
  const oi      = mockOI(strike, atm, lotSize, optType)
  const volume  = mockVolume(oi)
  const moneynessLabel = getMoneyness(strike, atm, optType)

  // Index level needed for breakeven
  const breakeven = optType === 'CE'
    ? strike + premium
    : strike - premium
  const indexMoveNeeded = breakeven - basePrice

  useEffect(() => {
    onOptionSelect?.({
      symbol: optionSymbol, underlying, expiry: expiry.value,
      strike, optType, basePrice, lotSize,
      premium: Math.round(premium * 100) / 100,
      iv: Math.round(iv * 1000) / 10,
      greeks, breakeven: Math.round(breakeven * 100) / 100,
      indexMoveNeeded: Math.round(indexMoveNeeded * 100) / 100,
      daysLeft: expiry.daysLeft, T: expiry.T,
    })
  }, [optionSymbol, expiry.value]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.panel}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <span className={styles.title}>Options</span>
        <span className={styles.symbol}>{optionSymbol}</span>
        <span className={`${styles.moneynessTag} ${styles[`mn${moneynessLabel}`]}`}>
          {moneynessLabel}
        </span>
        <button
          type="button"
          className={styles.chainBtn}
          onClick={() => setShowChain(s => !s)}
          aria-expanded={showChain}
        >
          {showChain ? 'Hide Chain ▲' : 'Full Chain ▼'}
        </button>
      </div>

      {/* ── Controls row ── */}
      <div className={styles.controls}>
        {/* Expiry */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="opt-expiry">
            Expiry <span className={styles.daysLeft}>{expiry.daysLeft}d left</span>
          </label>
          <select
            id="opt-expiry"
            className={styles.select}
            value={expiry.value}
            onChange={e => setExpiry(expiries.find(x => x.value === e.target.value) ?? expiries[0])}
          >
            {expiries.map(ex => (
              <option key={ex.value} value={ex.value}>
                {ex.label} ({ex.type === 'monthly' ? 'M' : 'W'}) — {ex.daysLeft}d
              </option>
            ))}
          </select>
        </div>

        {/* Moneyness filter */}
        <div className={styles.field}>
          <label className={styles.label}>Moneyness</label>
          <div className={styles.moneynessGroup} role="group" aria-label="Moneyness filter">
            {['ITM','ATM','OTM','ALL'].map(m => (
              <button
                key={m}
                type="button"
                className={`${styles.mnBtn} ${moneyness === m ? styles.mnBtnActive : ''} ${styles[`mn${m}`]}`}
                onClick={() => setMoneyness(m)}
                aria-pressed={moneyness === m}
              >{m}</button>
            ))}
          </div>
        </div>

        {/* Strike */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="opt-strike">Strike</label>
          <select
            id="opt-strike"
            className={styles.select}
            value={strike}
            onChange={e => setStrike(Number(e.target.value))}
          >
            {filteredStrikes.map(s => {
              const m = getMoneyness(s, atm, optType)
              return (
                <option key={s} value={s}>
                  {s.toLocaleString('en-IN')} — {m}{s === atm ? ' ★' : ''}
                </option>
              )
            })}
          </select>
        </div>

        {/* CE / PE */}
        <div className={styles.field}>
          <label className={styles.label}>Type</label>
          <div className={styles.typeToggle} role="group" aria-label="Option type">
            {[['CE','Call','bull'],['PE','Put','bear']].map(([t, lbl, col]) => (
              <button
                key={t}
                type="button"
                className={`${styles.typeBtn} ${optType === t ? styles[`typeBtn${t}`] : ''}`}
                onClick={() => setOptType(t)}
                aria-pressed={optType === t}
              >
                {t} <span className={styles.typeHint}>{lbl}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Live option data ── */}
      <div className={styles.optionData}>
        <div className={styles.optDataGrid}>
          <OptDataItem label="Premium"  value={`₹${premium.toFixed(2)}`}  highlight />
          <OptDataItem label="IV"       value={`${(iv * 100).toFixed(1)}%`} color={iv > 0.25 ? 'warn' : 'neutral'} />
          <OptDataItem label="Delta"    value={greeks.delta.toFixed(3)}    color={greeks.delta > 0 ? 'bull' : 'bear'} />
          <OptDataItem label="Gamma"    value={greeks.gamma.toFixed(5)} />
          <OptDataItem label="Theta"    value={`${greeks.theta.toFixed(2)}/d`} color="bear" />
          <OptDataItem label="Vega"     value={greeks.vega.toFixed(2)} />
          <OptDataItem label="OI"       value={fmtNum(oi)} />
          <OptDataItem label="Volume"   value={fmtNum(volume)} />
          <OptDataItem label="Lot Size" value={lotSize} />
          <OptDataItem label="Margin"   value={`₹${(premium * lotSize).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} />
        </div>

        {/* Index move context */}
        <div className={styles.breakeven}>
          <span className={styles.breakevenLabel}>
            {optType === 'CE' ? '📈' : '📉'} Index needs to reach
          </span>
          <span className={styles.breakevenVal}>
            {breakeven.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </span>
          <span className={`${styles.breakevenMove} ${indexMoveNeeded > 0 ? styles.bull : styles.bear}`}>
            ({indexMoveNeeded > 0 ? '+' : ''}{indexMoveNeeded.toFixed(0)} pts) for breakeven
          </span>
        </div>
      </div>

      {/* ── Full option chain ── */}
      {showChain && (
        <OptionChain
          allStrikes={allStrikes}
          atm={atm}
          basePrice={basePrice}
          T={expiry.T}
          selectedStrike={strike}
          selectedType={optType}
          onSelect={(s, t) => { setStrike(s); setOptType(t) }}
        />
      )}
    </div>
  )
}

// ── Option chain ──────────────────────────────────────────────────────────────

function OptionChain({ allStrikes, atm, basePrice, T, selectedStrike, selectedType, onSelect }) {
  return (
    <div className={styles.chain}>
      {/* Column headers */}
      <div className={styles.chainHeader}>
        <span className={styles.chainColHdr} style={{ color: 'var(--color-bull)', fontSize: '0.6rem' }}>OI</span>
        <span className={styles.chainColHdr} style={{ color: 'var(--color-bull)' }}>CALL (CE)</span>
        <span className={styles.chainColHdr} style={{ color: 'var(--color-bull)', fontSize: '0.6rem' }}>Δ</span>
        <span className={styles.chainColHdr} style={{ color: 'var(--color-bull)', fontSize: '0.6rem' }}>IV%</span>
        <span className={styles.chainStrikeHdr}>Strike</span>
        <span className={styles.chainColHdr} style={{ color: 'var(--color-bear)', fontSize: '0.6rem' }}>IV%</span>
        <span className={styles.chainColHdr} style={{ color: 'var(--color-bear)', fontSize: '0.6rem' }}>Δ</span>
        <span className={styles.chainColHdr} style={{ color: 'var(--color-bear)' }}>PUT (PE)</span>
        <span className={styles.chainColHdr} style={{ color: 'var(--color-bear)', fontSize: '0.6rem' }}>OI</span>
      </div>

      <div className={styles.chainBody}>
        {allStrikes.map(s => {
          const ivCE = impliedIV(s, atm)
          const ivPE = impliedIV(s, atm)
          const ce   = { premium: bsPrice(basePrice, s, T, ivCE, 'CE'), ...bsGreeks(basePrice, s, T, ivCE, 'CE') }
          const pe   = { premium: bsPrice(basePrice, s, T, ivPE, 'PE'), ...bsGreeks(basePrice, s, T, ivPE, 'PE') }
          const oiCE = mockOI(s, atm, 25, 'CE')
          const oiPE = mockOI(s, atm, 25, 'PE')
          const isAtm = s === atm
          const ceSelected = selectedStrike === s && selectedType === 'CE'
          const peSelected = selectedStrike === s && selectedType === 'PE'
          const mCE = getMoneyness(s, atm, 'CE')
          const mPE = getMoneyness(s, atm, 'PE')

          return (
            <div
              key={s}
              className={`${styles.chainRow} ${isAtm ? styles.chainAtm : ''}`}
            >
              {/* CE OI */}
              <span className={styles.chainOICell} style={{ color: 'var(--color-bull)' }}>{fmtNum(oiCE)}</span>

              {/* CE side */}
              <button
                type="button"
                className={`${styles.chainCell} ${styles.chainCE} ${ceSelected ? styles.chainSelected : ''} ${mCE === 'ITM' ? styles.chainITM : ''}`}
                onClick={() => onSelect(s, 'CE')}
                aria-label={`CE ${s} ₹${ce.premium.toFixed(1)}`}
              >
                <span className={styles.chainPremium}>₹{ce.premium.toFixed(1)}</span>
              </button>
              <span className={styles.chainGreek}>{ce.delta.toFixed(2)}</span>
              <span className={styles.chainIVCell}>{(ivCE * 100).toFixed(0)}%</span>

              {/* Strike */}
              <span className={`${styles.chainStrikeVal} ${isAtm ? styles.chainAtmStrike : ''}`}>
                {s.toLocaleString('en-IN')}
                {isAtm && <span className={styles.atmTag}>ATM</span>}
              </span>

              {/* PE side */}
              <span className={styles.chainIVCell}>{(ivPE * 100).toFixed(0)}%</span>
              <span className={styles.chainGreek}>{Math.abs(pe.delta).toFixed(2)}</span>
              <button
                type="button"
                className={`${styles.chainCell} ${styles.chainPE} ${peSelected ? styles.chainSelected : ''} ${mPE === 'ITM' ? styles.chainITM : ''}`}
                onClick={() => onSelect(s, 'PE')}
                aria-label={`PE ${s} ₹${pe.premium.toFixed(1)}`}
              >
                <span className={styles.chainPremium}>₹{pe.premium.toFixed(1)}</span>
              </button>

              {/* PE OI */}
              <span className={styles.chainOICell} style={{ color: 'var(--color-bear)' }}>{fmtNum(oiPE)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function OptDataItem({ label, value, highlight, color }) {
  const colorMap = { bull: 'var(--color-bull)', bear: 'var(--color-bear)', warn: 'var(--color-warn)', neutral: 'var(--color-text-secondary)' }
  return (
    <div className={styles.optDataItem}>
      <span className={styles.optDataLabel}>{label}</span>
      <span
        className={`${styles.optDataValue} ${highlight ? styles.optDataHighlight : ''}`}
        style={color ? { color: colorMap[color] } : {}}
      >{value}</span>
    </div>
  )
}

function fmtNum(n) {
  if (n >= 100000) return `${(n / 100000).toFixed(1)}L`
  if (n >= 1000)   return `${(n / 1000).toFixed(0)}K`
  return String(n)
}
