/**
 * LiveMarketBadge — shows the actual live data source with distinct visual states.
 *
 * Each source has a unique colour + animation so users always know
 * exactly where their data is coming from:
 *
 *   ● 0xramm   — teal, slow pulse  (free NSE/BSE via Yahoo Finance)
 *   ● Binance  — green, fast pulse (real-time WebSocket)
 *   ● Zerodha  — cyan, glow        (Kite Connect SSE)
 *   ● Finnhub  — amber, static     (REST polling)
 *   ○ Simulated — grey, static     (mock data)
 */
import styles from './LiveMarketBadge.module.css'
import { getSourceMeta } from '@services/marketWebSocket.js'

export function LiveMarketBadge({ source, symbol, isLive }) {
  if (!symbol) return null

  const meta = getSourceMeta(source ?? (isLive ? '0xramm' : 'mock'))

  return (
    <span
      className={`${styles.badge} ${styles[meta.color]}`}
      title={meta.desc}
      aria-label={`Data source: ${meta.label}`}
    >
      <span className={styles.dot} aria-hidden="true" />
      {meta.label}
    </span>
  )
}
