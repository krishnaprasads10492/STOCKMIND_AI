/**
 * KeygenModal — In-app 12-digit access key generator.
 *
 * Security:
 *   - Password re-auth before any key is generated
 *   - Key shown only once, never stored in component state after dismiss
 *   - Auto-clears after 60 seconds
 *   - Masked by default; click "Show" to toggle reveal (not hold-to-peek)
 *   - Copy button copies to clipboard AND reveals so user can verify
 *   - Key text is selectable when revealed for manual copy fallback
 */

import { useState, useEffect, useRef } from 'react'
import { useAuthStore } from '@store/authStore.js'
import { generateKeyApi } from '@services/backendClient.js'
import styles from './KeygenModal.module.css'

export function KeygenModal({ onClose }) {
  const user = useAuthStore(s => s.user)

  const [step,      setStep]      = useState('auth')  // 'auth' | 'result'
  const [password,  setPassword]  = useState('')
  const [daysValid, setDaysValid] = useState(30)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [keyResult, setKeyResult] = useState(null)    // { key, expiresAt }
  const [revealed,  setRevealed]  = useState(false)   // click-toggle, not hold
  const [copied,    setCopied]    = useState(false)
  const [countdown, setCountdown] = useState(60)
  const [showPw,    setShowPw]    = useState(false)

  const passwordRef = useRef(null)
  const timerRef    = useRef(null)

  useEffect(() => { passwordRef.current?.focus() }, [])

  useEffect(() => {
    function handler(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    if (step !== 'result') return
    timerRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(timerRef.current); onClose(); return 0 }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [step, onClose])

  async function handleGenerate(e) {
    e.preventDefault()
    if (!password) { setError('Password required'); return }
    setLoading(true); setError('')
    try {
      const data = await generateKeyApi(password, daysValid)
      if (data.error) { setError(data.error); return }
      setKeyResult(data)
      setStep('result')
      setPassword('')
      setRevealed(false)
    } catch (err) {
      setError(err?.message ?? 'Failed to generate key')
    } finally {
      setLoading(false)
    }
  }

  function handleCopy() {
    if (!keyResult?.key) return
    navigator.clipboard.writeText(keyResult.key)
      .then(() => {
        setCopied(true)
        setRevealed(true)   // reveal so user can visually confirm what was copied
        setTimeout(() => setCopied(false), 2500)
      })
      .catch(() => {
        // Clipboard blocked — reveal so user can select-copy manually
        setRevealed(true)
      })
  }

  const maskedKey = keyResult?.key ? keyResult.key.replace(/\d/g, '•') : ''

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Generate Access Key">
      <div className={styles.modal}>

        {/* ── Header ── */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.headerIcon}>🔑</span>
            <div>
              <h2 className={styles.title}>Generate Access Key</h2>
              <p className={styles.subtitle}>For: <strong>{user?.username}</strong></p>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        {/* ── Step: Auth ── */}
        {step === 'auth' && (
          <form className={styles.form} onSubmit={handleGenerate} noValidate>
            <div className={styles.infoBox}>
              <span>ℹ</span>
              <p>
                A new 12-digit key will be generated for your account.
                Your current key will be <strong>invalidated</strong>.
                Enter your password to confirm.
              </p>
            </div>

            {error && <div className={styles.error} role="alert">{error}</div>}

            <div className={styles.field}>
              <label className={styles.label} htmlFor="kg-password">Confirm your password</label>
              <div className={styles.inputWrap}>
                <input
                  ref={passwordRef}
                  id="kg-password"
                  type={showPw ? 'text' : 'password'}
                  className={styles.input}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={loading}
                  required
                />
                <button
                  type="button"
                  className={styles.eyeBtn}
                  onClick={() => setShowPw(s => !s)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPw ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="kg-days">Key validity</label>
              <select
                id="kg-days"
                className={styles.select}
                value={daysValid}
                onChange={e => setDaysValid(Number(e.target.value))}
                disabled={loading}
              >
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
                <option value={365}>1 year</option>
              </select>
            </div>

            <div className={styles.actions}>
              <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={loading}>
                Cancel
              </button>
              <button type="submit" className={styles.generateBtn} disabled={loading || !password}>
                {loading ? <><span className={styles.spinner} /> Generating…</> : '⚡ Generate Key'}
              </button>
            </div>
          </form>
        )}

        {/* ── Step: Result ── */}
        {step === 'result' && keyResult && (
          <div className={styles.result}>
            <div className={styles.successBanner}>
              <span>✓</span>
              <div>
                <strong>Key generated successfully</strong>
                <p>This key will not be shown again. Save it now.</p>
              </div>
            </div>

            <div className={styles.keyDisplay}>
              {/* Key value — selectable text when revealed */}
              <div
                className={`${styles.keyValue} ${revealed ? styles.keyValueRevealed : ''}`}
                style={{ userSelect: revealed ? 'text' : 'none' }}
                aria-label={revealed ? `Your key: ${keyResult.key}` : 'Key is masked — click Show to reveal'}
              >
                {revealed ? keyResult.key : maskedKey}
              </div>

              <div className={styles.keyActions}>
                {/* Click-toggle reveal — not hold */}
                <button
                  type="button"
                  className={`${styles.revealBtn} ${revealed ? styles.revealBtnActive : ''}`}
                  onClick={() => setRevealed(r => !r)}
                  aria-label={revealed ? 'Hide key' : 'Show key'}
                  aria-pressed={revealed}
                >
                  {revealed ? '🙈 Hide' : '👁 Show'}
                </button>

                {/* Copy — also reveals and confirms */}
                <button
                  type="button"
                  className={`${styles.copyBtn} ${copied ? styles.copyBtnDone : ''}`}
                  onClick={handleCopy}
                  aria-label="Copy key to clipboard"
                >
                  {copied ? '✓ Copied!' : '⎘ Copy'}
                </button>
              </div>

              {revealed && (
                <p className={styles.selectHint}>
                  Key visible — select text above to copy manually if needed
                </p>
              )}
            </div>

            <div className={styles.keyMeta}>
              <span>Expires: <strong>
                {new Date(keyResult.expiresAt).toLocaleDateString('en-IN', {
                  day: '2-digit', month: 'short', year: 'numeric',
                })}
              </strong></span>
              <span className={styles.countdown}>Auto-closes in {countdown}s</span>
            </div>

            <div className={styles.warningBox}>
              <span>⚠</span>
              <p>Your previous key has been invalidated. Use this key on your next login (Step 2).</p>
            </div>

            <button type="button" className={styles.doneBtn} onClick={onClose}>
              Done — I've saved my key
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
