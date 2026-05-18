/**
 * ChangePasswordModal — self-service password change.
 *
 * Used in two contexts:
 *   1. Voluntary change from Settings
 *   2. Forced change on first login (mustChangePassword = true)
 *
 * Shows real-time password strength indicator.
 */

import { useState, useEffect, useRef } from 'react'
import { useAuthStore } from '@store/authStore.js'
import { changePasswordApi } from '@services/backendClient.js'
import styles from './ChangePasswordModal.module.css'

// ── Password strength checker ─────────────────────────────────────────────────

function checkStrength(pw) {
  const checks = {
    length:    pw.length >= 8,
    uppercase: /[A-Z]/.test(pw),
    number:    /[0-9]/.test(pw),
    special:   /[^A-Za-z0-9]/.test(pw),
  }
  const score = Object.values(checks).filter(Boolean).length
  return { checks, score, label: score <= 1 ? 'Weak' : score === 2 ? 'Fair' : score === 3 ? 'Good' : 'Strong' }
}

export function ChangePasswordModal({ onClose, forced = false }) {
  const user = useAuthStore(s => s.user)

  const [current,  setCurrent]  = useState('')
  const [newPw,    setNewPw]    = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [showCurr, setShowCurr] = useState(false)
  const [showNew,  setShowNew]  = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState(false)

  const firstRef = useRef(null)
  const strength = checkStrength(newPw)
  const mismatch = confirm && newPw !== confirm

  useEffect(() => { firstRef.current?.focus() }, [])

  useEffect(() => {
    if (forced) return  // don't allow escape on forced change
    function handler(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [forced, onClose])

  async function handleSubmit(e) {
    e.preventDefault()
    if (newPw !== confirm) { setError('Passwords do not match'); return }
    if (strength.score < 4) { setError('Password does not meet all requirements'); return }

    setLoading(true)
    setError('')

    try {
      const data = await changePasswordApi(current, newPw)
      if (data.error) { setError(data.error); return }
      setSuccess(true)
      setTimeout(() => onClose(true), 2000)  // pass true = re-login needed
    } catch (err) {
      setError(err?.message ?? 'Failed to change password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true"
      aria-label={forced ? 'Set new password' : 'Change password'}>
      <div className={styles.modal}>
        {/* ── Header ── */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.headerIcon}>{forced ? '🔒' : '🔑'}</span>
            <div>
              <h2 className={styles.title}>
                {forced ? 'Set Your Password' : 'Change Password'}
              </h2>
              {forced && (
                <p className={styles.forcedNote}>
                  Your account requires a password change before continuing.
                </p>
              )}
            </div>
          </div>
          {!forced && (
            <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
          )}
        </div>

        {success ? (
          <div className={styles.successState}>
            <span className={styles.successIcon}>✓</span>
            <p>Password changed successfully.</p>
            <p className={styles.successNote}>You will be redirected to log in again.</p>
          </div>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            {error && <div className={styles.error} role="alert">{error}</div>}

            {/* Current password */}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="cp-current">
                {forced ? 'Temporary password' : 'Current password'}
              </label>
              <div className={styles.inputWrap}>
                <input
                  ref={firstRef}
                  id="cp-current"
                  type={showCurr ? 'text' : 'password'}
                  className={styles.input}
                  value={current}
                  onChange={e => setCurrent(e.target.value)}
                  autoComplete="current-password"
                  disabled={loading}
                  required
                />
                <button type="button" className={styles.eyeBtn}
                  onClick={() => setShowCurr(s => !s)}
                  aria-label={showCurr ? 'Hide password' : 'Show password'}>
                  {showCurr ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            {/* New password */}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="cp-new">New password</label>
              <div className={styles.inputWrap}>
                <input
                  id="cp-new"
                  type={showNew ? 'text' : 'password'}
                  className={styles.input}
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  autoComplete="new-password"
                  disabled={loading}
                  required
                />
                <button type="button" className={styles.eyeBtn}
                  onClick={() => setShowNew(s => !s)}
                  aria-label={showNew ? 'Hide password' : 'Show password'}>
                  {showNew ? '🙈' : '👁'}
                </button>
              </div>

              {/* Strength indicator */}
              {newPw && (
                <div className={styles.strength}>
                  <div className={styles.strengthBar}>
                    {[1,2,3,4].map(i => (
                      <div key={i} className={`${styles.strengthSegment} ${strength.score >= i ? styles[`seg${strength.label}`] : ''}`} />
                    ))}
                  </div>
                  <span className={`${styles.strengthLabel} ${styles[`lbl${strength.label}`]}`}>
                    {strength.label}
                  </span>
                </div>
              )}

              {/* Requirements checklist */}
              <ul className={styles.requirements}>
                <Req met={strength.checks.length}    text="At least 8 characters" />
                <Req met={strength.checks.uppercase} text="One uppercase letter (A–Z)" />
                <Req met={strength.checks.number}    text="One number (0–9)" />
                <Req met={strength.checks.special}   text="One special character (!@#$%^&*)" />
              </ul>
            </div>

            {/* Confirm */}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="cp-confirm">Confirm new password</label>
              <input
                id="cp-confirm"
                type="password"
                className={`${styles.input} ${mismatch ? styles.inputError : ''}`}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                autoComplete="new-password"
                disabled={loading}
                required
              />
              {mismatch && <span className={styles.mismatch}>Passwords do not match</span>}
            </div>

            <div className={styles.actions}>
              {!forced && (
                <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={loading}>
                  Cancel
                </button>
              )}
              <button
                type="submit"
                className={styles.submitBtn}
                disabled={loading || !current || strength.score < 4 || newPw !== confirm}
              >
                {loading ? <><span className={styles.spinner} /> Changing…</> : 'Change Password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function Req({ met, text }) {
  return (
    <li className={`${styles.req} ${met ? styles.reqMet : styles.reqUnmet}`}>
      <span aria-hidden="true">{met ? '✓' : '○'}</span>
      {text}
    </li>
  )
}
