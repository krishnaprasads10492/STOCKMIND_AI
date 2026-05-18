/**
 * ProviderManager — AI Provider management panel for JARVIS.
 *
 * Shows all 12+ built-in providers + any custom ones added by JARVIS.
 * Allows admins to:
 *   - See which providers are available (have API keys)
 *   - Switch active model per provider
 *   - Set the preferred provider
 *   - Test a provider with a ping
 *   - Add a custom OpenAI-compatible provider
 *   - Ask JARVIS to add a provider via chat
 */

import { useState, useEffect } from 'react'
import { useAuthStore } from '@store/authStore.js'
import {
  fetchProviders, setActiveModel, setActiveProvider,
  testProvider, addProvider, generateProviderConfig,
} from '@services/jarvisClient.js'
import styles from './ProviderManager.module.css'

const PROVIDER_ICONS = {
  openai:      '🟢',
  anthropic:   '🟠',
  gemini:      '🔵',
  groq:        '⚡',
  mistral:     '🌊',
  deepseek:    '🔮',
  together:    '🤝',
  cohere:      '🧬',
  perplexity:  '🔍',
  xai:         '✖',
  ollama:      '🦙',
  lmstudio:    '🖥',
}

const FORMAT_LABELS = {
  openai:    'OpenAI-compatible',
  anthropic: 'Anthropic',
  gemini:    'Google Gemini',
  cohere:    'Cohere',
  custom:    'Custom',
}

export default function ProviderManager({ token }) {
  const user    = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin' || user?.role === 'super-admin'

  const [providers,   setProviders]   = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [testResults, setTestResults] = useState({})
  const [testing,     setTesting]     = useState({})
  const [showAdd,     setShowAdd]     = useState(false)
  const [activeTab,   setActiveTab]   = useState('available')

  useEffect(() => {
    if (!token) return
    load()
  }, [token])

  async function load() {
    setLoading(true); setError('')
    try {
      const data = await fetchProviders(token)
      setProviders(data)
    } catch (e) {
      setError(e?.message ?? 'Failed to load providers — is the AI backend running?')
    } finally {
      setLoading(false)
    }
  }

  async function handleSetModel(providerId, modelId) {
    try {
      await setActiveModel(providerId, modelId, token)
      await load()
    } catch (e) {
      setError(e?.message ?? 'Failed to set model')
    }
  }

  async function handleSetActive(providerId) {
    try {
      await setActiveProvider(providerId, token)
      await load()
    } catch (e) {
      setError(e?.message ?? 'Failed to set active provider')
    }
  }

  async function handleTest(providerId, modelId) {
    setTesting(prev => ({ ...prev, [providerId]: true }))
    try {
      const result = await testProvider(providerId, modelId, token)
      setTestResults(prev => ({ ...prev, [providerId]: result }))
    } catch (e) {
      setTestResults(prev => ({ ...prev, [providerId]: { ok: false, error: e?.message } }))
    } finally {
      setTesting(prev => ({ ...prev, [providerId]: false }))
    }
  }

  if (loading && !providers) {
    return <div className={styles.loading}>Loading providers…</div>
  }

  const allProviders   = providers?.providers ?? []
  const available      = allProviders.filter(p => p.available)
  const unavailable    = allProviders.filter(p => !p.available)
  const custom         = allProviders.filter(p => p.added_by === 'jarvis' || p.added_by === 'user')
  const local          = allProviders.filter(p => !p.env_key)

  const displayList = activeTab === 'available' ? available
    : activeTab === 'all'       ? allProviders
    : activeTab === 'local'     ? local
    : custom

  return (
    <div className={styles.manager}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>🤖 AI Provider Manager</h2>
          <p className={styles.subtitle}>
            {providers?.available_providers ?? 0} of {providers?.total_providers ?? 0} providers active
            · Add any OpenAI-compatible API
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.refreshBtn} type="button" onClick={load} disabled={loading}>
            {loading ? '…' : '↺ Refresh'}
          </button>
          {isAdmin && (
            <button className={styles.addBtn} type="button" onClick={() => setShowAdd(s => !s)}>
              {showAdd ? '✕ Cancel' : '+ Add Custom Provider'}
            </button>
          )}
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* ── Add custom provider form ── */}
      {showAdd && isAdmin && (
        <AddProviderForm token={token} onAdded={() => { setShowAdd(false); load() }} />
      )}

      {/* ── Tabs ── */}
      <div className={styles.tabs}>
        {[
          ['available', `✓ Active (${available.length})`],
          ['all',       `All (${allProviders.length})`],
          ['local',     `🦙 Local (${local.length})`],
          ['custom',    `Custom (${custom.length})`],
        ].map(([id, label]) => (
          <button key={id} type="button"
            className={`${styles.tab} ${activeTab === id ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Provider list ── */}
      <div className={styles.providerList}>
        {displayList.length === 0 && (
          <div className={styles.empty}>
            {activeTab === 'available'
              ? 'No providers active. Add an API key to your .env file to activate a provider.'
              : 'No providers in this category.'}
          </div>
        )}
        {displayList.map(p => (
          <ProviderCard
            key={p.id}
            provider={p}
            isAdmin={isAdmin}
            testResult={testResults[p.id]}
            testing={testing[p.id]}
            onSetModel={handleSetModel}
            onSetActive={handleSetActive}
            onTest={handleTest}
          />
        ))}
      </div>

      {/* ── Setup guide for unavailable providers ── */}
      {activeTab === 'available' && unavailable.length > 0 && (
        <div className={styles.setupGuide}>
          <h3 className={styles.setupTitle}>
            {unavailable.length} more provider{unavailable.length !== 1 ? 's' : ''} available — just add an API key
          </h3>
          <div className={styles.setupGrid}>
            {unavailable.slice(0, 6).map(p => (
              <div key={p.id} className={styles.setupCard}>
                <span className={styles.setupIcon}>{PROVIDER_ICONS[p.id] ?? '🤖'}</span>
                <div>
                  <div className={styles.setupName}>{p.name}</div>
                  {p.env_key && (
                    <code className={styles.setupEnvKey}>{p.env_key}=your_key</code>
                  )}
                  {p.note && <div className={styles.setupNote}>{p.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Provider Card ─────────────────────────────────────────────────────────────

function ProviderCard({ provider: p, isAdmin, testResult, testing, onSetModel, onSetActive, onTest }) {
  const [expanded, setExpanded] = useState(false)

  const statusColor = p.available ? 'var(--color-bull)' : 'var(--color-text-muted)'
  const icon        = PROVIDER_ICONS[p.id] ?? '🤖'

  return (
    <div className={`${styles.card} ${p.available ? styles.cardActive : styles.cardInactive}`}>
      <div className={styles.cardHead} onClick={() => setExpanded(s => !s)}
        role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setExpanded(s => !s)}>
        <div className={styles.cardLeft}>
          <span className={styles.cardIcon}>{icon}</span>
          <div>
            <div className={styles.cardName}>{p.name}</div>
            <div className={styles.cardMeta}>
              <span style={{ color: statusColor }}>{p.available ? '● Active' : '○ No key'}</span>
              {p.added_by !== 'builtin' && (
                <span className={styles.customBadge}>{p.added_by}</span>
              )}
              {p.note && <span className={styles.noteBadge}>ℹ</span>}
            </div>
          </div>
        </div>
        <div className={styles.cardRight}>
          {p.available && (
            <span className={styles.activeModel}>{p.active_model}</span>
          )}
          {p.env_key && !p.available && (
            <code className={styles.envKeyHint}>{p.env_key}</code>
          )}
          <span className={styles.expandHint}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div className={styles.cardDetail}>
          {p.note && <p className={styles.cardNote}>{p.note}</p>}

          {/* Models */}
          {p.models?.length > 0 && (
            <div className={styles.modelsSection}>
              <div className={styles.modelsTitle}>Models</div>
              <div className={styles.modelsList}>
                {p.models.map(m => (
                  <div key={m.id}
                    className={`${styles.modelItem} ${p.active_model === m.id ? styles.modelActive : ''}`}>
                    <div className={styles.modelInfo}>
                      <span className={styles.modelName}>{m.name}</span>
                      <span className={styles.modelContext}>{(m.context / 1000).toFixed(0)}k ctx</span>
                      {m.cost_per_1m_input === 0
                        ? <span className={styles.modelFree}>FREE</span>
                        : <span className={styles.modelCost}>${m.cost_per_1m_input}/1M in</span>
                      }
                    </div>
                    {isAdmin && p.available && p.active_model !== m.id && (
                      <button className={styles.setModelBtn} type="button"
                        onClick={() => onSetModel(p.id, m.id)}>
                        Use
                      </button>
                    )}
                    {p.active_model === m.id && (
                      <span className={styles.activeModelBadge}>✓ Active</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {isAdmin && p.available && (
            <div className={styles.cardActions}>
              <button className={styles.setActiveBtn} type="button"
                onClick={() => onSetActive(p.id)}>
                ⚡ Set as Primary
              </button>
              <button className={styles.testBtn} type="button"
                disabled={testing}
                onClick={() => onTest(p.id, p.active_model)}>
                {testing ? '…' : '🔌 Test Connection'}
              </button>
            </div>
          )}

          {/* Test result */}
          {testResult && (
            <div className={`${styles.testResult} ${testResult.ok ? styles.testOk : styles.testFail}`}>
              {testResult.ok
                ? `✓ Connected in ${testResult.latency_ms}ms — "${testResult.response}"`
                : `✕ Failed: ${testResult.error}`}
            </div>
          )}

          {/* Setup instructions for inactive providers */}
          {!p.available && p.env_key && (
            <div className={styles.setupInstructions}>
              <p>Add to your <code>.env</code> file:</p>
              <code className={styles.envLine}>{p.env_key}=your_api_key_here</code>
              <p>Then restart the Python AI backend.</p>
            </div>
          )}
          {!p.available && !p.env_key && (
            <div className={styles.setupInstructions}>
              <p>This is a local provider. Make sure the service is running on the configured port.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Add Custom Provider Form ───────────────────────────────────────────────────

function AddProviderForm({ token, onAdded }) {
  const [name,    setName]    = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [envKey,  setEnvKey]  = useState('')
  const [format,  setFormat]  = useState('openai')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [preview, setPreview] = useState(null)

  async function handlePreview() {
    if (!name.trim() || !baseUrl.trim()) return
    setLoading(true); setError('')
    try {
      const data = await generateProviderConfig(name.trim(), baseUrl.trim(), envKey.trim(), format, token)
      setPreview(data.config)
    } catch (e) {
      setError(e?.message ?? 'Failed to generate config')
    } finally {
      setLoading(false)
    }
  }

  async function handleAdd() {
    if (!preview) return
    setLoading(true); setError('')
    try {
      const result = await addProvider(preview, token)
      if (!result.ok) { setError(result.error ?? 'Failed'); return }
      onAdded()
    } catch (e) {
      setError(e?.message ?? 'Failed to add provider')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.addForm}>
      <h3 className={styles.addFormTitle}>Add Custom AI Provider</h3>
      <p className={styles.addFormHint}>
        Any OpenAI-compatible API works — Ollama, LM Studio, Azure OpenAI, AWS Bedrock, or any custom endpoint.
      </p>

      <div className={styles.addFormGrid}>
        <div className={styles.field}>
          <label className={styles.label}>Provider Name</label>
          <input className={styles.input} value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. My Ollama Server" maxLength={100} />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Base URL</label>
          <input className={styles.input} value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
            placeholder="e.g. http://localhost:11434/v1" maxLength={200} />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>API Key Env Var (optional)</label>
          <input className={styles.input} value={envKey} onChange={e => setEnvKey(e.target.value)}
            placeholder="e.g. MY_PROVIDER_API_KEY" maxLength={100} />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>API Format</label>
          <select className={styles.select} value={format} onChange={e => setFormat(e.target.value)}>
            {Object.entries(FORMAT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {preview && (
        <div className={styles.preview}>
          <div className={styles.previewTitle}>Preview config:</div>
          <pre className={styles.previewCode}>{JSON.stringify(preview, null, 2)}</pre>
        </div>
      )}

      <div className={styles.addFormActions}>
        <button className={styles.previewBtn} type="button"
          onClick={handlePreview} disabled={loading || !name.trim() || !baseUrl.trim()}>
          {loading ? '…' : '👁 Preview Config'}
        </button>
        {preview && (
          <button className={styles.confirmBtn} type="button"
            onClick={handleAdd} disabled={loading}>
            {loading ? '…' : '✓ Add Provider'}
          </button>
        )}
      </div>
    </div>
  )
}
