/**
 * RamaKnowledge/RamaKnowledgePage.jsx
 *
 * Two views in one page:
 *   1. Knowledge table — all stored entries, searchable/filterable
 *   2. Decisions panel — Rama's storage analysis + action list
 *
 * The Decisions panel is also accessible as a popup from JarvisOrb.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthStore } from '@store/authStore.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import {
  fetchKnowledge, fetchKnowledgeStats, fetchStorageDecisions,
  saveKnowledge, updateKnowledge, deleteKnowledge, runKnowledgeConsolidation,
} from '@services/jarvisClient.js'
import styles from './RamaKnowledgePage.module.css'

// ── Helpers ───────────────────────────────────────────────────────────────────
function relativeTime(ms) {
  if (!ms) return '—'
  const d = Date.now() - ms
  if (d < 60_000)      return 'just now'
  if (d < 3_600_000)   return `${Math.floor(d/60_000)}m ago`
  if (d < 86_400_000)  return `${Math.floor(d/3_600_000)}h ago`
  return new Date(ms).toLocaleDateString()
}

const TYPE_META = {
  insight:      { icon: '💡', color: '#a78bfa' },
  research:     { icon: '🔬', color: '#60a5fa' },
  code:         { icon: '💻', color: '#34d399' },
  market:       { icon: '📈', color: '#fbbf24' },
  decision:     { icon: '⚖️',  color: '#f87171' },
  general:      { icon: '📝', color: '#94a3b8' },
  consolidated: { icon: '🗜',  color: '#6b7280' },
}

const STATUS_META = {
  urgent:        { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  icon: '🔴' },
  recommended:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '🟡' },
  informational: { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)', icon: '🔵' },
  healthy:       { color: '#34d399', bg: 'rgba(52,211,153,0.12)', icon: '✅' },
}

// ── Decision Card ─────────────────────────────────────────────────────────────
function DecisionCard({ decision, onAction, loading }) {
  const [expanded, setExpanded] = useState(false)
  const meta = STATUS_META[decision.status] ?? STATUS_META.informational

  return (
    <div className={styles.decisionCard} style={{ borderColor: meta.color, background: meta.bg }}>
      <div className={styles.decisionHeader} onClick={() => setExpanded(e => !e)} role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setExpanded(v => !v) }}
        aria-expanded={expanded}>
        <div className={styles.decisionLeft}>
          <span className={styles.decisionStatus}>{meta.icon}</span>
          <div>
            <div className={styles.decisionTitle}>{decision.title}</div>
            <div className={styles.decisionCategory}>{decision.category} · {decision.metric}</div>
          </div>
        </div>
        <span className={styles.decisionChevron}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className={styles.decisionBody}>
          <p className={styles.decisionSituation}><strong>Situation:</strong> {decision.situation}</p>
          <p className={styles.decisionChoice}><strong>Rama's recommendation:</strong> {decision.decision}</p>
          <div className={styles.impactList}>
            <strong>Impacts:</strong>
            {decision.impact.map((item, i) => (
              <div key={i} className={styles.impactItem}>{item}</div>
            ))}
          </div>
          {decision.action && (
            <div className={styles.decisionActions}>
              {decision.action === 'consolidate' && (
                <button
                  className={styles.actionBtn}
                  onClick={() => onAction('consolidate')}
                  disabled={loading}
                >
                  {loading ? '⏳ Running…' : '🗜 Run Consolidation Now'}
                </button>
              )}
              {decision.action === 'enable_auto_extract' && (
                <div className={styles.actionNote}>
                  ✅ Auto-extraction is already active — enabled on every admin/super-admin conversation.
                </div>
              )}
            </div>
          )}
          {decision.reversible === false && (
            <div className={styles.irreversibleNote}>⚠️ This action is irreversible.</div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Decisions Panel ───────────────────────────────────────────────────────────
function DecisionsPanel({ token, onClose, asModal = false }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [acting,  setActing]  = useState(false)
  const [result,  setResult]  = useState(null)

  useEffect(() => {
    fetchStorageDecisions(token)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [token])

  async function handleAction(actionType) {
    setActing(true)
    setResult(null)
    try {
      if (actionType === 'consolidate') {
        const r = await runKnowledgeConsolidation(token)
        setResult({ ok: true, message: `Consolidation complete. ${r.totalDeleted} entries → ${r.totalCreated} summaries.` })
        // Refresh decisions
        const d = await fetchStorageDecisions(token)
        setData(d)
      }
    } catch (err) {
      setResult({ ok: false, message: err.message ?? 'Action failed' })
    } finally {
      setActing(false)
    }
  }

  const wrapper = asModal ? styles.modalOverlay : styles.panelWrap

  return (
    <div className={wrapper} onClick={asModal ? (e => { if (e.target === e.currentTarget) onClose?.() }) : undefined}>
      <div className={asModal ? styles.modalBox : styles.panelBox}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>🧠 Rama's Storage Decisions</h2>
            <p className={styles.panelSub}>Transparent analysis of what Rama knows, stores, and recommends</p>
          </div>
          {onClose && <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>}
        </div>

        {loading && (
          <div className={styles.panelLoading}>
            <div className={styles.loadingOrb} aria-hidden="true" />
            <p>Rama is analyzing storage…</p>
          </div>
        )}

        {!loading && data && (
          <>
            <div className={styles.summaryStrip}>
              {data.summary.urgent > 0 && (
                <span className={styles.summaryChip} style={{ color: '#ef4444', borderColor: '#ef4444' }}>
                  🔴 {data.summary.urgent} urgent
                </span>
              )}
              {data.summary.recommended > 0 && (
                <span className={styles.summaryChip} style={{ color: '#f59e0b', borderColor: '#f59e0b' }}>
                  🟡 {data.summary.recommended} recommended
                </span>
              )}
              <span className={styles.summaryChip}>
                🔵 {data.summary.informational} informational
              </span>
              <span className={styles.analyzedAt}>
                Analyzed {new Date(data.analyzedAt).toLocaleTimeString()}
              </span>
            </div>

            {result && (
              <div className={result.ok ? styles.resultOk : styles.resultErr}>
                {result.ok ? '✅' : '❌'} {result.message}
              </div>
            )}

            <div className={styles.decisionList}>
              {data.decisions.map(d => (
                <DecisionCard key={d.id} decision={d} onAction={handleAction} loading={acting} />
              ))}
            </div>

            <div className={styles.ramaNote}>
              <span className={styles.ramaIcon}>🪔</span>
              <p>Rama never hides storage or data decisions from you. This analysis runs fresh on every open. All consolidation actions require your explicit approval.</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Export for use in JarvisOrb popup
export { DecisionsPanel }

// ── Main page ─────────────────────────────────────────────────────────────────
export default function RamaKnowledgePage() {
  const { user, token } = useAuthStore()
  const isAdmin      = user?.role === 'admin' || user?.role === 'super-admin'
  const isSuperAdmin = user?.role === 'super-admin'

  const [view,        setView]        = useState('knowledge')  // 'knowledge' | 'decisions'
  const [entries,     setEntries]     = useState([])
  const [stats,       setStats]       = useState(null)
  const [total,       setTotal]       = useState(0)
  const [pages,       setPages]       = useState(1)
  const [page,        setPage]        = useState(1)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [search,      setSearch]      = useState('')
  const [typeFilter,  setTypeFilter]  = useState('')
  const [minImportance, setMinImportance] = useState('')
  const [pinnedOnly,  setPinnedOnly]  = useState(false)
  const [showDecisionModal, setShowDecisionModal] = useState(false)
  const searchTimer = useRef(null)
  const LIMIT = 25

  const loadEntries = useCallback(async (p = 1) => {
    setLoading(true); setError(null)
    try {
      const r = await fetchKnowledge({ page: p, limit: LIMIT, search,
        type: typeFilter, importance: minImportance || undefined,
        pinned: pinnedOnly || undefined }, token)
      setEntries(r.entries ?? [])
      setTotal(r.total ?? 0)
      setPages(r.pages ?? 1)
      setPage(p)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }, [search, typeFilter, minImportance, pinnedOnly, token])

  const loadStats = useCallback(async () => {
    try { const s = await fetchKnowledgeStats(token); setStats(s) }
    catch { /* optional */ }
  }, [token])

  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => loadEntries(1), 400)
    return () => clearTimeout(searchTimer.current)
  }, [loadEntries])

  async function handlePin(id, pinned) {
    await updateKnowledge(id, { pinned }, token)
    setEntries(es => es.map(e => e._id === id ? { ...e, pinned } : e))
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this knowledge entry permanently?')) return
    await deleteKnowledge(id, token)
    setEntries(es => es.filter(e => e._id !== id))
    setTotal(t => Math.max(0, t - 1))
    loadStats()
  }

  if (!isAdmin) return (
    <div className={styles.accessDenied}>
      <span className={styles.deniedIcon}>🔒</span>
      <h2>Admin Access Required</h2>
    </div>
  )

  return (
    <div className={styles.page}>
      <ErrorBoundary>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}><span className={styles.titleIcon}>🧠</span>Rama Knowledge Base</h1>
            <p className={styles.subtitle}>Rama's persistent memory — auto-extracted insights, research, code, decisions</p>
          </div>
          <div className={styles.headerRight}>
            <button className={styles.decisionsBtn} onClick={() => setShowDecisionModal(true)}>
              📊 Storage Decisions
            </button>
            <button className={styles.viewToggle} onClick={() => setView(v => v === 'knowledge' ? 'decisions' : 'knowledge')}>
              {view === 'knowledge' ? '📊 Full Decisions Page' : '📚 Knowledge Table'}
            </button>
          </div>
        </div>

        {/* Stats strip */}
        {stats && (
          <div className={styles.statsStrip}>
            <div className={styles.statCard}><span className={styles.statVal}>{stats.total?.toLocaleString()}</span><span className={styles.statLabel}>Entries</span></div>
            <div className={styles.statCard}><span className={styles.statVal}>{stats.pinned}</span><span className={styles.statLabel}>Pinned</span></div>
            <div className={styles.statCard}><span className={styles.statVal}>{stats.consolidated}</span><span className={styles.statLabel}>Consolidated</span></div>
            <div className={styles.statCard}><span className={styles.statVal}>{stats.avgImportance}</span><span className={styles.statLabel}>Avg Importance</span></div>
            {stats.freeTierUsagePct != null && (
              <div className={`${styles.statCard} ${stats.consolidationRecommended ? styles.statCardWarn : ''}`}>
                <span className={styles.statVal}>{stats.freeTierUsagePct}%</span>
                <span className={styles.statLabel}>Atlas usage</span>
              </div>
            )}
            {stats.consolidationRecommended && (
              <div className={styles.warnBanner}>
                ⚠️ Storage nearing limit — <button className={styles.warnLink} onClick={() => setShowDecisionModal(true)}>view decisions</button>
              </div>
            )}
          </div>
        )}

        {view === 'decisions' ? (
          <DecisionsPanel token={token} asModal={false} />
        ) : (
          <>
            {/* Filters */}
            <div className={styles.filters}>
              <input className={styles.searchInput} value={search} onChange={e => setSearch(e.target.value)}
                placeholder="🔍 Search topic or content…" aria-label="Search knowledge" />
              <select className={styles.filterSelect} value={typeFilter} onChange={e => setTypeFilter(e.target.value)} aria-label="Filter by type">
                <option value="">All types</option>
                {Object.keys(TYPE_META).map(t => <option key={t} value={t}>{TYPE_META[t].icon} {t}</option>)}
              </select>
              <select className={styles.filterSelect} value={minImportance} onChange={e => setMinImportance(e.target.value)} aria-label="Minimum importance">
                <option value="">Any importance</option>
                <option value="5">★★★★★ Critical</option>
                <option value="4">★★★★ High</option>
                <option value="3">★★★ Medium</option>
                <option value="2">★★ Low</option>
              </select>
              <button className={`${styles.filterBtn} ${pinnedOnly ? styles.filterBtnActive : ''}`}
                onClick={() => setPinnedOnly(p => !p)} aria-pressed={pinnedOnly}>
                📌 Pinned only
              </button>
            </div>

            {error && <div className={styles.errorBanner} role="alert">⚠ {error}</div>}

            {/* Table */}
            <div className={styles.tableSection}>
              {loading && entries.length === 0 ? (
                <div className={styles.loadingState}><div className={styles.loadingOrb} /><p>Loading knowledge…</p></div>
              ) : entries.length === 0 ? (
                <div className={styles.emptyState}><span className={styles.emptyIcon}>🧠</span><p>No knowledge entries yet.</p><p className={styles.emptyHint}>Entries are auto-saved from admin/super-admin conversations.</p></div>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table} aria-label="Rama knowledge entries">
                    <thead><tr>
                      <th>Type</th>
                      <th>Topic</th>
                      <th>Importance</th>
                      <th>Source</th>
                      <th>Saved</th>
                      <th>Tags</th>
                      <th aria-label="Actions"></th>
                    </tr></thead>
                    <tbody>
                      {entries.map(entry => (
                        <KnowledgeRow key={entry._id} entry={entry}
                          isSuperAdmin={isSuperAdmin}
                          onPin={handlePin} onDelete={handleDelete} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {pages > 1 && (
              <div className={styles.pagination}>
                <button className={styles.pageBtn} disabled={page <= 1} onClick={() => loadEntries(page - 1)}>‹ Prev</button>
                <span className={styles.pageInfo}>Page {page} of {pages} · {total.toLocaleString()} entries</span>
                <button className={styles.pageBtn} disabled={page >= pages} onClick={() => loadEntries(page + 1)}>Next ›</button>
              </div>
            )}
          </>
        )}

        {/* Decisions modal popup */}
        {showDecisionModal && (
          <DecisionsPanel token={token} asModal onClose={() => setShowDecisionModal(false)} />
        )}
      </ErrorBoundary>
    </div>
  )
}

// ── Knowledge table row (extracted for clarity) ───────────────────────────────
function KnowledgeRow({ entry, isSuperAdmin, onPin, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const tm = TYPE_META[entry.type] ?? TYPE_META.general
  const stars = '★'.repeat(entry.importance ?? 3) + '☆'.repeat(5 - (entry.importance ?? 3))

  return (
    <>
      <tr className={`${styles.row} ${entry.pinned ? styles.rowPinned : ''}`}
        onClick={() => setExpanded(e => !e)} tabIndex={0} role="button"
        aria-expanded={expanded}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setExpanded(v => !v) }}>
        <td>
          <span className={styles.typeBadge} style={{ color: tm.color, borderColor: tm.color + '44', background: tm.color + '18' }}>
            {tm.icon} {entry.type}
          </span>
        </td>
        <td className={styles.topicCell}>
          <span className={styles.topicText}>{entry.topic}</span>
          {entry.pinned && <span className={styles.pinBadge} title="Pinned — will never be consolidated">📌</span>}
        </td>
        <td className={styles.starsCell} title={`Importance: ${entry.importance}/5`}>{stars}</td>
        <td className={styles.sourceCell}>{entry.source}</td>
        <td className={styles.timeCell}>{relativeTime(entry.createdAt)}</td>
        <td>{(entry.tags ?? []).slice(0, 3).map(t => <span key={t} className={styles.tagPill}>{t}</span>)}</td>
        <td className={styles.actionsCell} onClick={e => e.stopPropagation()}>
          <button className={styles.iconAction} onClick={() => onPin(entry._id, !entry.pinned)}
            aria-label={entry.pinned ? 'Unpin' : 'Pin'} title={entry.pinned ? 'Unpin' : 'Pin'}>
            {entry.pinned ? '📌' : '📍'}
          </button>
          {isSuperAdmin && (
            <button className={`${styles.iconAction} ${styles.iconActionDanger}`}
              onClick={() => onDelete(entry._id)} aria-label="Delete entry">🗑</button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className={styles.expandedRow}>
          <td colSpan={7} className={styles.expandedCell}>
            <div className={styles.expandedContent}>
              <pre className={styles.contentPre}>{entry.content}</pre>
              {entry.consolidatedFrom && (
                <p className={styles.consolidatedNote}>
                  🗜 Consolidated from {entry.consolidatedFrom.length} entries
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
