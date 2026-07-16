import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@store/authStore.js'
import {
  loginStep1, loginStep2,
  generateKeyWithStepToken, generateKeyWithCredentials,
} from '@services/backendClient.js'
import { stripHtml } from '@utils/sanitize.js'
import styles from './LoginPage.module.css'

// ── Inline keygen panel ───────────────────────────────────────────────────────
// Handles two cases:
//   A) Has a valid stepToken (came through Step 1) → just pick validity + generate
//   B) No stepToken or expired → ask username + password inline, then generate
//
// On success: auto-fills the key input AND updates the stepToken if credentials
// were re-entered (so Step 2 login still works with the fresh token).
function InlineKeygenPanel({ stepToken, username: prefillUsername, onKeyGenerated, onClose, onStepTokenRefreshed }) {
  const hasToken = !!stepToken

  const [mode,       setMode]       = useState(hasToken ? 'generate' : 'credentials')
  const [credUser,   setCredUser]   = useState(prefillUsername ?? '')
  const [credPass,   setCredPass]   = useState('')
  const [showPass,   setShowPass]   = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [result,     setResult]     = useState(null)
  const [revealed,   setRevealed]   = useState(false)
  const [copied,     setCopied]     = useState(false)
  const [countdown,  setCountdown]  = useState(60)
  const timerRef    = useRef(null)
  const userInputRef = useRef(null)

  // Key validity is fixed at 7 days — no user choice
  const DAYS_VALID = 7

  // Auto-focus username field when in credentials mode
  useEffect(() => {
    if (mode === 'credentials') userInputRef.current?.focus()
  }, [mode])

  // Auto-clear after 60s once key is shown
  useEffect(() => {
    if (!result) return
    timerRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(timerRef.current); onClose(); return 0 }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [result, onClose])

  async function handleGenerate() {
    setLoading(true)
    setError('')
    try {
      let data
      if (mode === 'generate' && stepToken) {
        // Case A: use existing stepToken — username already verified in Step 1
        data = await generateKeyWithStepToken(stepToken, DAYS_VALID)
      } else {
        // Case B: use credentials directly
        // Sanitize: strip whitespace, lowercase, remove any trailing dots/spaces
        const cleanUser = credUser.trim().toLowerCase().replace(/\s/g, '').replace(/\.+$/, '')
        if (!cleanUser) { setError('Username is required'); setLoading(false); return }
        if (!credPass)  { setError('Password is required'); setLoading(false); return }
        data = await generateKeyWithCredentials(cleanUser, credPass, DAYS_VALID)
        if (data.stepToken) onStepTokenRefreshed?.(data.stepToken)
      }

      if (data.error) { setError(data.error); return }
      setResult(data)
    } catch (err) {
      setError(err?.message ?? 'Failed to generate key — is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  function handleCopy() {
    if (!result?.key) return
    navigator.clipboard.writeText(result.key).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function handleUseKey() {
    if (result?.key) onKeyGenerated(result.key)
  }

  const displayUsername = result?.username ?? credUser ?? prefillUsername ?? '—'
  const masked = result?.key?.replace(/\d/g, '•') ?? ''

  return (
    <div className={styles.keygenPanel}>
      {/* ── Header ── */}
      <div className={styles.keygenPanelHeader}>
        <span className={styles.keygenPanelTitle}>🔑 Generate Access Key</span>
        <button type="button" className={styles.keygenPanelClose}
          onClick={onClose} aria-label="Close">×</button>
      </div>

      {/* ── Result view ── */}
      {result ? (
        <>
          <div className={styles.keygenSuccess}>
            <span>✓</span>
            <div>
              <strong>Key generated for {displayUsername}</strong>
              <p>Auto-fills below. Save it — shown once only.</p>
            </div>
            <span className={styles.keygenCountdown}>{countdown}s</span>
          </div>

          <div className={styles.keygenDisplay}>
            <span className={styles.keygenValue}>
              {revealed ? result.key : masked}
            </span>
            <div className={styles.keygenDisplayBtns}>
              <button type="button" className={styles.keygenRevealBtn}
                onMouseDown={() => setRevealed(true)} onMouseUp={() => setRevealed(false)}
                onMouseLeave={() => setRevealed(false)}
                onTouchStart={() => setRevealed(true)} onTouchEnd={() => setRevealed(false)}
                aria-label="Hold to reveal">
                {revealed ? '🙈' : '👁 Hold'}
              </button>
              <button type="button"
                className={`${styles.keygenCopyBtn} ${copied ? styles.keygenCopied : ''}`}
                onClick={handleCopy}>
                {copied ? '✓ Copied' : '⎘ Copy'}
              </button>
            </div>
          </div>

          <p className={styles.keygenExpiry}>
            Expires: {new Date(result.expiresAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
          </p>

          <button type="button" className={styles.keygenUseBtn} onClick={handleUseKey}>
            ↓ Use this key to log in
          </button>
        </>
      ) : (
        <>
          {/* ── Mode toggle (only show if we have a stepToken — otherwise credentials are mandatory) ── */}
          {hasToken && (
            <div className={styles.keygenModeTabs}>
              <button type="button"
                className={`${styles.keygenModeTab} ${mode === 'generate' ? styles.keygenModeTabActive : ''}`}
                onClick={() => { setMode('generate'); setError('') }}>
                Quick Generate
              </button>
              <button type="button"
                className={`${styles.keygenModeTab} ${mode === 'credentials' ? styles.keygenModeTabActive : ''}`}
                onClick={() => { setMode('credentials'); setError('') }}>
                Different Account
              </button>
            </div>
          )}

          {/* ── Credentials form (mode B) ── */}
          {mode === 'credentials' && (
            <div className={styles.keygenCredFields}>
              <p className={styles.keygenPanelDesc}>
                {hasToken
                  ? 'Enter credentials for a different account to generate its key.'
                  : 'Enter your username and password to generate your access key.'}
              </p>

              <div className={styles.keygenField}>
                <label className={styles.keygenFieldLabel} htmlFor="kg-user">Username</label>
                <input
                  ref={userInputRef}
                  id="kg-user"
                  type="text"
                  className={styles.keygenInput}
                  value={credUser}
                  onChange={e => setCredUser(e.target.value.replace(/\s/g, ''))}
                  placeholder="your username"
                  autoComplete="username"
                  disabled={loading}
                  maxLength={32}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>

              <div className={styles.keygenField}>
                <label className={styles.keygenFieldLabel} htmlFor="kg-pass">Password</label>
                <div className={styles.keygenPassWrap}>
                  <input
                    id="kg-pass"
                    type={showPass ? 'text' : 'password'}
                    className={styles.keygenInput}
                    value={credPass}
                    onChange={e => setCredPass(e.target.value)}
                    placeholder="your password"
                    autoComplete="current-password"
                    disabled={loading}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleGenerate() } }}
                  />
                  <button type="button" className={styles.keygenEyeBtn}
                    onClick={() => setShowPass(s => !s)}
                    aria-label={showPass ? 'Hide password' : 'Show password'}>
                    {showPass ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Quick generate info (mode A) ── */}
          {mode === 'generate' && (
            <p className={styles.keygenPanelDesc}>
              Generating key for <strong>{prefillUsername}</strong>.
              <span className={styles.keygenPanelWarn}>
                {' '}⚠ This replaces any existing key.
              </span>
            </p>
          )}

          {error && <div className={styles.keygenError} role="alert">{error}</div>}

          {/* ── Generate button (no validity selector — fixed 7 days) ── */}
          <div className={styles.keygenRow}>
            <span className={styles.keygenLabel}>Valid for 7 days</span>
            <button type="button" className={styles.keygenGenerateBtn}
              onClick={handleGenerate} disabled={loading}>
              {loading
                ? <><span className={styles.spinner} /> Generating…</>
                : '⚡ Generate Key'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Main login page ───────────────────────────────────────────────────────────

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const setSession = useAuthStore(s => s.setSession)

  const [step,         setStep]         = useState(1)
  const [stepToken,    setStepToken]    = useState('')
  const [username,     setUsername]     = useState('')
  const [password,     setPassword]     = useState('')
  const [key,          setKey]          = useState('')
  const [showKeygen,   setShowKeygen]   = useState(false)
  const [error,        setError]        = useState(
    searchParams.get('reason') === 'timeout'
      ? 'Session expired due to inactivity. Please log in again.'
      : ''
  )
  const [loading, setLoading] = useState(false)

  // Close keygen panel on Escape
  useEffect(() => {
    if (!showKeygen) return
    function handler(e) { if (e.key === 'Escape') setShowKeygen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [showKeygen])

  async function handleStep1(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await loginStep1(stripHtml(username).toLowerCase(), password)
      if (data.error) { setError(data.error); return }
      setStepToken(data.stepToken)
      setStep(2)
    } catch {
      setError('Could not reach server. Make sure the backend is running (node start.js --dev).')
    } finally {
      setLoading(false)
    }
  }

  async function handleStep2(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await loginStep2(stepToken, key)
      if (data.error) { setError(data.error); return }
      setSession(data.sessionToken, data.user)
      navigate('/dashboard', { replace: true })
    } catch {
      setError('Key verification failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyInput(e) {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 12)
    const parts  = [digits.slice(0, 4), digits.slice(4, 8), digits.slice(8, 12)].filter(Boolean)
    setKey(parts.join('-'))
  }

  // Called when user clicks "Use this key" in the keygen panel
  const handleKeyGenerated = useCallback((generatedKey) => {
    setKey(generatedKey)
    setShowKeygen(false)
  }, [])

  // Called when keygen panel does a fresh credential check and gets a new stepToken
  const handleStepTokenRefreshed = useCallback((newStepToken) => {
    setStepToken(newStepToken)
  }, [])

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {/* Animated HUD scan line */}
        <span className={styles.scanLine} aria-hidden="true" />
        {/* ── Logo + title ── */}
        <div className={styles.logoWrap}>
          <div className={styles.logoIcon} aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
              <polyline points="4,22 10,14 17,18 26,8"
                stroke="var(--color-accent)" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="21,8 26,8 26,13"
                stroke="var(--color-accent)" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="17" cy="18" r="3" fill="var(--color-ai)" />
            </svg>
          </div>
          <h1 className={styles.title}>
            StockMind <span className={styles.titleAI}>AI</span>
          </h1>
          <p className={styles.subtitle}>Market Intelligence Platform</p>
        </div>

        {/* ── Step badge ── */}
        <span className={styles.stepBadge}>
          {step === 1 ? 'Step 1 of 2 — Credentials' : 'Step 2 of 2 — Access Key'}
        </span>

        {/* ── Error ── */}
        {error && <div className={styles.error} role="alert">{error}</div>}

        {/* ── Step 1: username + password ── */}
        {step === 1 && (
          <form onSubmit={handleStep1} className={styles.form} noValidate>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="username">Username</label>
              <input
                id="username"
                className={styles.input}
                type="text"
                autoComplete="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required minLength={4} maxLength={32}
                disabled={loading}
                autoFocus
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="password">Password</label>
              <input
                id="password"
                className={styles.input}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required minLength={8}
                disabled={loading}
              />
            </div>

            <button
              className={styles.btn}
              type="submit"
              disabled={loading || !username || password.length < 8}
            >
              {loading ? 'Verifying…' : 'Continue →'}
            </button>
          </form>
        )}

        {/* ── Step 2: 12-digit key ── */}
        {step === 2 && (
          <form onSubmit={handleStep2} className={styles.form} noValidate>
            <div className={styles.fieldGroup}>

              {/* Label row with 🔑 ⓘ button */}
              <div className={styles.keyLabelRow}>
                <label className={styles.label} htmlFor="key">
                  Access Key
                  <span className={styles.keyHint}> (XXXX-XXXX-XXXX)</span>
                </label>
                <button
                  type="button"
                  className={`${styles.keygenTrigger} ${showKeygen ? styles.keygenTriggerActive : ''}`}
                  onClick={() => setShowKeygen(s => !s)}
                  aria-expanded={showKeygen}
                  aria-label="Generate or get your access key"
                  title="Don't have a key? Generate one here"
                >
                  🔑 <span className={styles.keygenTriggerLabel}>
                    {showKeygen ? 'Hide' : 'Get Key'}
                  </span>
                  <span className={styles.keygenTriggerIcon}>
                    {showKeygen ? '▲' : '▼'}
                  </span>
                </button>
              </div>

              {/* ── Inline keygen panel ── */}
              {showKeygen && (
                <InlineKeygenPanel
                  stepToken={stepToken}
                  username={username}
                  onKeyGenerated={handleKeyGenerated}
                  onStepTokenRefreshed={handleStepTokenRefreshed}
                  onClose={() => setShowKeygen(false)}
                />
              )}

              <input
                id="key"
                className={`${styles.input} ${styles.keyInput} ${key ? styles.keyInputFilled : ''}`}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={key}
                onChange={handleKeyInput}
                placeholder="0000-0000-0000"
                required
                disabled={loading}
                autoFocus={!showKeygen}
              />

              <p className={styles.keyHelp}>
                No key yet?
                <button
                  type="button"
                  className={styles.keyHelpLink}
                  onClick={() => setShowKeygen(s => !s)}
                >
                  Generate one above ↑
                </button>
                or ask your admin.
              </p>
            </div>

            <button
              className={styles.btn}
              type="submit"
              disabled={loading || key.replace(/-/g, '').length < 12}
            >
              {loading ? 'Verifying…' : 'Access Platform →'}
            </button>

            <button
              type="button"
              className={styles.backBtn}
              onClick={() => { setStep(1); setError(''); setKey(''); setShowKeygen(false) }}
            >
              ← Back to credentials
            </button>
          </form>
        )}

        {/* ── Step dots ── */}
        <div className={styles.stepIndicator} aria-label={`Step ${step} of 2`}>
          <span className={step >= 1 ? styles.stepActive : styles.stepDot} />
          <span className={step >= 2 ? styles.stepActive : styles.stepDot} />
        </div>

        <span className={styles.version}>v{import.meta.env.VITE_APP_VERSION ?? '0.1.0'}</span>
      </div>
    </div>
  )
}
