/**
 * IndicesTicker — scrolling live indices bar with hover detail tooltip.
 * Refreshes every 2.4 seconds. Pauses on hover.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useMarketStore, HEADER_INDICES } from '@store/marketStore.js'
import { batchFetchQuotes } from '@services/indianMarketFeed.js'
import { getMarketSession } from '@utils/marketHours.js'
import styles from './IndicesTicker.module.css'

const TICKER_REFRESH_MS = 2_400

export function IndicesTicker() {
  const { activeModuleId } = useMarketStore()
  const symbols = HEADER_INDICES[activeModuleId] ?? []

  const [prices,     setPrices]     = useState([])
  const [hovered,    setHovered]    = useState(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [paused,     setPaused]     = useState(false)
  const [dataSource, setDataSource] = useState('mock')
  const barRef = useRef(null)

  // Check market session — only poll when live, fetch once for EOD
  const session = useMemo(() => getMarketSession(activeModuleId), [activeModuleId])

  const refresh = useCallback(async () => {
    const exchange = ['indices-india','equities-india','fno-india'].includes(activeModuleId) ? 'NSE' : 'GLOBAL'
    if (symbols.length > 0) {
      const batchResult = await batchFetchQuotes(symbols, exchange)
      if (batchResult.size > 0) {
        const data = symbols.map(s => {
          const t = batchResult.get(s)
          // Only include symbols that have real data — skip missing ones
          if (!t?.price) return null
          return {
            symbol: s, label: t.companyName ?? s,
            price: t.price, change: t.change, changePct: t.changePct,
            marketState: t.marketState,
          }
        }).filter(Boolean)
        setPrices(data)
        setDataSource('yahoo')
        return
      }
    }
    // Backend unavailable — clear prices, show nothing
    setPrices([])
    setDataSource('unavailable')
  }, [symbols, activeModuleId])

  useEffect(() => {
    refresh()
    // Only poll continuously when market is live; fetch once for EOD
    if (!session.isLive && activeModuleId !== 'crypto') {
      return  // single fetch, no interval
    }
    const id = setInterval(refresh, TICKER_REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh, session.isLive, activeModuleId])

  // Tooltip uses the real tick data — no fabricated fields
  const hoveredItem   = useMemo(() => hovered ? prices.find(p => p.symbol === hovered) ?? null : null, [hovered, prices])
  const hoveredDetail = hoveredItem  // real data only, no getMockDetail

  function handleItemEnter(e, symbol) {
    setPaused(true)
    setHovered(symbol)
    const rect    = e.currentTarget.getBoundingClientRect()
    const barRect = barRef.current?.getBoundingClientRect()
    setTooltipPos({
      x: rect.left - (barRect?.left ?? 0),
      y: rect.bottom - (barRect?.top ?? 0) + 4,
    })
  }

  function handleItemLeave() {
    setPaused(false)
    setHovered(null)
  }

  if (!prices.length && dataSource === 'unavailable') {
    return (
      <div className={styles.bar} ref={barRef} role="region" aria-label="Market indices unavailable">
        <span className={styles.unavailable}>
          Market data unavailable — start the backend server
        </span>
      </div>
    )
  }

  if (!prices.length) return null

  return (
    <div className={styles.bar} ref={barRef} role="region" aria-label="Live market indices">
      <div className={`${styles.track} ${paused ? styles.paused : ''}`}>
        {[...prices, ...prices].map((p, i) => (
          <TickerItem
            key={`${p.symbol}-${i}`}
            item={p}
            isHovered={hovered === p.symbol}
            onMouseEnter={e => handleItemEnter(e, p.symbol)}
            onMouseLeave={handleItemLeave}
          />
        ))}
      </div>

      {/* Status row — below the scrolling track */}
      {dataSource === 'yahoo' && (
        <div className={styles.statusRow}>
          <span
            className={`${styles.sourceTag} ${session.isLive ? styles.sourceTagLive : styles.sourceTagEOD}`}
            title={session.isLive
              ? `Live · closes ${session.closesAt ?? ''}`
              : `EOD · next open: ${session.nextOpen ?? 'unknown'}`}
          >
            {session.isLive ? '● LIVE' : '◐ EOD'}
          </span>
        </div>
      )}

      {hoveredDetail && (
        <div
          className={styles.tooltip}
          style={{ left: Math.min(tooltipPos.x, (barRef.current?.offsetWidth ?? 800) - 260) }}
          role="tooltip"
        >
          <DetailTooltip item={hoveredDetail} />
        </div>
      )}
    </div>
  )
}

// Memoised — only re-renders when item data or hover state changes
const TickerItem = ({ item, isHovered, onMouseEnter, onMouseLeave }) => {
  const up = item.changePct >= 0
  return (
    <span
      className={`${styles.item} ${isHovered ? styles.itemHovered : ''}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      tabIndex={0}
      onFocus={onMouseEnter}
      onBlur={onMouseLeave}
      aria-label={`${item.symbol} ${item.price} ${up ? 'up' : 'down'} ${Math.abs(item.changePct).toFixed(2)}%`}
    >
      <span className={styles.symbol}>{item.symbol}</span>
      <span className={`${styles.price} ${up ? styles.up : styles.down}`}>
        {item.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
      </span>
      <span className={`${styles.change} ${up ? styles.up : styles.down}`}>
        {up ? '▲' : '▼'} {Math.abs(item.changePct).toFixed(2)}%
      </span>
    </span>
  )
}

function DetailTooltip({ item }) {
  const up  = item.changePct >= 0
  const fmt = n => typeof n === 'number' ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'

  return (
    <div className={styles.tooltipInner}>
      <div className={styles.ttHeader}>
        <span className={styles.ttSymbol}>{item.symbol}</span>
        <span className={`${styles.ttPrice} ${up ? styles.up : styles.down}`}>{fmt(item.price)}</span>
        <span className={`${styles.ttChange} ${up ? styles.up : styles.down}`}>
          {up ? '▲' : '▼'} {fmt(Math.abs(item.change ?? 0))} ({Math.abs(item.changePct ?? 0).toFixed(2)}%)
        </span>
      </div>
      <div className={styles.ttGrid}>
        {item.open      != null && <TtRow label="Open"      value={fmt(item.open)} />}
        {item.high      != null && <TtRow label="High"      value={fmt(item.high)}      color="var(--color-bull)" />}
        {item.low       != null && <TtRow label="Low"       value={fmt(item.low)}       color="var(--color-bear)" />}
        {item.close     != null && <TtRow label="Prev Close" value={fmt(item.close)} />}
        {item.volume    != null && item.volume > 0 && <TtRow label="Volume" value={item.volume.toLocaleString('en-IN')} />}
        {item.week52High != null && <TtRow label="52W High"  value={fmt(item.week52High)} color="var(--color-bull)" />}
        {item.week52Low  != null && <TtRow label="52W Low"   value={fmt(item.week52Low)}  color="var(--color-bear)" />}
        {item.pe        != null && <TtRow label="P/E"        value={fmt(item.pe)} />}
        {item.marketCap != null && <TtRow label="Mkt Cap"    value={fmtCap(item.marketCap)} />}
      </div>
    </div>
  )
}

function fmtCap(n) {
  if (!n) return '—'
  if (n >= 1e12) return `₹${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9)  return `₹${(n / 1e9).toFixed(1)}B`
  if (n >= 1e7)  return `₹${(n / 1e7).toFixed(1)}Cr`
  return `₹${n.toLocaleString('en-IN')}`
}

function TtRow({ label, value, color }) {
  return (
    <div className={styles.ttRow}>
      <span className={styles.ttLabel}>{label}</span>
      <span className={styles.ttValue} style={color ? { color } : {}}>{value}</span>
    </div>
  )
}
