/**
 * RamaConversationsPage.jsx — Rama AI Conversation History
 * Admin/super-admin: full searchable, paginated table of all conversations.
 * Click any row to expand the full message thread.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthStore } from '@store/authStore.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import {
  fetchConversationStore,
  fetchConversationStoreStats,
  fetchConversationDetail,
  starConversationInStore,
  tagConversationInStore,
  deleteConversationFromStore,
} from '@services/jarvisClient.js'
import styles from './RamaConversationsPage.module.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(ms) {
  if (!ms) return '—'
  const diff = Date.now() - ms
  if (diff < 60_000)        return 'just now'
  if (diff < 3_600_000)     return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000)    return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 604_800_000)   return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(ms).toLocaleDateString()
}

function roleBadge(role) {
  const map = {
    'super-admin': { label: 'Super Admin', cls: styles.roleSuperAdmin },
    'admin':       { label: 'Admin',       cls: styles.roleAdmin },
    'user':        { label: 'User',        cls: styles.roleUser },
  }
  const { label, cls } = map[role] ?? { label: role, cls: styles.roleUser }
  return <span className={`${styles.roleBadge} ${cls}`}>{label}</span>
}

function intentBadge(intent) {
  if (!intent || intent === 'UNKNOWN') return null
  return <span className={styles.intentBadge}>{intent.replace(/_/g, ' ')}</span>
}

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAssistant}`}>
      <div className={styles.bubbleMeta}>
        <span className={styles.bubbleRole}>{isUser ? '👤 You' : '🪔 Rama'}</span>
        {msg.intent && intentBadge(msg.intent)}
        {msg.provider && msg.provider !== 'local' && (
          <span className={styles.bubbleProvider}>{msg.provider}</span>
        )}
        {msg.tokens > 0 && (
          <span className={styles.bubbleTokens}>{msg.tokens.toLocaleString()} tokens</span>
        )}
        {msg.wasFiltered && (
          <span className={styles.bubbleFiltered} title="Output was filtered by safety guardrails">🛡 filtered</span>
        )}
        <span className={styles.bubbleTime}>{relativeTime(msg.ts)}</span>
      </div>
      <div className={styles.bubbleContent}>
        <MessageContent text={msg.content} />
      </div>
    </div>
  )
}

// Safe inline renderer — no dangerouslySetInnerHTML, no XSS risk
function renderInline(text, keyPrefix) {
  const parts = []
  const re = /(\*\*(.+?)\*\*|`([^`]+)`)/g
  let last = 0, m, idx = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[0].startsWith('**')) {
      parts.push(<strong key={`${keyPrefix}-b${idx}`}>{m[2]}</strong>)
    } else {
      parts.push(<code key={`${keyPrefix}-c${idx}`} className={styles.inlineCode}>{m[3]}</code>)
    }
    last = m.index + m[0].length
    idx++
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function MessageContent({ text }) {
  const lines = String(text ?? '').split('\n')
  return (
    <div className={styles.msgContent}>
      {lines.map((line, i) => {
        if (line.startsWith('```')) return <div key={i} className={styles.msgCodeFence} />
        if (line.trim().startsWith('- ') || line.trim().startsWith('• ')) {
          return <div key={i} className={styles.msgBullet}>{renderInline(line.trim().slice(2), `b${i}`)}</div>
        }
        return <p key={i} className={styles.msgLine}>{renderInline(line, `l${i}`)}</p>
      })}
    </div>
  )
}

// ── Stats strip ───────────────────────────────────────────────────────────────

function StatsStrip({ stats }) {
  if (!stats) return null
  const byRole = stats.byRole ?? {}
  return (
    <div className={styles.statsStrip}>
      <div className={styles.statCard}>
        <span className={styles.statVal}>{(stats.totalConversations ?? 0).toLocaleString()}</span>
        <span className={styles.statLabel}>Conversations</span>
      </div>
      <div className={styles.statCard}>
        <span className={styles.statVal}>{(stats.totalMessages ?? 0).toLocaleString()}</span>
        <span className={styles.statLabel}>Messages</span>
      </div>
      <div className={styles.statCard}>
        <span className={styles.statVal}>{((stats.totalTokens ?? 0) / 1000).toFixed(1)}K</span>
        <span className={styles.statLabel}>Tokens used</span>
      </div>
      {Object.entries(byRole).map(([role, count]) => (
        <div key={role} className={styles.statCard}>
          <span className={styles.statVal}>{count}</span>
          <span className={styles.statLabel}>{role} convs</span>
        </div>
      ))}
    </div>
  )
}

// ── Conversation detail drawer ────────────────────────────────────────────────

function ConversationDrawer({ convId, token, isSuperAdmin, onClose, onStar, onDelete }) {
  const [conv, setConv]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [tagInput, setTagInput] = useState('')
  const drawerRef = useRef(null)

  useEffect(() => {
    if (!convId) return
    setLoading(true)
    fetchConversationDetail(convId, token)
      .then(d => { setConv(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [convId, token])

  useEffect(() => {
    function handler(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleStar() {
    if (!conv) return
    const newVal = !conv.starred
    await starConversationInStore(convId, newVal, token)
    setConv(c => ({ ...c, starred: newVal }))
    onStar?.(convId, newVal)
  }

  async function handleAddTag(e) {
    e.preventDefault()
    const tag = tagInput.trim()
    if (!tag || !conv) return
    const newTags = [...new Set([...(conv.tags ?? []), tag])]
    await tagConversationInStore(convId, newTags, token)
    setConv(c => ({ ...c, tags: newTags }))
    setTagInput('')
  }

  async function handleRemoveTag(tag) {
    if (!conv) return
    const newTags = (conv.tags ?? []).filter(t => t !== tag)
    await tagConversationInStore(convId, newTags, token)
    setConv(c => ({ ...c, tags: newTags }))
  }

  async function handleDelete() {
    if (!window.confirm('Delete this conversation permanently? This cannot be undone.')) return
    await deleteConversationFromStore(convId, token)
    onDelete?.(convId)
    onClose()
  }

  return (
    <div className={styles.drawerOverlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <aside className={styles.drawer} ref={drawerRef} role="dialog" aria-label="Conversation detail">
        <div className={styles.drawerHeader}>
          <div className={styles.drawerTitle}>
            <span className={styles.drawerIcon}>🪔</span>
            <span className={styles.drawerTitleText}>
              {loading ? 'Loading…' : (conv?.title ?? 'Conversation')}
            </span>
          </div>
          <div className={styles.drawerActions}>
            {conv && (
              <>
                <button
                  className={`${styles.actionBtn} ${conv.starred ? styles.actionBtnActive : ''}`}
                  onClick={handleStar}
                  aria-label={conv.starred ? 'Unstar conversation' : 'Star conversation'}
                  title={conv.starred ? 'Unstar' : 'Star'}
                >
                  {conv.starred ? '★' : '☆'}
                </button>
                {isSuperAdmin && (
                  <button
                    className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                    onClick={handleDelete}
                    aria-label="Delete conversation"
                    title="Delete permanently"
                  >
                    🗑
                  </button>
                )}
              </>
            )}
            <button className={styles.closeBtn} onClick={onClose} aria-label="Close drawer">✕</button>
          </div>
        </div>

        {loading && (
          <div className={styles.drawerLoading}>
            <div className={styles.loadingOrb} aria-hidden="true" />
            <p>Loading conversation…</p>
          </div>
        )}

        {!loading && conv && (
          <>
            {/* Meta */}
            <div className={styles.drawerMeta}>
              <span>{roleBadge(conv.userRole)}</span>
              <span className={styles.metaItem}>👤 {conv.username}</span>
              <span className={styles.metaItem}>💬 {conv.messageCount ?? 0} messages</span>
              <span className={styles.metaItem}>🔤 {(conv.totalTokens ?? 0).toLocaleString()} tokens</span>
              <span className={styles.metaItem}>🕐 {relativeTime(conv.lastMessageAt)}</span>
              {conv.provider && conv.provider !== 'local' && (
                <span className={styles.metaItem}>🤖 {conv.provider}</span>
              )}
            </div>

            {/* Tags */}
            <div className={styles.drawerTags}>
              {(conv.tags ?? []).map(t => (
                <span key={t} className={styles.tag}>
                  {t}
                  <button
                    className={styles.tagRemove}
                    onClick={() => handleRemoveTag(t)}
                    aria-label={`Remove tag ${t}`}
                  >×</button>
                </span>
              ))}
              <form className={styles.tagForm} onSubmit={handleAddTag}>
                <input
                  className={styles.tagInput}
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  placeholder="+ add tag"
                  maxLength={30}
                  aria-label="Add tag"
                />
              </form>
            </div>

            {/* Messages */}
            <div className={styles.messageList}>
              {(conv.messages ?? []).length === 0 ? (
                <div className={styles.emptyMessages}>No messages stored yet.</div>
              ) : (
                (conv.messages ?? []).map((msg, i) => (
                  <MessageBubble key={i} msg={msg} />
                ))
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RamaConversationsPage() {
  const { user, token } = useAuthStore()
  const isSuperAdmin = user?.role === 'super-admin'
  const isAdmin      = user?.role === 'admin' || isSuperAdmin

  const [convs,       setConvs]       = useState([])
  const [stats,       setStats]       = useState(null)
  const [total,       setTotal]       = useState(0)
  const [pages,       setPages]       = useState(1)
  const [page,        setPage]        = useState(1)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [search,      setSearch]      = useState('')
  const [roleFilter,  setRoleFilter]  = useState('')
  const [starFilter,  setStarFilter]  = useState(null)
  const [activeConv,  setActiveConv]  = useState(null)
  const searchTimer = useRef(null)

  const LIMIT = 25

  const loadConvs = useCallback(async (p = 1) => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchConversationStore(
        { page: p, limit: LIMIT, search, userRole: roleFilter,
          starred: starFilter },
        token
      )
      setConvs(result.conversations ?? [])
      setTotal(result.total ?? 0)
      setPages(result.pages ?? 1)
      setPage(p)
    } catch (err) {
      setError(err.message ?? 'Failed to load conversations')
    } finally {
      setLoading(false)
    }
  }, [search, roleFilter, starFilter, token])

  const loadStats = useCallback(async () => {
    try {
      const s = await fetchConversationStoreStats(token)
      setStats(s)
    } catch { /* stats are optional */ }
  }, [token])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => loadConvs(1), 400)
    return () => clearTimeout(searchTimer.current)
  }, [loadConvs])

  function handleStarUpdate(convId, starred) {
    setConvs(cs => cs.map(c => c._id === convId ? { ...c, starred } : c))
  }

  function handleDelete(convId) {
    setConvs(cs => cs.filter(c => c._id !== convId))
    setTotal(t => Math.max(0, t - 1))
    loadStats()
  }

  // Guard — after all hooks (Rules of Hooks: no early return before hooks)
  if (!isAdmin) {
    return (
      <div className={styles.accessDenied}>
        <span className={styles.deniedIcon}>🔒</span>
        <h2>Admin Access Required</h2>
        <p>Conversation history requires admin or super-admin privileges.</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <ErrorBoundary>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <h1 className={styles.title}>
              <span className={styles.titleIcon}>🪔</span>
              Rama Conversations
            </h1>
            <p className={styles.subtitle}>
              Full history of all Rama AI conversations — searchable, filterable, persistent
            </p>
          </div>
          <div className={styles.headerRight}>
            <span className={styles.totalCount}>{total.toLocaleString()} total</span>
            <button
              className={styles.refreshBtn}
              onClick={() => { loadConvs(1); loadStats() }}
              disabled={loading}
              aria-label="Refresh"
            >
              {loading ? '⏳' : '↻'} Refresh
            </button>
          </div>
        </div>

        {/* Stats */}
        <StatsStrip stats={stats} />

        {/* Filters */}
        <div className={styles.filters} role="search" aria-label="Filter conversations">
          <input
            className={styles.searchInput}
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Search by title…"
            aria-label="Search conversations"
          />
          <select
            className={styles.filterSelect}
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            aria-label="Filter by role"
          >
            <option value="">All roles</option>
            <option value="super-admin">Super Admin</option>
            <option value="admin">Admin</option>
            <option value="user">User</option>
          </select>
          <button
            className={`${styles.filterBtn} ${starFilter === true ? styles.filterBtnActive : ''}`}
            onClick={() => setStarFilter(s => s === true ? null : true)}
            aria-pressed={starFilter === true}
            title="Show starred only"
          >
            ★ Starred
          </button>
          {(search || roleFilter || starFilter != null) && (
            <button
              className={styles.clearBtn}
              onClick={() => { setSearch(''); setRoleFilter(''); setStarFilter(null) }}
              aria-label="Clear all filters"
            >
              ✕ Clear
            </button>
          )}
        </div>

        {error && (
          <div className={styles.errorBanner} role="alert">⚠ {error}</div>
        )}

        {/* Table */}
        <div className={styles.tableSection}>
          {loading && convs.length === 0 ? (
            <div className={styles.loadingState}>
              <div className={styles.loadingOrb} aria-hidden="true" />
              <p>Loading conversations…</p>
            </div>
          ) : convs.length === 0 ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>💬</span>
              <p>No conversations found.</p>
              {(search || roleFilter) && <p className={styles.emptyHint}>Try clearing your filters.</p>}
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table} aria-label="Rama conversations">
                <thead>
                  <tr>
                    <th scope="col" className={styles.colStar} aria-label="Starred"></th>
                    <th scope="col" className={styles.colTitle}>Conversation</th>
                    <th scope="col" className={styles.colUser}>User</th>
                    <th scope="col" className={styles.colRole}>Role</th>
                    <th scope="col" className={styles.colMsgs}>Messages</th>
                    <th scope="col" className={styles.colTokens}>Tokens</th>
                    <th scope="col" className={styles.colTime}>Last active</th>
                    <th scope="col" className={styles.colTags}>Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {convs.map(conv => (
                    <tr
                      key={conv._id}
                      className={`${styles.row} ${activeConv === conv._id ? styles.rowActive : ''}`}
                      onClick={() => setActiveConv(conv._id)}
                      tabIndex={0}
                      role="button"
                      aria-label={`Open conversation: ${conv.title}`}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setActiveConv(conv._id) }}
                    >
                      <td className={styles.colStar}>
                        <span
                          className={`${styles.starIcon} ${conv.starred ? styles.starIconActive : ''}`}
                          aria-label={conv.starred ? 'Starred' : 'Not starred'}
                        >
                          {conv.starred ? '★' : '☆'}
                        </span>
                      </td>
                      <td className={styles.colTitle}>
                        <span className={styles.convTitle}>{conv.title}</span>
                        <span className={styles.convId}>{conv._id}</span>
                      </td>
                      <td className={styles.colUser}>
                        <span className={styles.username}>{conv.username}</span>
                      </td>
                      <td className={styles.colRole}>{roleBadge(conv.userRole)}</td>
                      <td className={styles.colMsgs}>
                        <span className={styles.numCell}>{(conv.messageCount ?? 0).toLocaleString()}</span>
                      </td>
                      <td className={styles.colTokens}>
                        <span className={styles.numCell}>{((conv.totalTokens ?? 0) / 1000).toFixed(1)}K</span>
                      </td>
                      <td className={styles.colTime}>
                        <span className={styles.timeCell}>{relativeTime(conv.lastMessageAt)}</span>
                      </td>
                      <td className={styles.colTags}>
                        {(conv.tags ?? []).slice(0, 3).map(t => (
                          <span key={t} className={styles.tagPill}>{t}</span>
                        ))}
                        {(conv.tags?.length ?? 0) > 3 && (
                          <span className={styles.tagMore}>+{conv.tags.length - 3}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className={styles.pagination} role="navigation" aria-label="Pagination">
            <button
              className={styles.pageBtn}
              disabled={page <= 1}
              onClick={() => loadConvs(page - 1)}
              aria-label="Previous page"
            >
              ‹ Prev
            </button>
            <span className={styles.pageInfo}>Page {page} of {pages}</span>
            <button
              className={styles.pageBtn}
              disabled={page >= pages}
              onClick={() => loadConvs(page + 1)}
              aria-label="Next page"
            >
              Next ›
            </button>
          </div>
        )}

        {/* Conversation detail drawer */}
        {activeConv && (
          <ConversationDrawer
            convId={activeConv}
            token={token}
            isSuperAdmin={isSuperAdmin}
            onClose={() => setActiveConv(null)}
            onStar={handleStarUpdate}
            onDelete={handleDelete}
          />
        )}
      </ErrorBoundary>
    </div>
  )
}
