/**
 * SuperadminUnlockPage.jsx
 *
 * Hidden page — only visible at /superadmin-unlock
 * Not linked from anywhere in the UI.
 *
 * Flow:
 *   1. You visit http://localhost:4098/superadmin-unlock
 *   2. Type your passphrase (only you know it)
 *   3. App verifies against admin.vault HMAC
 *   4. Your super-admin account is created on this system
 *   5. A 24h access key is shown once — use it at the login screen
 */

import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '@services/apiClient.js'
import styles from './SuperadminUnlockPage.module.css'

export default function SuperadminUnlockPage() {
  const navigate     = useNavigate()
  const inputRef     = useRef(null)

  const [passphrase, setPassphrase] = useState('')
  const [showPass,   setShowPass]   = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [status,     setStatus]     = useState(null)  // vault-status response
  const [result,     setResult]     = useState(null)  // unlock response
  const [error,      setError]      = useState(null)
  const [copied,     setCopied]     = useState(false)

  // Load vault status on mount
  useEffect(() => {
    apiFetch('/api/superadmin/vault-status')
      .then(r => r.json())
      .then(d => setStatus(d))
      .catch(() => setStatus({ vaultExists: false }))
    inputRef.current?.focus()
  }, [])

  async function handleUnlock(e) {
    e.preventDefault()
    if (!passphrase.trim()) return
    setLoading(true); setError(null); setResult(null)
    try {
      const r = await apiFetch('/api/superadmin/unlock', {
        method: 'POST',
        body:   JSON.stringify({ passphrase }),
      })
      const data = await r.json()
      if (!data.ok) throw new Error(data.error ?? 'Unlock failed')
      setResult(data)
      setPassphrase('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function copyKey() {
    if (!result?.key) return
    navigator.clipboard.writeText(result.key).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 3000)
    })
  }

  function goToLogin() {
    navigate('/login')
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.lockIcon} aria-hidden="true">🔐</div>
          <h1 className={styles.title}>Superadmin Unlock</h1>
          <p className={styles.subtitle}>Personal access — for the app owner only</p>
        </div>

        {/* Vault status */}
        {status && (
          <div className={`${styles.vaultStatus} ${status.vaultExists ? styles.vaultOk : styles.vaultMissing}`}>
            {status.vaultExists ? (
              <>
                <span className={styles.vaultDot}>●</span>
                Vault present · account: <strong>{status.hint}</strong>
              </>
            ) : (
              <>
                <span className={styles.vaultDotMissing}>●</span>
                No vault found on this system.
                <br />
                <span className={styles.vaultSetupHint}>
                  Run: <code>node server/scripts/setupSuperAdmin.js</code>
                  <br />
                  Then copy <code>server/config/admin.vault</code> with the app.
                </span>
              </>
            )}
          </div>
        )}

        {/* Unlock form */}
        {!result && status?.vaultExists && (
          <form onSubmit={handleUnlock} className={styles.form} noValidate>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="passphrase">
                Your passphrase
              </label>
              <div className={styles.inputWrap}>
                <input
                  id="passphrase"
                  ref={inputRef}
                  className={styles.input}
                  type={showPass ? 'text' : 'password'}
                  value={passphrase}
                  onChange={e => setPassphrase(e.target.value)}
                  placeholder="Enter your superadmin passphrase"
                  autoComplete="off"
                  disabled={loading}
                  required
                />
                <button
                  type="button"
                  className={styles.eyeBtn}
                  onMouseDown={() => setShowPass(true)}
                  onMouseUp={() => setShowPass(false)}
                  onMouseLeave={() => setShowPass(false)}
                  aria-label="Hold to reveal"
                  tabIndex={-1}
                >
                  {showPass ? '🙈' : '👁'}
                </button>
              </div>
              <p className={styles.hint}>
                This passphrase is never stored. It only exists in your memory.
              </p>
            </div>

            {error && (
              <div className={styles.error} role="alert">
                ✗ {error}
              </div>
            )}

            <button
              className={styles.btn}
              type="submit"
              disabled={loading || !passphrase.trim()}
            >
              {loading ? 'Verifying…' : 'Unlock Super-Admin →'}
            </button>
          </form>
        )}

        {/* Success — show key */}
        {result && (
          <div className={styles.success}>
            <div className={styles.successIcon}>✓</div>
            <p className={styles.successMsg}>{result.message}</p>

            <div className={styles.keySection}>
              <div className={styles.keyLabel}>Your 12-digit access key</div>
              <div className={styles.keyDisplay}>
                <span className={styles.keyValue}>{result.key}</span>
                <button
                  className={`${styles.copyBtn} ${copied ? styles.copyBtnDone : ''}`}
                  onClick={copyKey}
                  type="button"
                >
                  {copied ? '✓ Copied' : '⎘ Copy'}
                </button>
              </div>
              <div className={styles.keyNote}>{result.note}</div>
              <div className={styles.keyWarning}>⚠ {result.warning}</div>
            </div>

            <button className={styles.loginBtn} onClick={goToLogin} type="button">
              Go to Login →
            </button>

            <div className={styles.loginSteps}>
              <strong>Steps:</strong>
              <ol>
                <li>Click "Go to Login"</li>
                <li>Enter username: <code>{result.username}</code></li>
                <li>Enter your app password</li>
                <li>At Step 2 — paste the key above</li>
              </ol>
            </div>
          </div>
        )}

        {/* No vault + no setup */}
        {status && !status.vaultExists && (
          <div className={styles.noVault}>
            <p>To set up your superadmin vault:</p>
            <ol className={styles.setupSteps}>
              <li>On your own machine, run:<br /><code>node server/scripts/setupSuperAdmin.js</code></li>
              <li>Choose a passphrase (memorize it — never stored)</li>
              <li>The script creates <code>server/config/admin.vault</code></li>
              <li>Copy <code>admin.vault</code> with the app to any system</li>
              <li>Visit this page and enter your passphrase</li>
            </ol>
          </div>
        )}

        <div className={styles.footer}>
          <button className={styles.backLink} onClick={() => navigate('/login')} type="button">
            ← Back to Login
          </button>
          <span className={styles.secureNote}>🔒 3 attempts per 15 min · Never stored</span>
        </div>
      </div>
    </div>
  )
}
