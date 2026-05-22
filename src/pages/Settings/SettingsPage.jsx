import { useState, useEffect } from 'react'
import { useAuthStore } from '@store/authStore.js'
import { useUiPrefsStore } from '@store/uiPrefsStore.js'
import { useThemeStore } from '@store/themeStore.js'
import { updatePreferencesApi } from '@services/backendClient.js'
import { apiFetch } from '@services/apiClient.js'
import { activateGhostMode, wipeServerData } from '@utils/ghostMode.js'
import { THEMES, THEME_KEYS } from '@utils/themes.js'
import styles from './SettingsPage.module.css'

export default function SettingsPage() {
  const { user, updatePreferences, token } = useAuthStore()
  const prefs = user?.preferences ?? {}
  const isSuperAdmin = user?.role === 'super-admin'
  const {
    infoTooltips, setInfoTooltips,
    showExamples, setShowExamples,
    pageTooltips, setPageTooltips,
  } = useUiPrefsStore()
  const { activeTheme, setTheme, nightLight, setNightLight } = useThemeStore()

  const [capital,  setCapital]  = useState(prefs.defaultCapital ?? 100000)
  const [risk,     setRisk]     = useState(prefs.riskPerTrade ?? 1.5)
  const [module,   setModule]   = useState(prefs.defaultModule ?? 'indices-india')
  const [cleanup,  setCleanup]  = useState(prefs.cleanupIntervalDays ?? 30)
  const [saved,    setSaved]    = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [showGhostConfirm, setShowGhostConfirm] = useState(false)
  const [ghostLoading,     setGhostLoading]     = useState(false)

  // ── AI Growth Worker state ──
  const [workerStatus,  setWorkerStatus]  = useState(null)
  const [workerLoading, setWorkerLoading] = useState(false)
  const [proposals,     setProposals]     = useState([])

  useEffect(() => {
    let cancelled = false
    async function fetchWorkerStatus() {
      try {
        const res = await apiFetch('/api/growth-worker/status')
        if (!cancelled && res.ok) {
          const data = await res.json()
          setWorkerStatus(data)
        }
      } catch { /* backend may not be running */ }
    }
    async function fetchProposals() {
      try {
        const res = await apiFetch('/api/growth-worker/proposals?limit=10')
        if (!cancelled && res.ok) {
          const data = await res.json()
          setProposals(data.proposals ?? [])
        }
      } catch { /* non-fatal */ }
    }
    fetchWorkerStatus()
    fetchProposals()
    const interval = setInterval(() => { fetchWorkerStatus(); fetchProposals() }, 15_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  async function toggleWorker() {
    if (!workerStatus) return
    setWorkerLoading(true)
    try {
      const action = workerStatus.running ? 'stop' : 'start'
      const res = await apiFetch(`/api/growth-worker/${action}`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setWorkerStatus(data.status)
      }
    } catch { /* non-fatal */ } finally {
      setWorkerLoading(false)
    }
  }

  async function handleProposalAction(id, action) {
    try {
      await apiFetch(`/api/growth-worker/proposals/${id}/${action}`, { method: 'POST' })
      setProposals(prev => prev.map(p => p.id === id ? { ...p, status: action === 'approve' ? 'approved' : 'dismissed' } : p))
    } catch { /* non-fatal */ }
  }

  async function handleSave(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSaved(false)
    try {
      const newPrefs = {
        defaultCapital:      capital,
        riskPerTrade:        risk,
        defaultModule:       module,
        cleanupIntervalDays: cleanup,
      }
      const res = await updatePreferencesApi(user.userId, newPrefs)
      if (res.error) { setError(res.error); return }
      updatePreferences(res.preferences ?? newPrefs)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Failed to save settings. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  async function handleGhostMode() {
    setGhostLoading(true)
    try {
      if (token) await wipeServerData(token)
    } catch { /* ignore server errors — local wipe still proceeds */ }
    await activateGhostMode()
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Settings</h1>

      {/* Ghost Mode confirmation modal */}
      {showGhostConfirm && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="ghost-title">
          <div className={styles.modalBox}>
            <h2 className={styles.modalTitle} id="ghost-title">👻 Activate Ghost Mode?</h2>
            <p className={styles.modalText}>
              This will immediately wipe ALL local app data from this device:
              localStorage, sessionStorage, IndexedDB, service workers, caches, and cookies.
              Your encrypted server-side data will also be deleted.
              <br /><br />
              <strong>This action is irreversible.</strong> You will be logged out and the page will go blank.
            </p>
            <div className={styles.modalActions}>
              <button className={styles.modalCancel} type="button"
                onClick={() => setShowGhostConfirm(false)} disabled={ghostLoading}>
                Cancel
              </button>
              <button className={styles.modalConfirm} type="button"
                onClick={handleGhostMode} disabled={ghostLoading}>
                {ghostLoading ? 'Wiping…' : 'Wipe Everything'}
              </button>
            </div>
          </div>
        </div>
      )}

      <form className={styles.form} onSubmit={handleSave} noValidate>

        {/* ── Appearance ── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Appearance</h2>
          <p className={styles.hint}>Choose a sci-fi theme. Changes apply instantly.</p>

          <div className={styles.themeGrid}>
            {THEME_KEYS.map(key => {
              const t = THEMES[key]
              const isActive = activeTheme === key
              const accentColor = t.vars?.['--color-accent'] ?? '#00d4ff'
              const bgColor     = t.vars?.['--color-bg-base'] ?? '#060b14'
              const textColor   = t.vars?.['--color-text-primary'] ?? '#e2f0ff'
              const borderColor = t.vars?.['--color-border'] ?? '#1e3a5f'
              return (
                <button
                  key={key}
                  type="button"
                  className={`${styles.themeCard} ${isActive ? styles.themeCardActive : ''}`}
                  onClick={() => setTheme(key)}
                  aria-pressed={isActive}
                  aria-label={`${t.name} theme: ${t.description}`}
                  style={{
                    '--preview-bg':     bgColor,
                    '--preview-accent': accentColor,
                    '--preview-text':   textColor,
                    '--preview-border': borderColor,
                  }}
                >
                  {/* Mini preview swatch */}
                  <div className={styles.themeSwatch} aria-hidden="true">
                    <div className={styles.swatchBg}
                      style={{ background: bgColor, borderColor }}>
                      <div className={styles.swatchAccent}
                        style={{ background: accentColor, boxShadow: `0 0 6px ${accentColor}` }} />
                      <div className={styles.swatchBar}
                        style={{ background: accentColor, opacity: 0.4 }} />
                      <div className={styles.swatchBar}
                        style={{ background: textColor, opacity: 0.15, width: '60%' }} />
                    </div>
                  </div>
                  <span className={styles.themeEmoji} aria-hidden="true">{t.emoji}</span>
                  <span className={styles.themeName}>{t.name}</span>
                  <span className={styles.themeDesc}>{t.description}</span>
                  <span className={styles.themeCategory}>{t.category}</span>
                  {isActive && <span className={styles.themeActiveBadge}>✓ Active</span>}
                </button>
              )
            })}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="night-light">
              Night Light: <strong>{nightLight}%</strong>
            </label>
            <input
              id="night-light"
              type="range"
              min={0} max={100} step={5}
              value={nightLight}
              onChange={e => setNightLight(Number(e.target.value))}
              className={styles.slider}
              aria-valuetext={`Night light intensity: ${nightLight}%`}
            />
            <p className={styles.hint}>Warms screen colour to reduce eye strain. Only applies to dark themes.</p>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Trading Defaults</h2>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="def-module">Default Market Module</label>
            <select id="def-module" className={styles.select} value={module} onChange={e => setModule(e.target.value)}>
              <option value="indices-india">Indian Indices</option>
              <option value="equities-india">Indian Equities</option>
              <option value="fno-india">F&O</option>
              <option value="crypto">Crypto</option>
              <option value="forex">Forex</option>
              <option value="commodities">Commodities</option>
              <option value="global-indices">Global Indices</option>
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="def-capital">Default Capital (₹)</label>
            <input id="def-capital" className={styles.input} type="number"
              min={1000} max={100000000} value={capital} onChange={e => setCapital(Number(e.target.value))} />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="def-risk">
              Risk per Trade: <strong>{risk}%</strong>
              <span className={styles.hint}> = ₹{Math.round(capital * risk / 100).toLocaleString('en-IN')} max risk</span>
            </label>
            <input id="def-risk" type="range" min={0.5} max={5} step={0.5}
              value={risk} onChange={e => setRisk(Number(e.target.value))}
              className={styles.slider} aria-valuetext={`${risk}% risk per trade`} />
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Data & Storage</h2>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="cleanup">Cleanup Interval (days)</label>
            <input id="cleanup" className={styles.input} type="number"
              min={7} max={365} value={cleanup} onChange={e => setCleanup(Number(e.target.value))} />
            <p className={styles.hint}>Predictions older than this will be archived during cleanup.</p>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Account</h2>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Username</span>
            <span className={styles.infoValue}>{user?.username}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Role</span>
            <span className={styles.infoValue}>{user?.role}</span>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Learning & Tooltips</h2>
          <p className={styles.hint}>Control the ⓘ info icons that appear throughout the app.</p>

          <div className={styles.field}>
            <label className={styles.checkLabel}>
              <input type="checkbox" checked={infoTooltips}
                onChange={e => setInfoTooltips(e.target.checked)}
                className={styles.checkbox} />
              Show info tooltips globally
            </label>
          </div>

          {infoTooltips && (
            <div className={styles.field}>
              <label className={styles.checkLabel}>
                <input type="checkbox" checked={showExamples}
                  onChange={e => setShowExamples(e.target.checked)}
                  className={styles.checkbox} />
                Show examples inside tooltips
              </label>
            </div>
          )}

          {infoTooltips && (
            <div className={styles.field}>
              <label className={styles.label}>Per-page tooltip control</label>
              <div className={styles.pageTooltipGrid}>
                {['dashboard','predictions','backtest','strategies','history','favourites','settings'].map(page => (
                  <label key={page} className={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={pageTooltips[page] !== false}
                      onChange={e => setPageTooltips(page, e.target.checked)}
                      className={styles.checkbox}
                    />
                    {page.charAt(0).toUpperCase() + page.slice(1)}
                  </label>
                ))}
              </div>
            </div>
          )}
        </section>

        {error && <div className={styles.error} role="alert">{error}</div>}
        {saved && <div className={styles.success} role="status">Settings saved ✓</div>}

        <button className={styles.saveBtn} type="submit" disabled={loading}>
          {loading ? 'Saving…' : 'Save Settings'}
        </button>
      </form>

      {/* ── AI Growth Worker ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>🧬 AI Background Growth Worker</h2>
        <p className={styles.hint}>
          Runs in the background — even when the app is out of focus. Continuously collects market data,
          evaluates strategy accuracy, and proposes algorithm upgrades to improve prediction quality over time.
        </p>

        <div className={styles.workerStatus}>
          <div className={styles.workerIndicator}>
            <span
              className={`${styles.workerDot} ${workerStatus?.running && !workerStatus?.paused ? styles.workerDotActive : styles.workerDotIdle}`}
              aria-hidden="true"
            />
            <span className={styles.workerLabel}>
              {workerStatus == null
                ? 'Checking…'
                : workerStatus.running && !workerStatus.paused
                  ? 'Running'
                  : workerStatus.paused
                    ? 'Paused'
                    : 'Stopped'}
            </span>
          </div>
          {workerStatus?.cycleCount > 0 && (
            <span className={styles.hint}>
              {workerStatus.cycleCount} cycle{workerStatus.cycleCount !== 1 ? 's' : ''} completed
              {workerStatus.lastCycleAt && ` · last ${new Date(workerStatus.lastCycleAt).toLocaleTimeString()}`}
            </span>
          )}
          {workerStatus?.lastError && (
            <span className={styles.workerError}>⚠ {workerStatus.lastError}</span>
          )}
        </div>

        <div className={styles.workerActions}>
          <button
            type="button"
            className={`${styles.workerBtn} ${workerStatus?.running ? styles.workerBtnStop : styles.workerBtnStart}`}
            onClick={toggleWorker}
            disabled={workerLoading || workerStatus == null}
          >
            {workerLoading
              ? '…'
              : workerStatus?.running
                ? '⏹ Stop Worker'
                : '▶ Start Worker'}
          </button>
          {workerStatus?.running && !workerStatus?.paused && (
            <button
              type="button"
              className={styles.workerBtnPause}
              onClick={() => apiFetch('/api/growth-worker/pause', { method: 'POST' }).then(() => setWorkerStatus(s => ({ ...s, paused: true })))}
            >
              ⏸ Pause
            </button>
          )}
          {workerStatus?.running && workerStatus?.paused && (
            <button
              type="button"
              className={styles.workerBtnStart}
              onClick={() => apiFetch('/api/growth-worker/resume', { method: 'POST' }).then(() => setWorkerStatus(s => ({ ...s, paused: false })))}
            >
              ▶ Resume
            </button>
          )}
        </div>

        {workerStatus?.proposalsPending > 0 && (
          <div className={styles.proposalsBadge}>
            🔔 {workerStatus.proposalsPending} upgrade proposal{workerStatus.proposalsPending !== 1 ? 's' : ''} pending review
          </div>
        )}

        {proposals.length > 0 && (
          <div className={styles.proposalsList}>
            <p className={styles.label}>Recent upgrade proposals</p>
            {proposals.map(p => (
              <div key={p.id} className={`${styles.proposal} ${p.status !== 'pending' ? styles.proposalResolved : ''}`}>
                <div className={styles.proposalHead}>
                  <span className={`${styles.proposalPriority} ${p.priority === 'high' ? styles.proposalHigh : styles.proposalMed}`}>
                    {p.priority === 'high' ? '🔴' : '🟡'} {p.priority}
                  </span>
                  <span className={styles.proposalSymbol}>{p.symbol}</span>
                  <span className={styles.hint}>{p.accuracyPct != null ? `${p.accuracyPct}% accuracy` : ''}</span>
                </div>
                <p className={styles.proposalText}>{p.suggestion}</p>
                {p.status === 'pending' && (
                  <div className={styles.proposalActions}>
                    <button type="button" className={styles.proposalApprove} onClick={() => handleProposalAction(p.id, 'approve')}>✓ Approve</button>
                    <button type="button" className={styles.proposalDismiss} onClick={() => handleProposalAction(p.id, 'dismiss')}>✗ Dismiss</button>
                  </div>
                )}
                {p.status !== 'pending' && (
                  <span className={styles.proposalStatusBadge}>{p.status === 'approved' ? '✓ Approved' : '✗ Dismissed'}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Ghost Mode — super-admin only */}
      {isSuperAdmin && (        <section className={`${styles.section} ${styles.dangerZone}`}>
          <h2 className={styles.dangerTitle}>👻 Ghost Mode</h2>
          <p className={styles.dangerDesc}>
            Zero-trace wipe of all app data from this device. Clears localStorage, sessionStorage,
            IndexedDB, service workers, caches, cookies, and all encrypted server-side data.
            Use when you need to leave no trace on this device.
          </p>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => setShowGhostConfirm(true)}
          >
            👻 Activate Ghost Mode
          </button>
        </section>
      )}
    </div>
  )
}
