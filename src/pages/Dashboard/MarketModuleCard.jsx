import { useNavigate } from 'react-router-dom'
import styles from './DashboardPage.module.css'

export function MarketModuleCard({ module }) {
  const navigate = useNavigate()

  return (
    <button
      className={styles.moduleCard}
      onClick={() => navigate(`/predictions?module=${module.id}`)}
      aria-label={`Open ${module.label} predictions`}
    >
      <span className={styles.moduleIcon} aria-hidden="true">{module.icon}</span>
      <div className={styles.moduleInfo}>
        <span className={styles.moduleLabel}>{module.label}</span>
        <span className={styles.moduleDesc}>{module.desc}</span>
      </div>
      <span className={styles.moduleArrow} aria-hidden="true">→</span>
    </button>
  )
}
