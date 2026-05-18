import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@store/authStore.js'
import { useMarketStore, MARKET_MODULES } from '@store/marketStore.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import { SymbolPicker } from '@components/SymbolPicker.jsx'
import styles from './DashboardPage.module.css'

export default function DashboardPage() {
  const navigate  = useNavigate()
  const user      = useAuthStore(s => s.user)
  const { activeModuleId, activeSymbol, setActiveSymbol, setActiveModule, getActiveModule } = useMarketStore()

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const activeMod = getActiveModule()

  function goToPredict() {
    navigate(`/predictions?module=${activeModuleId}&symbol=${activeSymbol}`)
  }

  return (
    <div className={styles.page}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{greeting}, {user?.username}</h1>
          <p className={styles.subtitle}>
            Viewing <strong>{activeMod.label}</strong> — change market in the top-right selector
          </p>
        </div>
        <MarketStatusBadge />
      </div>

      {/* ── Quick predict bar ── */}
      <div className={styles.quickBar}>
        <div className={styles.quickBarLeft}>
          <span className={styles.quickLabel}>Quick Predict</span>
          <ErrorBoundary fallbackMessage="">
            <SymbolPicker
              value={activeSymbol}
              onChange={setActiveSymbol}
            />
          </ErrorBoundary>
        </div>
        <button className={styles.predictBtn} onClick={goToPredict}>
          ⚡ Generate Signals
        </button>
      </div>

      {/* ── Market module cards ── */}
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>All Markets</h2>
        <p className={styles.sectionHint}>Click any module to switch and predict</p>
      </div>

      <div className={styles.grid}>
        {MARKET_MODULES.map(mod => (
          <ErrorBoundary key={mod.id} fallbackMessage={`${mod.label} failed to load`}>
            <ModuleCard
              module={mod}
              isActive={mod.id === activeModuleId}
              onSelect={() => {
                setActiveModule(mod.id)
                navigate(`/predictions?module=${mod.id}`)
              }}
            />
          </ErrorBoundary>
        ))}
      </div>
    </div>
  )
}

function ModuleCard({ module: mod, isActive, onSelect }) {
  return (
    <button
      className={`${styles.moduleCard} ${isActive ? styles.moduleCardActive : ''}`}
      onClick={onSelect}
      aria-label={`${mod.label} — ${mod.desc}${isActive ? ' (active)' : ''}`}
      aria-pressed={isActive}
    >
      <span className={styles.moduleIcon} aria-hidden="true">{mod.icon}</span>
      <div className={styles.moduleInfo}>
        <span className={styles.moduleLabel}>{mod.label}</span>
        <span className={styles.moduleDesc}>{mod.desc}</span>
        <span className={styles.moduleCount}>{mod.symbols.length} symbols</span>
      </div>
      {isActive
        ? <span className={styles.activeChip} aria-hidden="true">Active</span>
        : <span className={styles.moduleArrow} aria-hidden="true">→</span>
      }
    </button>
  )
}

function MarketStatusBadge() {
  const now = new Date()
  const day  = now.getDay()
  const mins = now.getHours() * 60 + now.getMinutes()
  const isWeekday = day >= 1 && day <= 5
  const isNSEOpen = mins >= 555 && mins <= 930   // 9:15–15:30 IST
  const isCryptoOpen = true                       // 24/7

  const { activeModuleId } = useMarketStore()
  const isCrypto = activeModuleId === 'crypto'
  const isOpen   = isCrypto ? isCryptoOpen : (isWeekday && isNSEOpen)

  return (
    <div className={`${styles.statusBadge} ${isOpen ? styles.live : styles.closed}`}>
      <span className={styles.statusDot} aria-hidden="true" />
      <span>{isOpen ? 'Market Open' : 'Market Closed'}</span>
    </div>
  )
}
