/**
 * PredictionModeSelector — Learning vs Real-World dual mode toggle.
 * Shows accuracy stats from the learning history.
 */

import { usePredictionModeStore, MODE_META } from '@store/predictionModeStore.js'
import styles from './PredictionModeSelector.module.css'

export function PredictionModeSelector() {
  const { activeMode, setMode, getAccuracyPct, learningStats, adaptiveWeights } = usePredictionModeStore()
  const accuracy = getAccuracyPct()

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.title}>Prediction Mode</span>
        {accuracy != null && (
          <span className={`${styles.accuracy} ${accuracy >= 75 ? styles.accGood : accuracy >= 60 ? styles.accWarn : styles.accBad}`}>
            {accuracy}% accuracy ({learningStats.totalPredictions} signals)
          </span>
        )}
      </div>

      <div className={styles.modes} role="radiogroup" aria-label="Prediction mode">
        {Object.entries(MODE_META).map(([mode, meta]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={activeMode === mode}
            className={`${styles.modeBtn} ${activeMode === mode ? styles.modeBtnActive : ''}`}
            style={activeMode === mode ? { '--mode-color': meta.color } : {}}
            onClick={() => setMode(mode)}
          >
            <span className={styles.modeIcon} aria-hidden="true">{meta.icon}</span>
            <div className={styles.modeText}>
              <span className={styles.modeLabel}>{meta.label}</span>
              <span className={styles.modeDesc}>{meta.desc}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Adaptive weight indicators */}
      {learningStats.totalPredictions > 0 && (
        <div className={styles.weights}>
          <span className={styles.weightsLabel}>Adaptive weights:</span>
          {Object.entries(adaptiveWeights).map(([type, w]) => (
            <span key={type} className={`${styles.weight} ${w > 1 ? styles.weightUp : w < 1 ? styles.weightDown : ''}`}>
              {type} {w > 1 ? '▲' : w < 1 ? '▼' : '='}{w.toFixed(2)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
