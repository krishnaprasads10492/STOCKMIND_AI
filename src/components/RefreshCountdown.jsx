/**
 * RefreshCountdown — shows time until next auto-refresh with a progress bar.
 */

import { usePredictionModeStore } from '@store/predictionModeStore.js'
import styles from './RefreshCountdown.module.css'

export function RefreshCountdown({ countdown, countdownSecs, onForceRefresh, loading }) {
  const { autoRefresh, setAutoRefresh, refreshCount } = usePredictionModeStore()
  const pct = Math.round((countdown / 60_000) * 100)

  return (
    <div className={styles.wrapper}>
      <div className={styles.bar}>
        <div className={styles.progress} style={{ width: `${pct}%` }} />
      </div>
      <div className={styles.info}>
        <span className={styles.label}>
          {autoRefresh
            ? loading ? 'Refreshing…' : `Next refresh in ${countdownSecs}s`
            : 'Auto-refresh paused'}
        </span>
        <div className={styles.controls}>
          {refreshCount > 0 && (
            <span className={styles.count}>#{refreshCount}</span>
          )}
          <button
            type="button"
            className={styles.forceBtn}
            onClick={onForceRefresh}
            disabled={loading}
            aria-label="Refresh now"
            title="Refresh now"
          >
            {loading ? '⟳' : '↺'}
          </button>
          <button
            type="button"
            className={`${styles.toggleBtn} ${autoRefresh ? styles.toggleOn : styles.toggleOff}`}
            onClick={() => setAutoRefresh(!autoRefresh)}
            aria-label={autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
            title={autoRefresh ? 'Pause' : 'Resume'}
          >
            {autoRefresh ? '⏸' : '▶'}
          </button>
        </div>
      </div>
    </div>
  )
}
