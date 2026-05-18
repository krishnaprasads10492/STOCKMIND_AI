/**
 * LivePricePanel — shows real price data for the selected instrument.
 * Only displays data from Yahoo Finance (via backend).
 * Shows a loading skeleton while waiting for the first tick.
 * No simulated or fabricated data is ever shown.
 */

import { useState, useEffect } from 'react'
import { useMarketStore } from '@store/marketStore.js'
import { useMarketFeed } from '@services/marketWebSocket.js'
import { LiveMarketBadge } from './LiveMarketBadge.jsx'
import { MarketStatusBadge } from './MarketStatusBadge.jsx'
import { classifyTick } from '@utils/marketHours.js'
import styles from './LivePricePanel.module.css'

// ── Component ─────────────────────────────────────────────────────────────────

export function LivePricePanel({ symbol, instrType = 'spot', optionMeta = null }) {
  const { activeModuleId } = useMarketStore()
  const [data, setData] = useState(null)

  const { tick, isLive, source } = useMarketFeed(
    instrType === 'options' ? optionMeta?.underlying ?? symbol : symbol,
    activeModuleId
  )

  const tickClass = tick ? classifyTick(tick, activeModuleId) : { isLive: false, isEOD: false }

  // Build display data from real tick only — no fabricated values
  useEffect(() => {
    if (!tick?.price) return
    setData({
      symbol,
      instrType,
      price:      tick.price,
      change:     tick.change    ?? 0,
      changePct:  tick.changePct ?? 0,
      open:       tick.open,
      high:       tick.high,
      low:        tick.low,
      close:      tick.close,
      volume:     tick.volume,
      week52High: tick.week52High,
      week52Low:  tick.week52Low,
      marketCap:  tick.marketCap,
      pe:         tick.pe,
      sector:     tick.sector,
      companyName: tick.companyName,
      updatedAt:  new Date(tick.ts).toLocaleTimeString('en-IN'),
    })
  }, [tick]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!symbol) return null

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>
          {instrType === 'options' && optionMeta
            ? `${optionMeta.underlying} ${optionMeta.strike} ${optionMeta.optType}`
            : symbol}
        </span>
        <span className={styles.instrBadge} data-type={instrType}>
          {instrType === 'options' ? `${optionMeta?.optType ?? 'OPT'}` : instrType === 'futures' ? 'FUT' : 'SPOT'}
        </span>
        <MarketStatusBadge moduleId={activeModuleId} tick={tick} compact />
        <LiveMarketBadge isLive={isLive} source={source} symbol={symbol} />
        <span className={styles.updateTime}>
          {!data ? '—' : tickClass.isEOD ? `Close ${data.updatedAt}` : data.updatedAt}
        </span>
      </div>

      {!data ? (
        <PriceSkeleton />
      ) : (
        <PriceContent data={data} isEOD={tickClass.isEOD} />
      )}
    </div>
  )
}

// ── Loading skeleton — no fake numbers ───────────────────────────────────────

function PriceSkeleton() {
  return (
    <div className={styles.skeleton}>
      <div className={`${styles.skeletonLine} ${styles.skeletonPrice}`} />
      <div className={styles.skeletonRow}>
        <div className={styles.skeletonLine} />
        <div className={styles.skeletonLine} />
        <div className={styles.skeletonLine} />
        <div className={styles.skeletonLine} />
      </div>
      <p className={styles.skeletonNote}>Fetching from Yahoo Finance…</p>
    </div>
  )
}

// ── Price content ─────────────────────────────────────────────────────────────

function PriceContent({ data, isEOD = false }) {
  const up  = (data.changePct ?? 0) >= 0
  const fmt = (n, dec = 2) => typeof n === 'number'
    ? n.toLocaleString('en-IN', { maximumFractionDigits: dec })
    : '—'

  return (
    <div className={styles.content}>
      {isEOD && (
        <div className={styles.eodNotice} role="status">
          <span>📅</span>
          <span>Market closed — showing last close value</span>
        </div>
      )}

      <div className={styles.priceRow}>
        <span className={`${styles.price} ${up ? styles.up : styles.down} ${isEOD ? styles.priceEOD : ''}`}>
          {fmt(data.price)}
        </span>
        <span className={`${styles.change} ${up ? styles.up : styles.down}`}>
          {up ? '▲' : '▼'} {fmt(Math.abs(data.change))}
          <span className={styles.changePct}> ({Math.abs(data.changePct ?? 0).toFixed(2)}%)</span>
        </span>
        {isEOD && <span className={styles.eodTag}>CLOSE</span>}
      </div>

      {/* OHLCV — only show fields that have real values */}
      <div className={styles.ohlcv}>
        {data.open   != null && <OhlcItem label="Open"  value={fmt(data.open)} />}
        {data.high   != null && <OhlcItem label="High"  value={fmt(data.high)}  color="var(--color-bull)" />}
        {data.low    != null && <OhlcItem label="Low"   value={fmt(data.low)}   color="var(--color-bear)" />}
        {data.volume != null && data.volume > 0 && <OhlcItem label="Vol" value={fmtVol(data.volume)} />}
      </div>

      <SpotDetails data={data} fmt={fmt} />
    </div>
  )
}

function SpotDetails({ data, fmt }) {
  const hasExtra = data.week52High || data.week52Low || data.pe || data.marketCap || data.sector
  if (!hasExtra) return null
  return (
    <div className={styles.details}>
      <div className={styles.detailGrid}>
        {data.week52High != null && <DetailItem label="52W High" value={fmt(data.week52High)} color="var(--color-bull)" />}
        {data.week52Low  != null && <DetailItem label="52W Low"  value={fmt(data.week52Low)}  color="var(--color-bear)" />}
        {data.pe         != null && <DetailItem label="P/E"      value={fmt(data.pe)} />}
        {data.marketCap  != null && <DetailItem label="Mkt Cap"  value={fmtCap(data.marketCap)} />}
        {data.sector     != null && <DetailItem label="Sector"   value={data.sector} />}
      </div>
    </div>
  )
}

function OhlcItem({ label, value, color }) {
  return (
    <div className={styles.ohlcItem}>
      <span className={styles.ohlcLabel}>{label}</span>
      <span className={styles.ohlcValue} style={color ? { color } : {}}>{value}</span>
    </div>
  )
}

function DetailItem({ label, value, color }) {
  return (
    <div className={styles.detailItem}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailValue} style={color ? { color } : {}}>{value}</span>
    </div>
  )
}

function fmtVol(n) {
  if (!n && n !== 0) return '—'
  const abs  = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 10_000_000) return `${sign}${(abs / 10_000_000).toFixed(1)}Cr`
  if (abs >= 100_000)    return `${sign}${(abs / 100_000).toFixed(1)}L`
  if (abs >= 1_000)      return `${sign}${(abs / 1_000).toFixed(1)}K`
  return `${sign}${abs}`
}

function fmtCap(n) {
  if (!n) return '—'
  if (n >= 1e12) return `₹${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9)  return `₹${(n / 1e9).toFixed(1)}B`
  if (n >= 1e7)  return `₹${(n / 1e7).toFixed(1)}Cr`
  return `₹${n.toLocaleString('en-IN')}`
}
