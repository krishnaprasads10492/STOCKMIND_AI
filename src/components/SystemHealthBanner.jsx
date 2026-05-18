/**
 * SystemHealthBanner — shows a degraded-mode warning when the system is not at Level 0.
 *
 * Section 16.5.2 — Graceful Degradation.
 * Renders nothing when the system is fully healthy.
 */

import { useSystemHealth } from '@hooks/useSystemHealth.js'
import { SYSTEM_LEVELS } from '@utils/constants.js'
import styles from './SystemHealthBanner.module.css'

const MESSAGES = {
  [SYSTEM_LEVELS.DEGRADED_1]:      'Some data feeds are unavailable. Confidence scores are reduced.',
  [SYSTEM_LEVELS.DEGRADED_2]:      'Multiple data feeds are down. Predictions are limited to heuristics and capped at grade B.',
  [SYSTEM_LEVELS.HEURISTICS_ONLY]: 'AI inference is unavailable. Showing heuristic estimates only.',
  [SYSTEM_LEVELS.SUSPENDED]:       'Predictions are temporarily suspended. Please check back shortly.',
}

export function SystemHealthBanner({ inline = false }) {
  const { health, loading } = useSystemHealth()

  if (loading || health.level === SYSTEM_LEVELS.FULL) return null

  const message = MESSAGES[health.level] ?? 'System operating in reduced capacity.'
  const isCritical = health.level === SYSTEM_LEVELS.SUSPENDED

  return (
    <div
      className={`${styles.banner} ${isCritical ? styles.critical : styles.warning} ${inline ? styles.inline : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className={styles.icon} aria-hidden="true">
        {isCritical ? '🔴' : '🟡'}
      </span>
      <span className={styles.message}>{message}</span>
    </div>
  )
}
