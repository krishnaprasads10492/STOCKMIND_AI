/**
 * DashboardPage — JARVIS Mission Control
 * Futuristic wealth-accumulation command center.
 */
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@store/authStore.js'
import { useMarketStore, MARKET_MODULES } from '@store/marketStore.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import { SymbolPicker } from '@components/SymbolPicker.jsx'
import { apiFetch } from '@services/apiClient.js'
import styles from './DashboardPage.module.css'

export default function DashboardPage() {
  const navigate  = useNavigate()
  const user      = useAuthStore(s => s.user)
  const token     = useAuthStore(s => s.token)
  const { activeModuleId, activeSymbol, setActiveSymbol, setActiveModule, getActiveModule } = useMarketStore()

  const [health,   setHealth]   = useState(null)
  const [growth,   setGrowth]   = useState(null)
  const [time,     setTime]     = useState(new Date())
  const [bootSeq,  setBootSeq]  = useState(0)  // 0..4 boot animation steps

  const activeMod = getActiveModule()
  const hour = time.getHours()
  const greeting = hour < 12 ? 'GOOD MORNING' : hour < 17 ? 'GOOD AFTERNOON' : 'GOOD EVENING'

  // Boot animation — stagger panels appearing
  useEffect(() => {
    const timers = [1,2,3,4].map((step, i) =>
      setTimeout(() => setBootSeq(step), 150 * (i + 1))
    )
    return () => timers.forEach(clearTimeout)
  }, [])

  // Clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Health + growth polling
  useEffect(() => {
    if (!token) return
    let mounted = true
    async function poll() {
      try {
        const [h, g] = await Promise.allSettled([
          apiFetch('/api/jarvis/node-health'),
          apiFetch('/api/growth-worker/status'),
        ])
        if (!mounted) return
        if (h.status === 'fulfilled') setHealth(h.value)
        if (g.status === 'fulfilled') setGrowth(g.value)
      } catch {}
    }
    poll()
    const t = setInterval(poll, 20_000)
    return () => { mounted = false; clearInterval(t) }
  }, [token])

  function goToPredict() {
    navigate(`/predictions?module=${activeModuleId}&symbol=${activeSymbol}`)
  }

  const isMarketOpen = (() => {
    const d = time.getDay(), m = time.getHours() * 60 + time.getMinutes()
    if (activeModuleId === 'crypto') return true
    return d >= 1 && d <= 5 && m >= 555 && m <= 930
  })()

  return (
    <div className={styles.page}>

      {/* ── JARVIS Header ── */}
      <div className={`${styles.header} ${bootSeq >= 1 ? styles.visible : ''}`}>
        <div className={styles.headerLeft}>
          <div className={styles.jarvisGreeting}>
            <span className={styles.greetingLine}>{greeting}, <strong>{user?.username?.toUpperCase()}</strong></span>
            <span className={styles.greetingSubline}>JARVIS MISSION CONTROL · {activeMod.label.toUpperCase()}</span>
          </div>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.clock}>
            <span className={styles.clockTime}>{time.toLocaleTimeString('en-IN', { hour12: false })}</span>
            <span className={styles.clockDate}>{time.toLocaleDateString('en-IN', { weekday:'short', day:'2-digit', month:'short' })}</span>
          </div>
          <MarketStatusBadge isOpen={isMarketOpen} moduleId={activeModuleId} />
        </div>
      </div>

      {/* ── System Status Strip ── */}
      <div className={`${styles.statusStrip} ${bootSeq >= 2 ? styles.visible : ''}`}>
        <StatusNode label="NODE ENGINE" value={health ? 'ONLINE' : 'CONNECTING'} ok={!!health} />
        <StatusNode label="HEAP" value={health ? `${health.memory?.heap_used_mb}MB` : '—'} ok={health?.memory?.heap_used_mb < 400} />
        <StatusNode label="GROWTH AI" value={growth?.running ? 'ACTIVE' : 'IDLE'} ok={growth?.running} />
        <StatusNode label="CYCLES" value={growth?.total_cycles ?? '—'} ok />
        <StatusNode label="SYMBOLS" value={growth?.symbols_tracked ?? '—'} ok />
        <StatusNode label="UPTIME" value={health?.uptime_human ?? '—'} ok={!!health} />
      </div>

      {/* ── Quick Predict Command ── */}
      <div className={`${styles.commandBar} ${bootSeq >= 2 ? styles.visible : ''}`}>
        <div className={styles.commandLeft}>
          <span className={styles.commandPrompt}>⚡ PREDICT</span>
          <ErrorBoundary fallbackMessage="">
            <SymbolPicker value={activeSymbol} onChange={setActiveSymbol} />
          </ErrorBoundary>
        </div>
        <button className={styles.executeBtn} onClick={goToPredict} aria-label="Generate signals">
          <span className={styles.executeBtnInner}>EXECUTE</span>
          <span className={styles.executeBtnGlow} aria-hidden="true" />
        </button>
      </div>

      {/* ── Market Modules Grid ── */}
      <div className={`${styles.modulesSection} ${bootSeq >= 3 ? styles.visible : ''}`}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTag}>[ MARKET MODULES ]</span>
          <span className={styles.sectionHint}>{MARKET_MODULES.length} sectors available</span>
        </div>
        <div className={styles.grid}>
          {MARKET_MODULES.map((mod, i) => (
            <ErrorBoundary key={mod.id} fallbackMessage="">
              <ModuleCard
                module={mod}
                isActive={mod.id === activeModuleId}
                index={i}
                onSelect={() => {
                  setActiveModule(mod.id)
                  navigate(`/predictions?module=${mod.id}`)
                }}
              />
            </ErrorBoundary>
          ))}
        </div>
      </div>

      {/* ── Intel Cards ── */}
      <div className={`${styles.intelRow} ${bootSeq >= 4 ? styles.visible : ''}`}>
        <IntelCard
          icon="🧠"
          title="JARVIS Intelligence"
          desc="Self-healing AI engine with multi-horizon wave analysis, causal filters, and AGI-grade signal generation."
          action="Open JARVIS"
          onClick={() => navigate('/jarvis')}
          color="ai"
        />
        <IntelCard
          icon="🧬"
          title="AMI — Advanced Market Intel"
          desc="Deep-scan institutional activity, dark pool signals, options OI shifts, and macro regime detection."
          action="View AMI"
          onClick={() => navigate('/ami')}
          color="accent"
        />
        <IntelCard
          icon="🚀"
          title="Multibagger Scanner"
          desc="AI screens fundamentals + momentum + insider patterns to surface high-conviction wealth compounders."
          action="Find Multibaggers"
          onClick={() => navigate('/multibagger')}
          color="bull"
        />
      </div>

    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MarketStatusBadge({ isOpen, moduleId }) {
  return (
    <div className={`${styles.marketBadge} ${isOpen ? styles.marketOpen : styles.marketClosed}`}>
      <span className={styles.marketDot} aria-hidden="true" />
      <span>{isOpen ? (moduleId === 'crypto' ? '24/7 LIVE' : 'MARKET OPEN') : 'MARKET CLOSED'}</span>
    </div>
  )
}

function StatusNode({ label, value, ok }) {
  return (
    <div className={`${styles.statusNode} ${ok ? styles.statusOk : styles.statusWarn}`}>
      <span className={styles.statusNodeDot} />
      <div className={styles.statusNodeContent}>
        <span className={styles.statusNodeLabel}>{label}</span>
        <span className={styles.statusNodeValue}>{value}</span>
      </div>
    </div>
  )
}

function ModuleCard({ module: mod, isActive, index, onSelect }) {
  return (
    <button
      className={`${styles.moduleCard} ${isActive ? styles.moduleCardActive : ''}`}
      style={{ '--delay': `${index * 40}ms` }}
      onClick={onSelect}
      aria-label={`${mod.label}: ${mod.desc}${isActive ? ' (active)' : ''}`}
      aria-pressed={isActive}
    >
      {/* Corner brackets */}
      <span className={styles.cardCornerTL} aria-hidden="true" />
      <span className={styles.cardCornerBR} aria-hidden="true" />

      <span className={styles.moduleIcon} aria-hidden="true">{mod.icon}</span>
      <div className={styles.moduleInfo}>
        <span className={styles.moduleLabel}>{mod.label}</span>
        <span className={styles.moduleDesc}>{mod.desc}</span>
        <span className={styles.moduleCount}>{mod.symbols.length} instruments</span>
      </div>
      {isActive
        ? <span className={styles.activeChip}>ACTIVE</span>
        : <span className={styles.moduleArrow} aria-hidden="true">›</span>
      }
    </button>
  )
}

function IntelCard({ icon, title, desc, action, onClick, color }) {
  const colorMap = {
    ai:     'rgba(168,85,247,0.12)',
    accent: 'rgba(0,212,255,0.10)',
    bull:   'rgba(0,255,157,0.10)',
  }
  const borderMap = {
    ai:     'rgba(168,85,247,0.25)',
    accent: 'rgba(0,212,255,0.2)',
    bull:   'rgba(0,255,157,0.2)',
  }
  return (
    <div className={styles.intelCard} style={{ '--ic-bg': colorMap[color], '--ic-border': borderMap[color] }}>
      <span className={styles.intelIcon}>{icon}</span>
      <h3 className={styles.intelTitle}>{title}</h3>
      <p className={styles.intelDesc}>{desc}</p>
      <button className={styles.intelBtn} onClick={onClick}>{action} →</button>
    </div>
  )
}
