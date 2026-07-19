import { useState, useRef, useEffect, useCallback } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@store/authStore.js'
import { useThemeStore } from '@store/themeStore.js'
import { useMarketStore } from '@store/marketStore.js'
import { logoutApi } from '@services/backendClient.js'
import { useSessionTimeout } from '@hooks/useSessionTimeout.js'
import { ErrorBoundary } from './ErrorBoundary.jsx'
import { SystemHealthBanner } from './SystemHealthBanner.jsx'
import { Disclaimer } from './Disclaimer.jsx'
import { MarketSelector } from './MarketSelector.jsx'
import { IndicesTicker } from './IndicesTicker.jsx'
import { KeygenModal } from './KeygenModal.jsx'
import { ChangePasswordModal } from './ChangePasswordModal.jsx'
import { VoiceCommandIndicator } from './VoiceCommandIndicator.jsx'
import { DangerSignalBanner } from './DangerSignalBanner.jsx'
import { PWAInstallBanner } from './PWAInstallBanner.jsx'
import { JarvisOrb } from './JarvisOrb.jsx'
import { apiFetch } from '@services/apiClient.js'
import styles from './AppShell.module.css'

const NAV_ITEMS = [
  { to: '/dashboard',             label: 'Dashboard',          icon: '⊞' },
  { to: '/predictions',           label: 'Predictions',        icon: '🎯' },
  { to: '/charts',                label: 'Charts',             icon: '📊' },
  { to: '/ami',                   label: 'AMI',                icon: '🧬' },
  { to: '/multibagger',           label: 'Multibagger',        icon: '🚀' },
  { to: '/strategy-intelligence', label: 'AI Intelligence',    icon: '🧠' },
  { to: '/jarvis',                label: 'Rama',               icon: '🪔' },
  { to: '/backtest',              label: 'Backtest',           icon: '📈' },
  { to: '/strategies',            label: 'Strategies',         icon: '🧩' },
  { to: '/favourites',            label: 'Favourites',         icon: '★' },
  { to: '/history',               label: 'History',            icon: '📋' },
  { to: '/learn',                 label: 'Learn',              icon: '📚' },
  { to: '/settings',              label: 'Settings',           icon: '⚙' },
]

export function AppShell() {
  const { user, clearSession, token } = useAuthStore()
  const { activeTheme, toggleTheme, nightLight, setNightLight, applyTheme } = useThemeStore()
  const { setActiveModule, setActiveSymbol } = useMarketStore()
  const navigate = useNavigate()
  const [timeoutWarning,  setTimeoutWarning]  = useState(false)
  const [showNightPanel,  setShowNightPanel]  = useState(false)
  const [showKeygen,      setShowKeygen]      = useState(false)
  const [showChangePw,    setShowChangePw]    = useState(false)
  const [jarvisToast,     setJarvisToast]     = useState(null)
  const jarvisToastTimer = useRef(null)
  const nightPanelRef    = useRef(null)

  const isSuperAdmin = user?.role === 'super-admin'
  const isLight      = activeTheme === 'light-clean'
  const mustChangePw = user?.mustChangePassword ?? false

  // ── Helper: show JARVIS feedback toast ───────────────────────────────────
  // Defined before any useCallback that calls it
  const showJarvisToast = useCallback((text, type = 'info') => {
    clearTimeout(jarvisToastTimer.current)
    setJarvisToast({ text, type })
    jarvisToastTimer.current = setTimeout(() => setJarvisToast(null), 4000)
  }, [])

  // ── JARVIS Universal Action Dispatcher ────────────────────────────────────
  // Defined before any useEffect that references it
  const handleJarvisAction = useCallback(async (action, reply) => {
    if (!action) return
    const { type } = action

    switch (type) {
      case 'navigate':
        navigate(action.to)
        break

      case 'generateSignals':
        if (action.symbol) setActiveSymbol(action.symbol)
        navigate(`/predictions${action.symbol ? `?symbol=${action.symbol}` : ''}`)
        break

      case 'setSymbol':
        if (action.symbol) {
          setActiveSymbol(action.symbol)
          showJarvisToast(`Symbol: ${action.symbol}`, 'info')
        }
        break

      case 'setModule':
        if (action.moduleId) {
          setActiveModule(action.moduleId)
          showJarvisToast(`Market: ${action.moduleId.replace(/-/g, ' ')}`, 'info')
        }
        break

      case 'setTheme':
        if (action.theme) {
          try { applyTheme?.(action.theme) } catch {}
        }
        break

      case 'setNightLight':
        setNightLight(action.value ?? 0)
        break

      case 'setChartInterval':
        window.dispatchEvent(new CustomEvent('jarvis:setInterval', { detail: action.interval }))
        break

      case 'systemScan':
        navigate('/jarvis')
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('jarvis:scan', { detail: action.scanType }))
        }, 500)
        break

      case 'openModal':
        if (action.modal === 'keygen')         setShowKeygen(true)
        if (action.modal === 'changePassword') setShowChangePw(true)
        break

      case 'addFavourite':
        if (action.symbol) {
          window.dispatchEvent(new CustomEvent('jarvis:addFavourite', { detail: action.symbol }))
          showJarvisToast(`Added ${action.symbol} to favourites`, 'success')
        }
        break

      case 'fullscreen':
        window.dispatchEvent(new CustomEvent('jarvis:fullscreen'))
        break

      case 'chat':
        // Pure Q&A — response shown in orb panel, no app action needed
        break

      default:
        break
    }

    if (reply) showJarvisToast(`JARVIS: ${reply.slice(0, 80)}`, 'jarvis')
  }, [navigate, setActiveSymbol, setActiveModule, setNightLight, applyTheme, showJarvisToast]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Voice command handler ─────────────────────────────────────────────────
  const handleVoiceCommand = useCallback(({ command, action, reply }) => {
    if (action) {
      handleJarvisAction(action, reply)
      return
    }
    // Legacy rigid command fallback
    switch (command) {
      case 'STATUS': case 'SHOW_ALERTS': navigate('/jarvis'); break
      case 'SCAN':   navigate('/jarvis'); break
      default:       break
    }
  }, [navigate, handleJarvisAction])

  // ── Effects — all after callbacks are defined ─────────────────────────────

  useSessionTimeout(() => setTimeoutWarning(true))

  // Listen for JARVIS actions dispatched from JarvisOrb and other components
  useEffect(() => {
    function handler(e) {
      const { action, reply } = e.detail ?? {}
      if (action) handleJarvisAction(action, reply)
    }
    window.addEventListener('jarvis:action', handler)
    return () => window.removeEventListener('jarvis:action', handler)
  }, [handleJarvisAction])

  // Close night panel on outside click
  useEffect(() => {
    function handler(e) {
      if (nightPanelRef.current && !nightPanelRef.current.contains(e.target)) {
        setShowNightPanel(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Logout ────────────────────────────────────────────────────────────────
  async function handleLogout() {
    await logoutApi()
    clearSession()
    try {
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map(k => caches.delete(k)))
      }
      sessionStorage.clear()
    } catch {}
    navigate('/login', { replace: true })
  }

  function handlePasswordChanged(reLoginNeeded) {
    setShowChangePw(false)
    if (reLoginNeeded) {
      clearSession()
      navigate('/login', { replace: true })
    }
  }

  return (
    <div className={`${styles.shell} theme-${activeTheme}`}>
      {/* ── Forced password change (blocks all content) ── */}
      {mustChangePw && (
        <ChangePasswordModal forced onClose={handlePasswordChanged} />
      )}

      {/* ── Keygen modal ── */}
      {showKeygen && <KeygenModal onClose={() => setShowKeygen(false)} />}

      {/* ── Change password modal ── */}
      {showChangePw && !mustChangePw && (
        <ChangePasswordModal onClose={handlePasswordChanged} />
      )}
      {/* ── Timeout warning banner ── */}
      {timeoutWarning && (
        <div className={styles.timeoutBanner} role="alert">
          <span>⏱ Session expiring in 2 minutes due to inactivity.</span>
          <button onClick={() => setTimeoutWarning(false)} className={styles.timeoutDismiss}>
            Keep me logged in
          </button>
        </div>
      )}

      {/* ── Top bar ── */}
      <header className={styles.topbar}>
        <span className={styles.logo}>
          {/* Inline SVG logo matching favicon */}
          <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="var(--color-bg-elevated)"/>
            <polyline points="4,22 10,14 17,18 26,8" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points="21,8 26,8 26,13" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="17" cy="18" r="2.5" fill="var(--color-ai)"/>
          </svg>
          <span className={styles.logoText}>StockMind <span className={styles.logoAI}>AI</span></span>
        </span>

        <ErrorBoundary fallbackMessage="">
          <SystemHealthBanner inline />
        </ErrorBoundary>

        <div className={styles.topbarRight}>
          <ErrorBoundary fallbackMessage="">
            <MarketSelector />
          </ErrorBoundary>

          {/* Theme toggle */}
          <button
            className={styles.iconBtn}
            onClick={toggleTheme}
            aria-label={`Switch to ${isLight ? 'dark' : 'light'} theme`}
            title={`${isLight ? 'Dark' : 'Light'} mode`}
          >
            {isLight ? '◑' : '☀'}
          </button>

          {/* Night light control — only in dark mode */}
          {!isLight && (
            <div className={styles.nightWrap} ref={nightPanelRef}>
              <button
                className={`${styles.iconBtn} ${nightLight > 0 ? styles.iconBtnActive : ''}`}
                onClick={() => setShowNightPanel(s => !s)}
                aria-label="Night light settings"
                title={`Night light: ${nightLight}%`}
              >
                🌙
              </button>
              {showNightPanel && (
                <div className={styles.nightPanel} role="dialog" aria-label="Night light">
                  <div className={styles.nightHeader}>
                    <span>🌙 Night Light</span>
                    <span className={styles.nightVal}>{nightLight}%</span>
                  </div>
                  <input
                    type="range"
                    min={0} max={100} step={5}
                    value={nightLight}
                    onChange={e => setNightLight(Number(e.target.value))}
                    className={styles.nightSlider}
                    aria-label={`Night light intensity: ${nightLight}%`}
                  />
                  <div className={styles.nightPresets}>
                    {[[0,'Off'],[20,'Low'],[40,'Med'],[60,'High'],[80,'Max']].map(([v, l]) => (
                      <button
                        key={v}
                        type="button"
                        className={`${styles.nightPreset} ${nightLight === v ? styles.nightPresetActive : ''}`}
                        onClick={() => setNightLight(v)}
                      >{l}</button>
                    ))}
                  </div>
                  <p className={styles.nightNote}>Warms screen colour to reduce eye strain</p>
                </div>
              )}
            </div>
          )}

          <div className={styles.userArea}>
            <span className={styles.username} title={user?.role}>
              {user?.username}
              {user?.role === 'admin' && <span className={styles.adminBadge}>admin</span>}
              {user?.role === 'super-admin' && <span className={styles.adminBadge} style={{ background: 'var(--color-ai-dim)', color: 'var(--color-ai)', borderColor: 'var(--color-ai)' }}>super-admin</span>}
            </span>

            {/* 🔑 Generate key — masked as info icon, opens keygen modal */}
            <button
              className={`${styles.iconBtn} ${styles.keygenBtn}`}
              onClick={() => setShowKeygen(true)}
              aria-label="Generate access key"
              title="Generate / renew your 12-digit access key"
            >
              🔑
            </button>

            {/* 🔒 Change password */}
            <button
              className={styles.iconBtn}
              onClick={() => setShowChangePw(true)}
              aria-label="Change password"
              title="Change password"
            >
              🔒
            </button>

            <button className={styles.logoutBtn} onClick={handleLogout} aria-label="Log out" title="Log out">
              ⏻
            </button>
          </div>
        </div>
      </header>

      {/* ── Indices ticker ── */}
      <ErrorBoundary fallbackMessage="">
        <IndicesTicker />
      </ErrorBoundary>

      <div className={styles.body}>
        {/* ── Side nav ── */}
        <nav className={styles.sidenav} aria-label="Main navigation">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}
            >
              <span className={styles.navIcon} aria-hidden="true">{item.icon}</span>
              <span className={styles.navLabel}>{item.label}</span>
            </NavLink>
          ))}

          {user?.role === 'admin' && (
            <NavLink
              to="/admin"
              className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}
            >
              <span className={styles.navIcon} aria-hidden="true">👤</span>
              <span className={styles.navLabel}>Admin</span>
            </NavLink>
          )}
          {user?.role === 'super-admin' && (
            <>
              <NavLink
                to="/admin"
                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}
              >
                <span className={styles.navIcon} aria-hidden="true">👤</span>
                <span className={styles.navLabel}>Admin</span>
              </NavLink>
              <NavLink
                to="/configurator"
                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}
              >
                <span className={styles.navIcon} aria-hidden="true">🔌</span>
                <span className={styles.navLabel}>Configurator</span>
              </NavLink>
              <NavLink
                to="/doc-upgrade"
                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}
              >
                <span className={styles.navIcon} aria-hidden="true">📄</span>
                <span className={styles.navLabel}>Doc Upgrade</span>
              </NavLink>
              <NavLink
                to="/distribute"
                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}
              >
                <span className={styles.navIcon} aria-hidden="true">📦</span>
                <span className={styles.navLabel}>Distribute</span>
              </NavLink>
              <NavLink
                to="/security"
                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}
              >
                <span className={styles.navIcon} aria-hidden="true">🛡</span>
                <span className={styles.navLabel}>Security</span>
              </NavLink>
              <NavLink to="/rama-conversations"
                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}>
                <span className={styles.navIcon} aria-hidden="true">💬</span>
                <span className={styles.navLabel}>Conversations</span>
              </NavLink>
              <NavLink to="/rama-knowledge"
                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}>
                <span className={styles.navIcon} aria-hidden="true">🧠</span>
                <span className={styles.navLabel}>Knowledge</span>
              </NavLink>
            </>
          )}
        </nav>

        <main className={styles.main} id="main-content">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {/* ── Mobile bottom navigation (hidden on desktop via CSS) ── */}
      <nav className={styles.bottomNav} aria-label="Mobile navigation">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `${styles.bottomNavItem} ${isActive ? styles.bottomNavItemActive : ''}`
            }
          >
            <span className={styles.bottomNavIcon} aria-hidden="true">{item.icon}</span>
            <span className={styles.bottomNavLabel}>{item.label}</span>
          </NavLink>
        ))}
        {user?.role === 'admin' && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `${styles.bottomNavItem} ${isActive ? styles.bottomNavItemActive : ''}`
            }
          >
            <span className={styles.bottomNavIcon} aria-hidden="true">👤</span>
            <span className={styles.bottomNavLabel}>Admin</span>
          </NavLink>
        )}
      </nav>

      <footer className={styles.footer}>
        <Disclaimer compact />
      </footer>

      {/* ── JARVIS action toast — shows what JARVIS just did ── */}
      {jarvisToast && (
        <div
          className={`${styles.jarvisToast} ${styles[`jarvisToast_${jarvisToast.type}`]}`}
          role="status"
          aria-live="polite"
        >
          <span className={styles.jarvisToastIcon}>🤖</span>
          <span className={styles.jarvisToastText}>{jarvisToast.text}</span>
          <button className={styles.jarvisToastClose} onClick={() => setJarvisToast(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* Voice command indicator — super-admin, floating */}
      <ErrorBoundary fallbackMessage="">
        <VoiceCommandIndicator onCommand={handleVoiceCommand} token={token} />
      </ErrorBoundary>

      {/* Danger signal banner — fixed top, non-dismissible */}
      <ErrorBoundary fallbackMessage="">
        <DangerSignalBanner />
      </ErrorBoundary>

      {/* PWA install banner — mobile only, shown once */}
      <PWAInstallBanner />

      {/* JARVIS persistent orb — floating AI presence */}
      <ErrorBoundary fallbackMessage="">
        <JarvisOrb />
      </ErrorBoundary>
    </div>
  )
}
