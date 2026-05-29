/**
 * ConfiguratorPage — Integration Resource Configurator
 *
 * Super-admin only. Allows configuring all external integrations:
 *   - Market Data (Yahoo, Zerodha, Finnhub, Alpha Vantage, etc.)
 *   - AI / LLM Providers (OpenAI, Anthropic, Gemini, Groq, Ollama, etc.)
 *   - Databases (MongoDB Atlas, PostgreSQL, Redis, SQLite)
 *   - News & Sentiment (NewsAPI, Polygon, Finnhub News)
 *   - Macro / Economic (FRED, World Bank)
 *   - Image / Wallpaper (Unsplash, Pexels, Pixabay)
 *   - Notifications (Telegram, Email, Webhook)
 *
 * Features:
 *   - Tab per resource category
 *   - Enable/disable individual providers
 *   - Multiple providers per category (or single for DB)
 *   - Per-user overrides (admin sets different keys for specific users)
 *   - Test connection button per provider
 *   - Changes saved to encrypted DB immediately
 *   - Scalable: new categories/providers added via schema only
 */

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@store/authStore.js'
import { apiFetch } from '@services/apiClient.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import { Disclaimer } from '@components/Disclaimer.jsx'
import styles from './ConfiguratorPage.module.css'

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchSchema(token) {
  const r = await apiFetch('/api/configurator/schema', { headers: { 'x-session-token': token } })
  if (!r.ok) throw new Error(`Schema fetch failed: ${r.status}`)
  return r.json()
}

async function fetchIntegrations(token) {
  const r = await apiFetch('/api/configurator/integrations', { headers: { 'x-session-token': token } })
  if (!r.ok) throw new Error(`Integrations fetch failed: ${r.status}`)
  return r.json()
}

async function saveCategory(token, category, providers, enabled) {
  const r = await apiFetch(`/api/configurator/integrations/${category}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body: JSON.stringify({ providers, enabled }),
  })
  return r.json()
}

async function testProvider(token, category, providerId) {
  const r = await apiFetch(`/api/configurator/integrations/${category}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body: JSON.stringify({ providerId }),
  })
  return r.json()
}

async function deleteProvider(token, category, providerId) {
  const r = await apiFetch(`/api/configurator/integrations/${category}/${providerId}`, {
    method: 'DELETE',
    headers: { 'x-session-token': token },
  })
  return r.json()
}

async function fetchUsers(token) {
  const r = await apiFetch('/api/users', { headers: { 'x-session-token': token } })
  return r.json()
}

async function saveUserOverride(token, userId, category, providers, enabled) {
  const r = await apiFetch(`/api/configurator/integrations/user/${userId}/${category}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body: JSON.stringify({ providers, enabled }),
  })
  return r.json()
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ConfiguratorPage() {
  const user  = useAuthStore(s => s.user)
  const token = useAuthStore(s => s.token)
  const isSuperAdmin = user?.role === 'super-admin'

  const [schema,       setSchema]       = useState(null)
  const [integrations, setIntegrations] = useState(null)
  const [activeTab,    setActiveTab]    = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')
  const [users,        setUsers]        = useState([])
  const [userOverride, setUserOverride] = useState(null)  // userId for override mode

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [schemaData, intData, usersData] = await Promise.all([
        fetchSchema(token),
        fetchIntegrations(token),
        fetchUsers(token).catch(() => ({ users: [] })),
      ])
      const schemaObj = schemaData.schema ?? {}
      setSchema(schemaObj)
      setIntegrations(intData.integrations ?? {})
      setUsers(Array.isArray(usersData) ? usersData : usersData.users ?? [])
      // Only set initial tab once
      setActiveTab(prev => prev ?? Object.keys(schemaObj)[0] ?? null)
    } catch (e) {
      setError(e?.message ?? 'Failed to load configurator')
    } finally {
      setLoading(false)
    }
  }, [token])  // activeTab intentionally excluded — we only set it once

  useEffect(() => { load() }, [load])

  if (!isSuperAdmin) {
    return (
      <div className={styles.page}>
        <div className={styles.accessDenied}>
          <span className={styles.accessIcon}>🔒</span>
          <h2>Super-Admin Access Required</h2>
          <p>The Integration Configurator is only accessible to super-admin users.</p>
        </div>
      </div>
    )
  }

  const categories = schema ? Object.keys(schema) : []
  const currentSchema = schema?.[activeTab]
  const currentConfig = integrations?.[activeTab]

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>⚙ Integration Configurator</h1>
          <p className={styles.subtitle}>
            Configure all external resources — market data, AI models, databases, notifications.
            Changes are saved to encrypted storage and applied immediately.
          </p>
        </div>
        <div className={styles.headerRight}>
          {userOverride ? (
            <div className={styles.overrideBanner}>
              <span>👤 Editing overrides for: <strong>{users.find(u => u.userId === userOverride)?.username ?? userOverride}</strong></span>
              <button className={styles.clearOverrideBtn} onClick={() => setUserOverride(null)}>✕ Back to Global</button>
            </div>
          ) : (
            <div className={styles.userOverrideSelect}>
              <label className={styles.overrideLabel}>Set overrides for user:</label>
              <select
                className={styles.overrideSelect}
                value=""
                onChange={e => e.target.value && setUserOverride(e.target.value)}
              >
                <option value="">— Global config —</option>
                {users.filter(u => u.userId !== user?.userId).map(u => (
                  <option key={u.userId} value={u.userId}>{u.username} ({u.role})</option>
                ))}
              </select>
            </div>
          )}
          <button className={styles.refreshBtn} onClick={load} disabled={loading}>
            {loading ? '⏳' : '↺'} Refresh
          </button>
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {loading && !schema ? (
        <div className={styles.loading}>Loading integrations…</div>
      ) : (
        <>
          {/* Category tabs */}
          <div className={styles.tabs} role="tablist">
            {categories.map(cat => {
              const s = schema[cat]
              const cfg = integrations?.[cat]
              const enabledCount = (cfg?.enabled ?? []).length
              return (
                <button
                  key={cat}
                  role="tab"
                  aria-selected={activeTab === cat}
                  className={`${styles.tab} ${activeTab === cat ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab(cat)}
                >
                  <span className={styles.tabIcon}>{s.icon}</span>
                  <span className={styles.tabLabel}>{s.label}</span>
                  {enabledCount > 0 && (
                    <span className={styles.tabBadge}>{enabledCount}</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Active category panel */}
          {activeTab && currentSchema && (
            <ErrorBoundary>
              <CategoryPanel
                key={`${activeTab}-${userOverride ?? 'global'}`}
                category={activeTab}
                schema={currentSchema}
                config={currentConfig}
                token={token}
                userOverride={userOverride}
                onSaved={load}
              />
            </ErrorBoundary>
          )}
        </>
      )}

      <Disclaimer compact />
    </div>
  )
}

// ── Category Panel ────────────────────────────────────────────────────────────

function CategoryPanel({ category, schema, config, token, userOverride, onSaved }) {
  const initProviders = () => {
    const stored = config?.config?.providers ?? []
    const enabledList = config?.enabled ?? config?.config?.enabled ?? []
    return schema.providers.map(sp => {
      const found = stored.find(p => p.id === sp.id) ?? {}
      return { ...sp, ...found, _enabled: enabledList.includes(sp.id) }
    })
  }

  const [providers, setProviders] = useState(initProviders)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')
  const [testing, setTesting] = useState({})   // providerId → {loading, result}

  function toggleEnabled(providerId) {
    setProviders(prev => prev.map(p =>
      p.id === providerId
        ? { ...p, _enabled: !p._enabled }
        : schema.multiple ? p : { ...p, _enabled: false }  // single-select for non-multiple
    ))
  }

  function updateField(providerId, field, value) {
    setProviders(prev => prev.map(p =>
      p.id === providerId ? { ...p, [field]: value } : p
    ))
  }

  async function handleSave() {
    setSaving(true); setError(''); setSaved(false)
    try {
      const enabled = providers.filter(p => p._enabled).map(p => p.id)
      const toSave  = providers.map(({ _enabled, ...rest }) => rest)
      const fn = userOverride
        ? (cat, prov, en) => saveUserOverride(token, userOverride, cat, prov, en)
        : saveCategory
      const res = await fn(token, category, toSave, enabled)
      if (!res.ok) { setError(res.error ?? 'Save failed'); return }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      onSaved()
    } catch (e) {
      setError(e?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest(providerId) {
    setTesting(t => ({ ...t, [providerId]: { loading: true, result: null } }))
    try {
      const res = await testProvider(token, category, providerId)
      setTesting(t => ({ ...t, [providerId]: { loading: false, result: res } }))
    } catch (e) {
      setTesting(t => ({ ...t, [providerId]: { loading: false, result: { ok: false, error: e.message } } }))
    }
  }

  async function handleDelete(providerId) {
    if (!confirm(`Remove ${providerId} from ${category}?`)) return
    await deleteProvider(token, category, providerId)
    onSaved()
  }

  const enabledCount = providers.filter(p => p._enabled).length

  return (
    <div className={styles.categoryPanel}>
      {/* Panel header */}
      <div className={styles.panelHeader}>
        <div>
          <h2 className={styles.panelTitle}>{schema.icon} {schema.label}</h2>
          <p className={styles.panelDesc}>{schema.description}</p>
          {!schema.multiple && (
            <span className={styles.singleNote}>Single selection — only one provider active at a time</span>
          )}
        </div>
        <div className={styles.panelActions}>
          <span className={styles.enabledCount}>{enabledCount} active</span>
          {error  && <span className={styles.saveError}>{error}</span>}
          {saved  && <span className={styles.saveOk}>✓ Saved</span>}
          <button
            className={styles.saveBtn}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '⏳ Saving…' : '💾 Save Changes'}
          </button>
        </div>
      </div>

      {/* Provider cards */}
      <div className={styles.providerGrid}>
        {providers.map(provider => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            schema={schema.providers.find(s => s.id === provider.id) ?? provider}
            enabled={provider._enabled}
            testState={testing[provider.id]}
            onToggle={() => toggleEnabled(provider.id)}
            onFieldChange={(field, val) => updateField(provider.id, field, val)}
            onTest={() => handleTest(provider.id)}
            onDelete={() => handleDelete(provider.id)}
          />
        ))}
      </div>
    </div>
  )
}

// ── Provider Card ─────────────────────────────────────────────────────────────

function ProviderCard({ provider, schema, enabled, testState, onToggle, onFieldChange, onTest, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const [showSecrets, setShowSecrets] = useState({})

  const hasFields = (schema.fields ?? []).length > 0
  const testResult = testState?.result

  return (
    <div className={`${styles.providerCard} ${enabled ? styles.providerCardEnabled : ''}`}>
      {/* Card header */}
      <div className={styles.providerHead}>
        <div className={styles.providerLeft}>
          {/* Enable toggle */}
          <label className={styles.toggleWrap} title={enabled ? 'Disable' : 'Enable'}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={onToggle}
              className={styles.toggleInput}
              aria-label={`${enabled ? 'Disable' : 'Enable'} ${provider.name}`}
            />
            <span className={`${styles.toggle} ${enabled ? styles.toggleOn : ''}`} aria-hidden="true" />
          </label>
          <div className={styles.providerInfo}>
            <span className={styles.providerName}>{provider.name}</span>
            <div className={styles.providerMeta}>
              {schema.free && <span className={styles.freeBadge}>Free</span>}
              {schema.authType === 'none' && <span className={styles.noAuthBadge}>No key needed</span>}
              {enabled && <span className={styles.activeBadge}>● Active</span>}
            </div>
          </div>
        </div>

        <div className={styles.providerRight}>
          {/* Test button */}
          {enabled && (
            <button
              className={`${styles.testBtn} ${testResult?.ok === true ? styles.testOk : testResult?.ok === false ? styles.testFail : ''}`}
              onClick={onTest}
              disabled={testState?.loading}
              title="Test connection"
            >
              {testState?.loading ? '⏳' : testResult?.ok === true ? '✓' : testResult?.ok === false ? '✗' : '⚡ Test'}
            </button>
          )}
          {/* Docs link */}
          {schema.docs && (
            <a href={schema.docs} target="_blank" rel="noopener noreferrer"
              className={styles.docsLink} title="Documentation">
              📖
            </a>
          )}
          {/* Expand/collapse */}
          {hasFields && (
            <button
              className={styles.expandBtn}
              onClick={() => setExpanded(e => !e)}
              aria-expanded={expanded}
            >
              {expanded ? '▲' : '▼'}
            </button>
          )}
        </div>
      </div>

      {/* Test result */}
      {testResult && (
        <div className={`${styles.testResult} ${testResult.ok ? styles.testResultOk : styles.testResultFail}`}>
          {testResult.ok
            ? `✓ Connected (${testResult.latency_ms}ms)`
            : `✗ Failed: ${testResult.error ?? 'Connection refused'}`}
          {testResult.note && <span className={styles.testNote}> — {testResult.note}</span>}
        </div>
      )}

      {/* Fields (expanded) */}
      {expanded && hasFields && (
        <div className={styles.providerFields}>
          {(schema.fields ?? []).map(field => {
            const isSecret = ['apiKey','apiSecret','password','botToken','secret','uri'].includes(field)
            const isVisible = showSecrets[field]
            return (
              <div key={field} className={styles.fieldRow}>
                <label className={styles.fieldLabel} htmlFor={`${provider.id}-${field}`}>
                  {_fieldLabel(field)}
                  {isSecret && <span className={styles.secretTag}>🔒 encrypted</span>}
                </label>
                <div className={styles.fieldInputWrap}>
                  <input
                    id={`${provider.id}-${field}`}
                    className={styles.fieldInput}
                    type={isSecret && !isVisible ? 'password' : 'text'}
                    value={provider[field] ?? ''}
                    onChange={e => onFieldChange(field, e.target.value)}
                    placeholder={_fieldPlaceholder(field, provider.id)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {isSecret && (
                    <button
                      type="button"
                      className={styles.eyeBtn}
                      onMouseDown={() => setShowSecrets(s => ({ ...s, [field]: true }))}
                      onMouseUp={() => setShowSecrets(s => ({ ...s, [field]: false }))}
                      onMouseLeave={() => setShowSecrets(s => ({ ...s, [field]: false }))}
                      aria-label="Hold to reveal"
                    >
                      {isVisible ? '🙈' : '👁'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _fieldLabel(field) {
  const labels = {
    apiKey:      'API Key',
    apiSecret:   'API Secret',
    password:    'Password',
    botToken:    'Bot Token',
    chatId:      'Chat ID',
    secret:      'Webhook Secret',
    uri:         'Connection URI',
    baseUrl:     'Base URL',
    defaultModel:'Default Model',
    host:        'Host',
    port:        'Port',
    database:    'Database Name',
    user:        'Username',
    path:        'File Path',
    from:        'From Email',
    url:         'Webhook URL',
    redirectUrl: 'Redirect URL',
  }
  return labels[field] ?? field.replace(/([A-Z])/g, ' $1').trim()
}

function _fieldPlaceholder(field, providerId) {
  const placeholders = {
    apiKey:       'sk-... or your API key',
    uri:          'mongodb+srv://user:pass@cluster.mongodb.net/db',
    baseUrl:      'http://localhost:11434',
    defaultModel: 'e.g. gpt-4o-mini, llama3.2',
    host:         'localhost',
    port:         '5432',
    database:     'stockmind',
    user:         'username',
    chatId:       '-100123456789',
    url:          'https://your-webhook.com/endpoint',
    redirectUrl:  'http://localhost:4098/api/zerodha/callback',
  }
  return placeholders[field] ?? ''
}
