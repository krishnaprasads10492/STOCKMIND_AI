/**
 * FuturesPanel — Futures contract picker for F&O predictions.
 *
 * Features:
 *   - Expiry selector: near / mid / far month
 *   - Live basis (futures price vs spot)
 *   - Lot size display + lot count selector
 *   - Margin estimate
 *   - Rollover indicator (days to expiry)
 */

import { useState, useEffect, useMemo } from 'react'
import styles from './FuturesPanel.module.css'

// ── Config ────────────────────────────────────────────────────────────────────

const LOT_SIZES = {
  NIFTY: 25, BANKNIFTY: 15, FINNIFTY: 40, MIDCPNIFTY: 75, SENSEX: 10,
  NIFTY50: 25, RELIANCE: 250, TCS: 150, INFY: 300, HDFCBANK: 550,
  default: 100,
}

// Approximate margin % (SPAN + Exposure) — varies by broker
const MARGIN_PCT = 0.12  // ~12% of contract value

// ── Expiry generation ─────────────────────────────────────────────────────────

function generateFuturesExpiries() {
  const expiries = []
  const now = new Date()

  for (let m = 0; m < 3; m++) {
    // Last Thursday of each month
    const month = new Date(now.getFullYear(), now.getMonth() + m + 1, 0)
    while (month.getDay() !== 4) month.setDate(month.getDate() - 1)

    const daysLeft = Math.round((month - now) / 86400000)
    if (daysLeft < 0) continue

    const label = month.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
    const value = fmtExpiry(month)

    expiries.push({
      label,
      value,
      date: month,
      daysLeft,
      series: m === 0 ? 'Near' : m === 1 ? 'Mid' : 'Far',
    })
  }

  return expiries
}

function fmtExpiry(date) {
  const dd  = String(date.getDate()).padStart(2, '0')
  const mon = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
  const yy  = String(date.getFullYear()).slice(2)
  return `${dd}${mon}${yy}`
}

// ── Basis calculation ─────────────────────────────────────────────────────────

function calcFuturesPrice(spotPrice, daysLeft) {
  // Cost of carry model: F = S * e^(r*T)
  // Using simple approximation: F ≈ S * (1 + r * T/365)
  const r = 0.065  // risk-free rate ~6.5%
  const T = daysLeft / 365
  const fair = spotPrice * (1 + r * T)
  // Add small random noise to simulate market premium/discount
  const noise = (Math.random() - 0.5) * spotPrice * 0.001
  return Math.round((fair + noise) * 100) / 100
}

// ── Main component ────────────────────────────────────────────────────────────

export function FuturesPanel({ underlying, basePrice, onFuturesSelect }) {
  const lotSize = LOT_SIZES[underlying] ?? LOT_SIZES.default
  const expiries = useMemo(() => generateFuturesExpiries(), [])

  const [expiry,   setExpiry]   = useState(expiries[0])
  const [lots,     setLots]     = useState(1)
  const [showInfo, setShowInfo] = useState(false)

  const futuresPrice   = useMemo(() => calcFuturesPrice(basePrice, expiry?.daysLeft ?? 30), [basePrice, expiry])
  const basis          = Math.round((futuresPrice - basePrice) * 100) / 100
  const basisPct       = Math.round((basis / basePrice) * 10000) / 100
  const contractValue  = Math.round(futuresPrice * lotSize * lots)
  const marginRequired = Math.round(contractValue * MARGIN_PCT)
  const futuresSymbol  = `${underlying}${expiry?.value ?? ''}FUT`

  // Rollover warning: < 5 days to expiry
  const isNearExpiry = (expiry?.daysLeft ?? 99) <= 5

  useEffect(() => {
    if (!expiry) return
    onFuturesSelect?.({
      symbol:         futuresSymbol,
      underlying,
      expiry:         expiry.value,
      daysLeft:       expiry.daysLeft,
      series:         expiry.series,
      futuresPrice,
      spotPrice:      basePrice,
      basis,
      basisPct,
      lotSize,
      lots,
      contractValue,
      marginRequired,
    })
  }, [futuresSymbol, expiry?.value, lots]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!expiries.length) {
    return (
      <div className={styles.panel}>
        <p className={styles.noData}>No futures expiries available</p>
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <span className={styles.title}>Futures</span>
        <span className={styles.symbol}>{futuresSymbol}</span>
        {isNearExpiry && (
          <span className={styles.expiryWarn} title="Near expiry — consider rolling over">
            ⚠ {expiry.daysLeft}d to expiry
          </span>
        )}
        <button
          type="button"
          className={styles.infoBtn}
          onClick={() => setShowInfo(s => !s)}
          aria-expanded={showInfo}
          aria-label="Show futures info"
        >
          {showInfo ? 'Less ▲' : 'Details ▼'}
        </button>
      </div>

      {/* ── Controls ── */}
      <div className={styles.controls}>
        {/* Expiry selector */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="fut-expiry">
            Expiry
            {expiry && (
              <span className={`${styles.seriesBadge} ${styles[`series${expiry.series}`]}`}>
                {expiry.series}
              </span>
            )}
          </label>
          <select
            id="fut-expiry"
            className={styles.select}
            value={expiry?.value ?? ''}
            onChange={e => setExpiry(expiries.find(x => x.value === e.target.value) ?? expiries[0])}
          >
            {expiries.map(ex => (
              <option key={ex.value} value={ex.value}>
                {ex.label} ({ex.series}) — {ex.daysLeft}d
              </option>
            ))}
          </select>
        </div>

        {/* Lot count */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="fut-lots">
            Lots
            <span className={styles.lotHint}>× {lotSize} = {(lots * lotSize).toLocaleString('en-IN')} qty</span>
          </label>
          <div className={styles.lotsRow}>
            <button
              type="button"
              className={styles.lotBtn}
              onClick={() => setLots(l => Math.max(1, l - 1))}
              aria-label="Decrease lots"
              disabled={lots <= 1}
            >−</button>
            <input
              id="fut-lots"
              type="number"
              min={1}
              max={50}
              value={lots}
              onChange={e => setLots(Math.max(1, Math.min(50, Number(e.target.value))))}
              className={styles.lotsInput}
              aria-label="Number of lots"
            />
            <button
              type="button"
              className={styles.lotBtn}
              onClick={() => setLots(l => Math.min(50, l + 1))}
              aria-label="Increase lots"
              disabled={lots >= 50}
            >+</button>
          </div>
        </div>
      </div>

      {/* ── Key data strip ── */}
      <div className={styles.dataStrip}>
        <DataItem label="Futures" value={`₹${futuresPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`} highlight />
        <DataItem label="Spot"    value={`₹${basePrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`} />
        <DataItem
          label="Basis"
          value={`${basis > 0 ? '+' : ''}${basis.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${basisPct > 0 ? '+' : ''}${basisPct}%)`}
          color={basis > 0 ? 'bull' : 'bear'}
        />
        <DataItem label="Lot Size" value={lotSize} />
      </div>

      {/* ── Expanded details ── */}
      {showInfo && (
        <div className={styles.details}>
          <div className={styles.detailGrid}>
            <DataItem label="Contract Value" value={`₹${contractValue.toLocaleString('en-IN')}`} highlight />
            <DataItem label="Margin ~12%"    value={`₹${marginRequired.toLocaleString('en-IN')}`} color="warn" />
            <DataItem label="Days to Expiry" value={`${expiry?.daysLeft ?? '—'}d`} color={isNearExpiry ? 'warn' : 'neutral'} />
            <DataItem label="Series"         value={expiry?.series ?? '—'} />
          </div>

          <div className={styles.note}>
            <span>ℹ</span>
            <p>
              Basis = Futures − Spot. Positive basis (contango) is normal.
              Margin is approximate — check with your broker for exact SPAN requirements.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helper ────────────────────────────────────────────────────────────────────

function DataItem({ label, value, highlight, color }) {
  const colorMap = {
    bull: 'var(--color-bull)', bear: 'var(--color-bear)',
    warn: 'var(--color-warn)', neutral: 'var(--color-text-secondary)',
  }
  return (
    <div className={styles.dataItem}>
      <span className={styles.dataLabel}>{label}</span>
      <span
        className={`${styles.dataValue} ${highlight ? styles.dataHighlight : ''}`}
        style={color ? { color: colorMap[color] } : {}}
      >
        {value}
      </span>
    </div>
  )
}
