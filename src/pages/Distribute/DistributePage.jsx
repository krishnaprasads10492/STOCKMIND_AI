/**
 * DistributePage — App clone creator for platform owner distribution.
 * Super-admin only. Creates a configured ZIP copy of the app.
 */
import { useState, useEffect } from 'react'
import { useAuthStore } from '@store/authStore.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import { apiFetch } from '@services/apiClient.js'
import styles from './DistributePage.module.css'

const JURISDICTIONS = [
  { value: 'IN', label: '🇮🇳 India (SEBI)' },
  { value: 'US', label: '🇺🇸 United States (SEC)' },
  { value: 'EU', label: '🇪🇺 European Union (ESMA)' },
]

function PasswordStrength({ password }) {
  if (!password) return null
  const checks = [
    { ok: password.length >= 8,           label: '8+ chars' },
    { ok: /[A-Z]/.test(password),         label: 'Uppercase' },
    { ok: /[0-9]/.test(password),         label: 'Number' },
    { ok: /[^A-Za-z0-9]/.test(password),  label: 'Special' },
  ]
  const score = checks.filter(c => c.ok).length
  const color = score <= 1 ? '#ff2d5f' : score <= 2 ? '#ffb700' : score === 3 ? '#ffb700' : '#00ff9d'
  return (
    <div className={styles.strength}>
      <div className={styles.strengthBar}>
        {[1,2,3,4].map(i => (
          <div key={i} className={styles.strengthSegment}
            style={{ background: i <= score ? color : 'rgba(255,255,255,0.08)' }} />
        ))}
      </div>
      <div className={styles.strengthChecks}>
        {checks.map(c => (
          <span key={c.label} className={c.ok ? styles.checkOk : styles.checkNo}>
            {c.ok ? '✓' : '○'} {c.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function DistributePage() {
  const token = useAuthStore(s => s.token)
  const user  = useAuthStore(s => s.user)

  const [status,     setStatus]     = useState(null)
  const [username,   setUsername]   = useState('')
  const [password,   setPassword]   = useState('')
  const [showPass,   setShowPass]   = useState(false)
  const [label,      setLabel]      = useState('StockMind AI')
  const [juris,      setJuris]      = useState('IN')
  const [includeAI,  setIncludeAI]  = useState(false)
  const [building,   setBuilding]   = useState(false)
  const [error,      setError]      = useState('')
  const [success,    setSuccess]    = useState('')

  useEffect(() => {
    if (!token) return
    apiFetch('/api/distribute/status')
      .then(setStatus)
      .catch(() => setStatus({ ok: false }))
  }, [token])

  // Guard — super-admin only
  if (user?.role !== 'super-admin') {
    return (
      <div className={styles.denied}>
        <span className={styles.deniedIcon}>🔒</span>
        <h2>Super-admin access required</h2>
        <p>Only the platform owner can create distribution copies.</p>
      </div>
    )
  }

  const isFormValid =
    username.trim().length >= 4 &&
    /^[a-zA-Z0-9_.-]+$/.test(username) &&
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)

  async function handleBuild(e) {
    e.preventDefault()
    if (!isFormValid || building) return
    setError('')
    setSuccess('')
    setBuilding(true)

    try {
      const res = await fetch('/api/distribute/build', {
        method:  'POST',
        headers: {
          'Content-Type':   'application/json',
          'x-session-token': token,
        },
        body: JSON.stringify({
          adminUsername:   username.trim(),
          adminPassword:   password,
          label:           label.trim() || 'StockMind AI',
          jurisdiction:    juris,
          includeAIBackend: includeAI,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Build failed (${res.status})`)
      }

      // Trigger browser download
      const blob     = await res.blob()
      const url      = URL.createObjectURL(blob)
      const a        = document.createElement('a')
      const filename = res.headers.get('Content-Disposition')
        ?.match(/filename="?([^"]+)"?/)?.[1]
        ?? `stockmind-ai-${Date.now()}.zip`
      a.href     = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setSuccess(`✓ Distribution copy created and downloaded — ${filename}`)
      setUsername('')
      setPassword('')
    } catch (err) {
      setError(err.message ?? 'Build failed')
    } finally {
      setBuilding(false)
    }
  }

  return (
    <div className={styles.page}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.titleRow}>
            <span className={styles.titleIcon}>📦</span>
            <div>
              <h1 className={styles.title}>Distribute</h1>
              <p className={styles.subtitle}>Create a configured copy of the app for another user</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── System status ── */}
      {status && (
        <div className={styles.statusBar}>
          <StatusNode label="Node" value={status.nodeVersion ?? '—'} ok={!!status.nodeVersion} />
          <StatusNode label="Platform" value={status.platform ?? '—'} ok />
          <StatusNode label="Disk Free" value={status.diskFreeMB ? `${status.diskFreeMB} MB` : '—'} ok={status.diskOk !== false} />
          <StatusNode label="ZIP Tool" value={status.zipSupport ? 'Ready' : 'Missing'} ok={status.zipSupport} />
        </div>
      )}

      {status?.zipSupport === false && (
        <div className={styles.warning}>
          <strong>⚠ ZIP tool not found.</strong>{' '}
          {process.platform === 'win32'
            ? 'PowerShell Compress-Archive is required (comes with Windows 10+).'
            : 'Install zip: sudo apt install zip  or  brew install zip'}
        </div>
      )}

      <div className={styles.layout}>
        {/* ── Build form ── */}
        <div className={styles.formCard}>
          <div className={styles.cardHeader}>
            <span className={styles.cardIcon}>⚙</span>
            <span className={styles.cardTitle}>Configure Distribution Copy</span>
          </div>

          {error   && <div className={styles.error}   role="alert">{error}</div>}
          {success && <div className={styles.success} role="status">{success}</div>}

          <form onSubmit={handleBuild} className={styles.form} noValidate>

            {/* App label */}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="dist-label">
                App Label <span className={styles.hint}>(shown to recipient in README)</span>
              </label>
              <input
                id="dist-label"
                className={styles.input}
                type="text"
                value={label}
                onChange={e => setLabel(e.target.value)}
                maxLength={60}
                placeholder="StockMind AI"
                disabled={building}
              />
            </div>

            {/* Jurisdiction */}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="dist-juris">Jurisdiction</label>
              <select
                id="dist-juris"
                className={styles.select}
                value={juris}
                onChange={e => setJuris(e.target.value)}
                disabled={building}
              >
                {JURISDICTIONS.map(j => (
                  <option key={j.value} value={j.value}>{j.label}</option>
                ))}
              </select>
            </div>

            <div className={styles.divider}>
              <span className={styles.dividerLabel}>Recipient Admin Account</span>
            </div>

            {/* Admin username */}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="dist-user">
                Username <span className={styles.hint}>(letters, numbers, _ . - only)</span>
              </label>
              <input
                id="dist-user"
                className={styles.input}
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value.replace(/\s/g, ''))}
                minLength={4}
                maxLength={32}
                placeholder="e.g. john.doe"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="none"
                disabled={building}
              />
            </div>

            {/* Admin password */}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="dist-pass">
                Password <span className={styles.hint}>(share this securely with the recipient)</span>
              </label>
              <div className={styles.passWrap}>
                <input
                  id="dist-pass"
                  className={styles.input}
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  minLength={8}
                  maxLength={64}
                  placeholder="Min 8 chars, uppercase, number, special"
                  autoComplete="new-password"
                  disabled={building}
                />
                <button
                  type="button"
                  className={styles.eyeBtn}
                  onClick={() => setShowPass(s => !s)}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                >
                  {showPass ? '🙈' : '👁'}
                </button>
              </div>
              <PasswordStrength password={password} />
            </div>

            {/* Options */}
            <div className={styles.options}>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={includeAI}
                  onChange={e => setIncludeAI(e.target.checked)}
                  disabled={building}
                />
                <span>Include Python AI backend (<code>ai_backend/</code>)</span>
                <span className={styles.optHint}>Adds ~50MB. Recipient needs Python 3.10+ to use it.</span>
              </label>
            </div>

            <button
              type="submit"
              className={styles.buildBtn}
              disabled={!isFormValid || building || status?.zipSupport === false}
              aria-busy={building}
            >
              {building ? (
                <><span className={styles.spinner} /> Building — this may take 30–60s…</>
              ) : (
                <>📦 Build &amp; Download ZIP</>
              )}
            </button>
          </form>
        </div>

        {/* ── Info panel ── */}
        <div className={styles.infoPanel}>
          <div className={styles.cardHeader}>
            <span className={styles.cardIcon}>ℹ</span>
            <span className={styles.cardTitle}>What's included in each copy</span>
          </div>
          <ul className={styles.infoList}>
            <InfoItem icon="✓" text="Full application source code" color="bull" />
            <InfoItem icon="✓" text="Recipient's admin account pre-configured" color="bull" />
            <InfoItem icon="✓" text="Correct jurisdiction/disclaimer set" color="bull" />
            <InfoItem icon="✓" text="Getting Started guide for recipient" color="bull" />
            <InfoItem icon="✓" text="Master access bundle (always present, hidden)" color="ai" />
            <InfoItem icon="✗" text="Your .env file — excluded for security" color="bear" />
            <InfoItem icon="✗" text="Your data/ folder — excluded" color="bear" />
            <InfoItem icon="✗" text="node_modules — recipient installs fresh" color="bear" />
          </ul>

          <div className={styles.masterNote}>
            <span className={styles.masterNoteIcon}>🔐</span>
            <div>
              <strong>Master access</strong>
              <p>Every copy carries an encrypted credential bundle that grants you super-admin access to any distributed copy, regardless of what other users do. This is embedded at the binary level and cannot be found or removed through normal inspection.</p>
            </div>
          </div>

          <div className={styles.infoSteps}>
            <h3 className={styles.stepsTitle}>Recipient setup steps</h3>
            <ol className={styles.stepsList}>
              <li>Unzip the downloaded file</li>
              <li>Install Node.js v18+ if not already installed</li>
              <li>Run <code>node start.js --dev</code></li>
              <li>Open <code>http://localhost:4099</code></li>
              <li>Log in with the admin credentials you set here</li>
              <li>Generate a key: <code>npm run keygen &lt;username&gt;</code></li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusNode({ label, value, ok }) {
  return (
    <div className={`${styles.statusNode} ${ok ? styles.statusOk : styles.statusWarn}`}>
      <span className={styles.statusDot} />
      <span className={styles.statusLabel}>{label}</span>
      <span className={styles.statusValue}>{value}</span>
    </div>
  )
}

function InfoItem({ icon, text, color }) {
  const colorMap = { bull: '#00ff9d', bear: '#ff2d5f', ai: '#a855f7' }
  return (
    <li className={styles.infoItem}>
      <span style={{ color: colorMap[color] }}>{icon}</span>
      <span>{text}</span>
    </li>
  )
}
