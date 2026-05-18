/**
 * MarketStatusBadge — shows LIVE or EOD (End of Day) status.
 *
 * LIVE  — market is open, data is real-time (green pulse)
 * EOD   — market is closed, showing last close value (amber, static)
 *
 * Used in: LivePricePanel header, IndicesTicker, PredictionsPage
 */

import { useMemo } from 'react'
import { getMarketSession, formatEODTime } from '@utils/marketHours.js'
import styles from './MarketStatusBadge.module.css'

/**
 * @param {{ moduleId: string, tick?: object, compact?: boolean }} props
 */
export function MarketStatusBadge({ moduleId, tick, compact = false }) {
  const session = useMemo(() => getMarketSession(moduleId), [moduleId])

  // Crypto is always live
  const isCrypto = moduleId === 'crypto'

  // Determine actual live state:
  // - Crypto: always live
  // - Others: market session must be open AND tick must be fresh (< 60s)
  const tickFresh = tick?.ts && Date.now() - tick.ts < 60_000
  const isLive    = isCrypto || (session.isLive && (tickFresh || !tick))

  if (isLive) {
    return (
      <span
        className={`${styles.badge} ${styles.live} ${compact ? styles.compact : ''}`}
        title={`Market open — live data${session.closesAt ? ` · closes ${session.closesAt}` : ''}`}
        aria-label="Market is live"
      >
        <span className={styles.dot} aria-hidden="true" />
        {!compact && 'LIVE'}
      </span>
    )
  }

  // EOD — show last update time
  const eodTime = tick?.ts ? formatEODTime(tick.ts) : 'EOD'
  const nextOpen = session.nextOpen

  return (
    <span
      className={`${styles.badge} ${styles.eod} ${compact ? styles.compact : ''}`}
      title={`Market closed · Last: ${eodTime}${nextOpen ? ` · Opens: ${nextOpen}` : ''}`}
      aria-label="Market closed, showing end of day data"
    >
      <span className={styles.dot} aria-hidden="true" />
      {compact ? 'EOD' : `EOD · ${eodTime}`}
    </span>
  )
}
