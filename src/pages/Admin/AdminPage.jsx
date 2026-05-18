/**
 * AdminPage — Full user management for admins.
 *
 * Features:
 *   - List all users with status, last login, key status
 *   - Add user (username, password, role) — mustChangePassword set automatically
 *   - Generate 12-digit access key for any user (shown once)
 *   - Reset password (admin sets temp password, user must change on login)
 *   - Deactivate / reactivate users
 *   - Password strength enforced on all forms
 */

import { useState, useEffect } from 'react'
import {
  fetchUsers, createUserApi,
  generateKeyForUserApi, resetPasswordApi,
  deactivateUserApi, reactivateUserApi,
} from '@services/backendClient.js'
import { stripHtml } from '@utils/sanitize.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import styles from './AdminPage.module.css'

// ── Password strength (mirrors server-side rules) ─────────────────────────────
function checkPw(pw) {
  return {
    length:    pw.length >= 8,
    uppercase: /[A-Z]/.test(pw),
    number:    /[0-9]/.test(pw),
    special:   /[^A-Za-z0-9]/.test(pw),
  }
}
function pwValid(pw) { const c = checkPw(pw); return c.length && c.uppercase && c.number && c.special }

export default function AdminPage() {
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [showAdd, setShowAdd] = useState(false)

  async function loadUsers() {
    setLoading(true)
    setError('')
    try {
      const data = await fetchUsers()
      setUsers(Array.isArray(data) ? data : [])
    } catch {
      setError('Failed to load users. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadUsers() }, [])

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>User Management</h1>
          <p className={styles.subtitle}>Admin panel — manage users, keys, and access</p>
        </div>
        <button className={styles.addBtn} onClick={() => setShowAdd(s => !s)}>
          {showAdd ? '✕ Cancel' : '+ Add User'}
        </button>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {showAdd && (
        <ErrorBoundary>
          <AddUserForm onSuccess={() => { setShowAdd(false); loadUsers() }} />
        </ErrorBoundary>
      )}

      {/* Security info banner */}
      <div className={styles.securityNote}>
        <span>🔐</span>
        <div>
          <strong>Security</strong>
          <p>
            New users must change their password on first login.
            Access keys are shown once and never stored in plaintext.
            Deactivated users cannot log in and their sessions are invalidated immediately.
          </p>
        </div>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading users…</div>
      ) : users.length === 0 ? (
        <div className={styles.empty}>No users found.</div>
      ) : (
        <div className={styles.userList}>
          {users.map(u => (
            <ErrorBoundary key={u.userId}>
              <UserCard user={u} onRefresh={loadUsers} />
            </ErrorBoundary>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Add user form ─────────────────────────────────────────────────────────────

function AddUserForm({ onSuccess }) {
  const [fields,  setFields]  = useState({ username: '', password: '', role: 'user' })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [showPw,  setShowPw]  = useState(false)

  const checks = checkPw(fields.password)
  const set = (k, v) => setFields(f => ({ ...f, [k]: v }))

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!pwValid(fields.password)) { setError('Password does not meet requirements'); return }

    setLoading(true)
    try {
      const res = await createUserApi({
        username: stripHtml(fields.username.trim().toLowerCase()),
        password: fields.password,
        role:     fields.role,
      })
      if (res.error) { setError(res.error); return }
      onSuccess()
    } catch {
      setError('Failed to create user')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className={styles.addForm} onSubmit={handleSubmit} noValidate>
      <h2 className={styles.formTitle}>New User</h2>
      {error && <div className={styles.error} role="alert">{error}</div>}

      <div className={styles.formRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="new-username">
            Username <span className={styles.hint}>(4–32 chars, letters/numbers/_.-)</span>
          </label>
          <input
            id="new-username"
            className={styles.input}
            value={fields.username}
            onChange={e => set('username', e.target.value)}
            required minLength={4} maxLength={32}
            pattern="[a-zA-Z0-9_.\-]+"
            disabled={loading}
            autoComplete="off"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="new-password">Password</label>
          <div className={styles.inputWrap}>
            <input
              id="new-password"
              className={styles.input}
              type={showPw ? 'text' : 'password'}
              value={fields.password}
              onChange={e => set('password', e.target.value)}
              required minLength={8}
              disabled={loading}
              autoComplete="new-password"
            />
            <button type="button" className={styles.eyeBtn}
              onClick={() => setShowPw(s => !s)} aria-label="Toggle password visibility">
              {showPw ? '🙈' : '👁'}
            </button>
          </div>
          {/* Inline requirements */}
          {fields.password && (
            <div className={styles.pwChecks}>
              <PwCheck met={checks.length}    text="8+ chars" />
              <PwCheck met={checks.uppercase} text="Uppercase" />
              <PwCheck met={checks.number}    text="Number" />
              <PwCheck met={checks.special}   text="Special" />
            </div>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="new-role">Role</label>
          <select id="new-role" className={styles.select} value={fields.role}
            onChange={e => set('role', e.target.value)} disabled={loading}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <button className={styles.submitBtn} type="submit"
          disabled={loading || !pwValid(fields.password)}>
          {loading ? 'Creating…' : 'Create User'}
        </button>
      </div>

      <p className={styles.formNote}>
        ⓘ User will be required to change their password on first login.
        Generate an access key for them after creation.
      </p>
    </form>
  )
}

function PwCheck({ met, text }) {
  return (
    <span className={`${styles.pwCheck} ${met ? styles.pwCheckMet : ''}`}>
      {met ? '✓' : '○'} {text}
    </span>
  )
}

// ── User card ─────────────────────────────────────────────────────────────────

function UserCard({ user: u, onRefresh }) {
  const [expanded,    setExpanded]    = useState(false)
  const [keyResult,   setKeyResult]   = useState(null)
  const [keyRevealed, setKeyRevealed] = useState(false)
  const [keyCopied,   setKeyCopied]   = useState(false)
  const [keyDays,     setKeyDays]     = useState(30)
  const [resetPw,     setResetPw]     = useState('')
  const [showResetPw, setShowResetPw] = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [success,     setSuccess]     = useState('')

  function flash(msg) { setSuccess(msg); setTimeout(() => setSuccess(''), 3000) }
  function err(msg)   { setError(msg);   setTimeout(() => setError(''), 5000) }

  async function handleKeygen() {
    setLoading(true)
    setError('')
    setKeyResult(null)
    try {
      const data = await generateKeyForUserApi(u.userId, keyDays)
      if (data.error) { err(data.error); return }
      setKeyResult(data)
    } catch { err('Failed to generate key') }
    finally { setLoading(false) }
  }

  async function handleResetPassword(e) {
    e.preventDefault()
    if (!pwValid(resetPw)) { err('Password does not meet requirements'); return }
    setLoading(true)
    setError('')
    try {
      const data = await resetPasswordApi(u.userId, resetPw)
      if (data.error) { err(data.error); return }
      flash('Password reset. User must change it on next login.')
      setResetPw('')
      setShowResetPw(false)
    } catch { err('Failed to reset password') }
    finally { setLoading(false) }
  }

  async function handleToggleActive() {
    setLoading(true)
    try {
      const fn = u.isActive ? deactivateUserApi : reactivateUserApi
      const data = await fn(u.userId)
      if (data.error) { err(data.error); return }
      flash(u.isActive ? 'User deactivated' : 'User reactivated')
      onRefresh()
    } catch { err('Failed to update user') }
    finally { setLoading(false) }
  }

  function handleCopyKey() {
    if (!keyResult?.key) return
    navigator.clipboard.writeText(keyResult.key).then(() => {
      setKeyCopied(true)
      setTimeout(() => setKeyCopied(false), 2000)
    })
  }

  const keyExpired = u.keyExpiresAt && new Date(u.keyExpiresAt) < new Date()
  const keyExpiresSoon = u.keyExpiresAt && !keyExpired &&
    (new Date(u.keyExpiresAt) - Date.now()) < 7 * 86_400_000

  return (
    <div className={`${styles.userCard} ${!u.isActive ? styles.userCardInactive : ''}`}>
      {/* ── Card header ── */}
      <div className={styles.cardHead}>
        <div className={styles.userInfo}>
          <span className={styles.username}>{u.username}</span>
          <span className={`${styles.roleBadge} ${u.role === 'admin' ? styles.adminRole : styles.userRole}`}>
            {u.role}
          </span>
          {!u.isActive && <span className={styles.inactiveBadge}>inactive</span>}
          {u.mustChangePassword && <span className={styles.mustChangeBadge}>must change pw</span>}
          {u.hasKey && keyExpired   && <span className={styles.keyExpiredBadge}>key expired</span>}
          {u.hasKey && keyExpiresSoon && !keyExpired && <span className={styles.keyWarnBadge}>key expiring soon</span>}
          {!u.hasKey && <span className={styles.noKeyBadge}>no key</span>}
        </div>

        <div className={styles.cardActions}>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.expandBtn}`}
            onClick={() => setExpanded(x => !x)}
            aria-expanded={expanded}
          >
            {expanded ? '▲' : '▼'} Manage
          </button>
        </div>
      </div>

      {/* ── Meta row ── */}
      <div className={styles.userMeta}>
        <span>Created: {u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-IN') : '—'}</span>
        <span>Last login: {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('en-IN') : 'Never'}</span>
        <span>Logins: {u.loginCount ?? 0}</span>
        {u.keyExpiresAt && (
          <span className={keyExpired ? styles.textBear : keyExpiresSoon ? styles.textWarn : ''}>
            Key expires: {new Date(u.keyExpiresAt).toLocaleDateString('en-IN')}
          </span>
        )}
      </div>

      {/* ── Expanded management panel ── */}
      {expanded && (
        <div className={styles.managePanel}>
          {error   && <div className={styles.error}   role="alert">{error}</div>}
          {success && <div className={styles.success} role="status">{success}</div>}

          {/* ── Key generation ── */}
          <div className={styles.manageSection}>
            <h3 className={styles.manageSectionTitle}>🔑 Access Key</h3>
            <div className={styles.keygenRow}>
              <select
                className={styles.selectSm}
                value={keyDays}
                onChange={e => setKeyDays(Number(e.target.value))}
                disabled={loading}
              >
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
                <option value={365}>1 year</option>
              </select>
              <button
                type="button"
                className={styles.keygenBtn}
                onClick={handleKeygen}
                disabled={loading}
              >
                {loading ? 'Generating…' : u.hasKey ? '↺ Regenerate Key' : '+ Generate Key'}
              </button>
            </div>

            {keyResult && (
              <div className={styles.keyResult}>
                <div className={styles.keyDisplay}>
                  <span className={styles.keyValue}>
                    {keyRevealed ? keyResult.key : keyResult.key.replace(/\d/g, '•')}
                  </span>
                  <div className={styles.keyBtns}>
                    <button
                      type="button"
                      className={styles.revealBtn}
                      onMouseDown={() => setKeyRevealed(true)}
                      onMouseUp={() => setKeyRevealed(false)}
                      onMouseLeave={() => setKeyRevealed(false)}
                      onTouchStart={() => setKeyRevealed(true)}
                      onTouchEnd={() => setKeyRevealed(false)}
                    >
                      {keyRevealed ? '🙈' : '👁 Hold'}
                    </button>
                    <button
                      type="button"
                      className={`${styles.copyBtn} ${keyCopied ? styles.copyBtnDone : ''}`}
                      onClick={handleCopyKey}
                    >
                      {keyCopied ? '✓' : '⎘ Copy'}
                    </button>
                  </div>
                </div>
                <p className={styles.keyNote}>
                  ⚠ Share this key with <strong>{u.username}</strong> securely. It will not be shown again.
                  Expires: {new Date(keyResult.expiresAt).toLocaleDateString('en-IN')}
                </p>
              </div>
            )}
          </div>

          {/* ── Reset password ── */}
          <div className={styles.manageSection}>
            <h3 className={styles.manageSectionTitle}>🔒 Reset Password</h3>
            {!showResetPw ? (
              <button
                type="button"
                className={styles.resetPwBtn}
                onClick={() => setShowResetPw(true)}
                disabled={loading}
              >
                Set Temporary Password
              </button>
            ) : (
              <form className={styles.resetPwForm} onSubmit={handleResetPassword} noValidate>
                <div className={styles.inputWrap}>
                  <input
                    type="password"
                    className={styles.input}
                    value={resetPw}
                    onChange={e => setResetPw(e.target.value)}
                    placeholder="New temporary password"
                    autoComplete="new-password"
                    disabled={loading}
                    required
                  />
                </div>
                {resetPw && (
                  <div className={styles.pwChecks}>
                    {Object.entries(checkPw(resetPw)).map(([k, met]) => (
                      <PwCheck key={k} met={met} text={k} />
                    ))}
                  </div>
                )}
                <div className={styles.resetPwActions}>
                  <button type="button" className={styles.cancelSmBtn}
                    onClick={() => { setShowResetPw(false); setResetPw('') }}>
                    Cancel
                  </button>
                  <button type="submit" className={styles.submitSmBtn}
                    disabled={loading || !pwValid(resetPw)}>
                    {loading ? 'Resetting…' : 'Reset Password'}
                  </button>
                </div>
                <p className={styles.resetNote}>
                  User will be required to change this password on next login.
                </p>
              </form>
            )}
          </div>

          {/* ── Activate / Deactivate ── */}
          <div className={styles.manageSection}>
            <h3 className={styles.manageSectionTitle}>Account Status</h3>
            <button
              type="button"
              className={u.isActive ? styles.deactivateBtn : styles.activateBtn}
              onClick={handleToggleActive}
              disabled={loading}
            >
              {u.isActive ? '⊘ Deactivate User' : '✓ Reactivate User'}
            </button>
            {u.isActive && (
              <p className={styles.deactivateNote}>
                Deactivating immediately invalidates all active sessions.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
