/**
 * Disclaimer — non-removable legal disclaimer (Section 16.3.1).
 *
 * This component MUST be rendered on every page that shows predictions.
 * It is intentionally non-dismissible per the spec.
 * Do NOT add a close/hide button.
 */

import { DISCLAIMERS, JURISDICTIONS } from '@utils/constants.js'
import styles from './Disclaimer.module.css'

const JURISDICTION = import.meta.env.VITE_DISCLAIMER_JURISDICTION ?? JURISDICTIONS.IN
const TEXT = DISCLAIMERS[JURISDICTION] ?? DISCLAIMERS[JURISDICTIONS.IN]

/**
 * @param {{ compact?: boolean }} props
 */
export function Disclaimer({ compact = false }) {
  return (
    <aside
      className={`${styles.disclaimer} ${compact ? styles.compact : ''}`}
      role="note"
      aria-label="Important disclaimer"
    >
      <span className={styles.icon} aria-hidden="true">⚠️</span>
      <p className={styles.text}>{TEXT}</p>
    </aside>
  )
}
