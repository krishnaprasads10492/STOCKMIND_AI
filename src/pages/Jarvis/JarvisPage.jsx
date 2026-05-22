/**
 * JarvisPage — JARVIS: Self-Healing, Self-Updating AI Intelligence System
 *
 * The JARVIS page is the mission control for the entire application's health.
 * It shows:
 *   - Live event feed (SSE stream from Python AI backend)
 *   - System diagnostics (CPU, memory, uptime, error rates)
 *   - Dependency scanner (outdated packages, security issues)
 *   - Code health analyzer (architecture violations, tech debt)
 *   - Algorithm upgrade proposals (with approve/reject)
 *   - Pending approvals queue
 *   - Self-optimizer ML health
 *
 * Accessible to ALL users (read-only). Admin actions (approve/scan) require admin role.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '@store/authStore.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import { InfoTooltip } from '@components/InfoTooltip.jsx'
import {
  fetchJarvisStatus, fetchNodeHealth, fetchDependencies,
  fetchCodeHealth, fetchAlgoProposals, forceScan,
  approveJarvisAction, connectJarvisStream,
  generateTheme, writeTheme, issueApprovalToken,
} from '@services/jarvisClient.js'
import { useVoiceCommand } from '@hooks/useVoiceCommand.js'
import { useThemeStore } from '@store/themeStore.js'
import JarvisChat from './JarvisChat.jsx'
import ProviderManager from './ProviderManager.jsx'
import styles from './JarvisPage.module.css'

const PAGE = 'jarvis'
const MAX_EVENTS = 100

const SEVERITY_COLOR = {
  INFO:     'var(--color-accent)',
  SUCCESS:  'var(--color-bull)',
  WARNING:  'var(--color-warn)',
  CRITICAL: 'var(--color-bear)',
}

const SEVERITY_ICON = {
  INFO:     'ℹ',
  SUCCESS:  '✓',
  WARNING:  '⚠',
  CRITICAL: '✕',
}

const EVENT_TYPE_ICON = {
  heartbeat:        '💓',
  system_health:    '🖥',
  dependency_scan:  '📦',
  code_health:      '🔍',
  algo_upgrade:     '🧠',
  self_heal:        '🔧',
  accuracy_drift:   '📉',
  recommendation:   '💡',
  approval_required:'🔔',
  action_applied:   '✅',
  action_rejected:  '❌',
}

export default function JarvisPage() {
  const token   = useAuthStore(s => s.token)
  const user    = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin' || user?.role === 'super-admin'
  const isSuperAdmin = user?.role === 'super-admin'

  const [activeTab, setActiveTab] = useState('chat')
  const [events,    setEvents]    = useState([])
  const [status,    setStatus]    = useState(null)
  const [connected, setConnected] = useState(false)
  const streamRef = useRef(null)

  // Voice command integration — super-admin only
  const handleVoiceCommand = useCallback(({ command }) => {
    switch (command) {
      case 'STATUS':
        setActiveTab('system')
        fetchJarvisStatus(token).then(setStatus).catch(() => {})
        break
      case 'SCAN':
        setActiveTab('deps')
        break
      case 'SHOW_ALERTS':
        setActiveTab('approvals')
        break
      case 'APPROVE_ALL':
        setActiveTab('approvals')
        break
      default:
        break
    }
  }, [token])

  useVoiceCommand({
    onCommand: handleVoiceCommand,
    enabled: isSuperAdmin,
  })

  // Connect to live event stream on mount
  useEffect(() => {
    if (!token) return

    const stream = connectJarvisStream(
      token,
      (evt) => {
        setEvents(prev => {
          const next = [evt, ...prev]
          return next.slice(0, MAX_EVENTS)
        })
      },
      () => setConnected(false),
    )
    streamRef.current = stream
    setConnected(true)

    // Load initial status
    fetchJarvisStatus(token).then(setStatus).catch(() => {})

    return () => {
      stream.close()
      setConnected(false)
    }
  }, [token])

  // Auto-refresh status every 30s
  useEffect(() => {
    if (!token) return
    const timer = setInterval(() => {
      fetchJarvisStatus(token).then(setStatus).catch(() => {})
    }, 30_000)
    return () => clearInterval(timer)
  }, [token])

  const pendingApprovals = status?.pending_approvals ?? []
  const criticalEvents   = events.filter(e => e.severity === 'CRITICAL').length
  const warningEvents    = events.filter(e => e.severity === 'WARNING').length

  return (
    <div className={styles.page}>
      {/* ── JARVIS Header ── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.jarvisLogo}>
            <span className={styles.jarvisIcon}>🤖</span>
            <div>
              <h1 className={styles.title}>JARVIS</h1>
              <p className={styles.subtitle}>Just A Rather Very Intelligent System</p>
            </div>
          </div>
          <div className={`${styles.statusPill} ${connected ? styles.statusOnline : styles.statusOffline}`}>
            <span className={styles.statusDot} />
            {connected ? 'ONLINE' : 'OFFLINE'}
          </div>
        </div>

        <div className={styles.headerStats}>
          {criticalEvents > 0 && (
            <div className={styles.alertBadge} style={{ background: 'var(--color-bear-dim)', borderColor: 'var(--color-bear)' }}>
              <span style={{ color: 'var(--color-bear)' }}>✕ {criticalEvents} Critical</span>
            </div>
          )}
          {warningEvents > 0 && (
            <div className={styles.alertBadge} style={{ background: 'var(--color-warn-dim)', borderColor: 'var(--color-warn)' }}>
              <span style={{ color: 'var(--color-warn)' }}>⚠ {warningEvents} Warning</span>
            </div>
          )}
          {pendingApprovals.length > 0 && (
            <div className={styles.alertBadge} style={{ background: 'var(--color-ai-dim)', borderColor: 'var(--color-ai)' }}>
              <span style={{ color: 'var(--color-ai)' }}>🔔 {pendingApprovals.length} Pending</span>
            </div>
          )}
          {status?.uptime_human && (
            <div className={styles.uptimeBadge}>⏱ {status.uptime_human}</div>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className={styles.tabs} role="tablist">
        {[
          ['chat',       '💬 Chat'],
          ['live',       '📡 Live Feed'],
          ['system',     '🖥 System'],
          ['deps',       '📦 Dependencies'],
          ['code',       '🔍 Code Health'],
          ['algos',      '🧠 Algo Upgrades'],
          ['themes',     '🎨 Theme Studio'],
          ['providers',  '🤖 Providers'],
          ['approvals',  `🔔 Approvals${pendingApprovals.length > 0 ? ` (${pendingApprovals.length})` : ''}`],
        ].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={activeTab === id}
            className={`${styles.tab} ${activeTab === id ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <ErrorBoundary>
        {activeTab === 'chat'      && <JarvisChat token={token} />}
        {activeTab === 'live'      && <LiveFeedTab events={events} connected={connected} />}
        {activeTab === 'system'    && <SystemTab token={token} status={status} isAdmin={isAdmin} />}
        {activeTab === 'deps'      && <DepsTab token={token} isAdmin={isAdmin} />}
        {activeTab === 'code'      && <CodeHealthTab token={token} isAdmin={isAdmin} />}
        {activeTab === 'algos'     && <AlgoUpgradesTab token={token} isAdmin={isAdmin} />}
        {activeTab === 'themes'    && <ThemeStudioTab token={token} isAdmin={isAdmin} />}
        {activeTab === 'providers' && <ProviderManager token={token} />}
        {activeTab === 'approvals' && <ApprovalsTab token={token} isAdmin={isAdmin} approvals={pendingApprovals} onRefresh={() => fetchJarvisStatus(token).then(setStatus).catch(() => {})} />}
      </ErrorBoundary>
    </div>
  )
}

// ── Live Feed Tab ─────────────────────────────────────────────────────────────

function LiveFeedTab({ events, connected }) {
  const [filter, setFilter] = useState('ALL')
  const feedRef = useRef(null)

  const filtered = filter === 'ALL' ? events
    : events.filter(e => e.severity === filter || e.type === filter)

  return (
    <div className={styles.tabContent}>
      <div className={styles.feedHeader}>
        <div className={styles.feedFilters}>
          {['ALL', 'CRITICAL', 'WARNING', 'INFO', 'SUCCESS'].map(f => (
            <button key={f} type="button"
              className={`${styles.filterChip} ${filter === f ? styles.filterChipActive : ''}`}
              onClick={() => setFilter(f)}
              style={filter === f && f !== 'ALL' ? { borderColor: SEVERITY_COLOR[f], color: SEVERITY_COLOR[f] } : {}}>
              {f}
            </button>
          ))}
        </div>
        <span className={styles.feedCount}>{filtered.length} events</span>
      </div>

      <div className={styles.feed} ref={feedRef} aria-live="polite" aria-label="JARVIS live event feed">
        {filtered.length === 0 && (
          <div className={styles.feedEmpty}>
            {connected ? 'Waiting for events…' : 'JARVIS offline — start the Python AI backend'}
          </div>
        )}
        {filtered.map((evt, i) => (
          <EventCard key={`${evt.timestamp}-${i}`} event={evt} />
        ))}
      </div>
    </div>
  )
}

function EventCard({ event: e }) {
  const [expanded, setExpanded] = useState(false)
  const color = SEVERITY_COLOR[e.severity] ?? 'var(--color-text-muted)'
  const icon  = EVENT_TYPE_ICON[e.type] ?? '●'
  const time  = new Date(e.timestamp * 1000).toLocaleTimeString('en-IN', { hour12: false })

  return (
    <div className={`${styles.eventCard} ${styles[`evt_${e.severity?.toLowerCase()}`]}`}
      style={{ borderLeftColor: color }}>
      <div className={styles.eventHead} onClick={() => setExpanded(x => !x)}
        role="button" tabIndex={0} onKeyDown={ev => ev.key === 'Enter' && setExpanded(x => !x)}>
        <span className={styles.eventIcon}>{icon}</span>
        <div className={styles.eventMain}>
          <span className={styles.eventTitle}>{e.title}</span>
          <span className={styles.eventMsg}>{e.message}</span>
        </div>
        <div className={styles.eventMeta}>
          <span className={styles.eventSeverity} style={{ color }}>{SEVERITY_ICON[e.severity]} {e.severity}</span>
          <span className={styles.eventTime}>{time}</span>
          {e.data && Object.keys(e.data).length > 0 && (
            <span className={styles.expandHint}>{expanded ? '▲' : '▼'}</span>
          )}
        </div>
      </div>
      {expanded && e.data && Object.keys(e.data).length > 0 && (
        <div className={styles.eventData}>
          <pre className={styles.eventDataPre}>{JSON.stringify(e.data, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

// ── System Tab ────────────────────────────────────────────────────────────────

function SystemTab({ token, status, isAdmin }) {
  const [nodeHealth, setNodeHealth] = useState(null)
  const [loading,    setLoading]    = useState(false)

  useEffect(() => {
    if (!token) return
    fetchNodeHealth(token).then(setNodeHealth).catch(() => {})
    const t = setInterval(() => fetchNodeHealth(token).then(setNodeHealth).catch(() => {}), 10_000)
    return () => clearInterval(t)
  }, [token])

  async function handleForceScan() {
    setLoading(true)
    try { await forceScan('diagnostics', token) } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  const sys = status?.system ?? {}
  const ml  = status?.ml_health ?? {}

  return (
    <div className={styles.tabContent}>
      {isAdmin && (
        <div className={styles.scanBar}>
          <button className={styles.scanBtn} onClick={handleForceScan} disabled={loading} type="button">
            {loading ? <><span className={styles.spinner} />Scanning…</> : '🔄 Force Diagnostics Scan'}
          </button>
          {status?.auto_healed_count > 0 && (
            <span className={styles.healedBadge}>🔧 {status.auto_healed_count} auto-healed</span>
          )}
        </div>
      )}

      <div className={styles.metricsGrid}>
        <MetricCard label="AI Backend Uptime"  value={status?.uptime_human ?? '—'}    icon="⏱" color="accent" />
        <MetricCard label="Node.js Uptime"      value={nodeHealth ? formatUptime(nodeHealth.uptime_seconds) : '—'} icon="🟢" color="bull" />
        <MetricCard label="Heap Used"           value={nodeHealth ? `${nodeHealth.memory?.heap_used_mb}MB` : '—'} icon="💾" color={nodeHealth?.memory?.heap_used_mb > 400 ? 'warn' : 'bull'} />
        <MetricCard label="System RAM Used"     value={nodeHealth ? `${nodeHealth.system?.used_mem_pct}%` : '—'} icon="🖥" color={nodeHealth?.system?.used_mem_pct > 80 ? 'warn' : 'bull'} />
        <MetricCard label="Python Memory"       value={sys.memory_mb ? `${sys.memory_mb}MB` : '—'} icon="🐍" color={sys.memory_mb > 600 ? 'warn' : 'bull'} />
        <MetricCard label="Req/5min"            value={sys.requests_5min ?? '—'} icon="📊" color="neutral" />
        <MetricCard label="Error Rate"          value={sys.error_rate_pct != null ? `${sys.error_rate_pct}%` : '—'} icon="⚠" color={sys.error_rate_pct > 5 ? 'bear' : 'bull'} />
        <MetricCard label="P95 Response"        value={sys.p95_response_ms ? `${sys.p95_response_ms}ms` : '—'} icon="⚡" color={sys.p95_response_ms > 3000 ? 'warn' : 'bull'} />
        <MetricCard label="ML Accuracy"         value={ml.performance?.rolling_accuracy_pct != null ? `${ml.performance.rolling_accuracy_pct}%` : '—'} icon="🎯" color={ml.performance?.rolling_accuracy_pct >= 75 ? 'bull' : 'bear'} />
        <MetricCard label="Calibration (ECE)"   value={ml.performance?.ece_pct != null ? `${ml.performance.ece_pct}%` : '—'} icon="📐" color={ml.performance?.ece_pct <= 5 ? 'bull' : 'warn'} />
        <MetricCard label="Outcomes Tracked"    value={ml.performance?.outcomes_tracked ?? 0} icon="📋" color="neutral" />
        <MetricCard label="Drift Detected"      value={ml.performance?.drift_detected ? 'YES' : 'NO'} icon="📉" color={ml.performance?.drift_detected ? 'bear' : 'bull'} />
      </div>

      {/* Next scan schedule */}
      {status?.next_scans && (
        <div className={styles.scanSchedule}>
          <h3 className={styles.sectionTitle}>Next Scheduled Scans</h3>
          <div className={styles.scanGrid}>
            {Object.entries(status.next_scans).map(([k, secs]) => (
              <div key={k} className={styles.scanItem}>
                <span className={styles.scanName}>{k.replace('_', ' ')}</span>
                <span className={styles.scanTime}>{secs > 0 ? `in ${formatUptime(secs)}` : 'now'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Heal log */}
      {status?.heal_log?.length > 0 && (
        <div className={styles.healLog}>
          <h3 className={styles.sectionTitle}>Auto-Heal Log</h3>
          {status.heal_log.map((h, i) => (
            <div key={i} className={styles.healEntry}>
              <span className={styles.healIcon}>🔧</span>
              <span className={styles.healTitle}>{h.title}</span>
              <span className={styles.healResult}>{h.result}</span>
              <span className={styles.healTime}>{new Date(h.applied_at * 1000).toLocaleTimeString('en-IN')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value, icon, color }) {
  const colorMap = { bull: 'var(--color-bull)', bear: 'var(--color-bear)', warn: 'var(--color-warn)', accent: 'var(--color-accent)', neutral: 'var(--color-text-secondary)', ai: 'var(--color-ai)' }
  return (
    <div className={styles.metricCard}>
      <span className={styles.metricIcon}>{icon}</span>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue} style={{ color: colorMap[color] ?? colorMap.neutral }}>{value}</span>
    </div>
  )
}

function formatUptime(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${Math.floor(s % 60)}s`
}

// ── Dependencies Tab ──────────────────────────────────────────────────────────

function DepsTab({ token, isAdmin }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function load() {
    setLoading(true); setError('')
    try { setData(await fetchDependencies(token)) }
    catch (e) { setError(e?.message ?? 'Failed') }
    finally { setLoading(false) }
  }

  async function handleForceScan() {
    setLoading(true); setError('')
    try { setData(await forceScan('dependencies', token)) }
    catch (e) { setError(e?.message ?? 'Scan failed') }
    finally { setLoading(false) }
  }

  return (
    <div className={styles.tabContent}>
      <div className={styles.scanBar}>
        <button className={styles.loadBtn} onClick={load} disabled={loading} type="button">
          {loading ? 'Loading…' : data ? '↺ Refresh' : 'Load Dependency Scan'}
        </button>
        {isAdmin && data && (
          <button className={styles.scanBtn} onClick={handleForceScan} disabled={loading} type="button">
            🔄 Force Re-scan
          </button>
        )}
        {data?.cached && <span className={styles.cachedBadge}>cached</span>}
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {data && (
        <div className={styles.depResults}>
          <div className={styles.depSummary}>
            <SeverityBadge severity={data.severity} />
            <span className={styles.depSummaryText}>{data.summary}</span>
            <span className={styles.depTime}>{new Date(data.timestamp * 1000).toLocaleTimeString('en-IN')}</span>
          </div>

          {data.python?.outdated?.length > 0 && (
            <DepSection title="🐍 Outdated Python Packages" items={data.python.outdated}
              renderItem={p => (
                <div className={styles.depItem}>
                  <span className={styles.depName}>{p.name}</span>
                  <span className={styles.depCurrent}>{p.current}</span>
                  <span className={styles.depArrow}>→</span>
                  <span className={styles.depLatest}>{p.latest}</span>
                </div>
              )} />
          )}

          {data.python?.unpinned?.length > 0 && (
            <DepSection title="📌 Unpinned Python Dependencies" items={data.python.unpinned}
              renderItem={p => (
                <div className={styles.depItem}>
                  <span className={styles.depName}>{p.content}</span>
                  <span className={styles.depIssue}>{p.issue}</span>
                </div>
              )} />
          )}

          {data.npm?.outdated?.length > 0 && (
            <DepSection title="📦 Outdated npm Packages" items={data.npm.outdated}
              renderItem={p => (
                <div className={styles.depItem}>
                  <span className={styles.depName}>{p.name}</span>
                  <span className={styles.depCurrent}>{p.current}</span>
                  <span className={styles.depArrow}>→</span>
                  <span className={styles.depLatest}>{p.latest}</span>
                </div>
              )} />
          )}

          {data.python?.outdated?.length === 0 && data.npm?.outdated?.length === 0 && (
            <div className={styles.allGood}>✓ All dependencies are up to date</div>
          )}
        </div>
      )}
    </div>
  )
}

function DepSection({ title, items, renderItem }) {
  return (
    <div className={styles.depSection}>
      <h3 className={styles.depSectionTitle}>{title} ({items.length})</h3>
      <div className={styles.depList}>{items.map((item, i) => <div key={i}>{renderItem(item)}</div>)}</div>
    </div>
  )
}

// ── Code Health Tab ───────────────────────────────────────────────────────────

function CodeHealthTab({ token, isAdmin }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function load() {
    setLoading(true); setError('')
    try { setData(await fetchCodeHealth(token)) }
    catch (e) { setError(e?.message ?? 'Failed') }
    finally { setLoading(false) }
  }

  const categoryColors = { architecture: 'var(--color-bear)', code_quality: 'var(--color-warn)', tech_debt: 'var(--color-warn)', staleness: 'var(--color-text-muted)', feature_flag: 'var(--color-accent)', missing_file: 'var(--color-bear)' }

  return (
    <div className={styles.tabContent}>
      <div className={styles.scanBar}>
        <button className={styles.loadBtn} onClick={load} disabled={loading} type="button">
          {loading ? 'Analysing…' : data ? '↺ Re-analyse' : 'Analyse Code Health'}
        </button>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {data && (
        <div className={styles.codeResults}>
          <div className={styles.codeScoreRow}>
            <div className={styles.codeScore}>
              <span className={styles.codeScoreNum} style={{ color: data.score >= 80 ? 'var(--color-bull)' : data.score >= 60 ? 'var(--color-warn)' : 'var(--color-bear)' }}>
                {data.score}
              </span>
              <span className={styles.codeScoreLabel}>Health Score</span>
            </div>
            <SeverityBadge severity={data.severity} />
            <span className={styles.codeIssueCount}>{data.total_issues} issues found</span>
          </div>

          <div className={styles.codeMetrics}>
            {Object.entries(data.metrics ?? {}).map(([k, v]) => (
              <div key={k} className={styles.codeMetric}>
                <span className={styles.codeMetricLabel}>{k.replace(/_/g, ' ')}</span>
                <span className={styles.codeMetricValue}>{v}</span>
              </div>
            ))}
          </div>

          {data.issues?.length > 0 && (
            <div className={styles.issueList}>
              <h3 className={styles.sectionTitle}>Issues</h3>
              {data.issues.map((issue, i) => (
                <div key={i} className={styles.issueItem} style={{ borderLeftColor: SEVERITY_COLOR[issue.severity] }}>
                  <div className={styles.issueHead}>
                    <span className={styles.issueSeverity} style={{ color: SEVERITY_COLOR[issue.severity] }}>{issue.severity}</span>
                    <span className={styles.issueFile}>{issue.file}{issue.line > 0 ? `:${issue.line}` : ''}</span>
                    <span className={styles.issueCategory} style={{ color: categoryColors[issue.category] ?? 'var(--color-text-muted)' }}>{issue.category}</span>
                  </div>
                  <p className={styles.issueText}>{issue.issue}</p>
                </div>
              ))}
            </div>
          )}

          {data.issues?.length === 0 && (
            <div className={styles.allGood}>✓ No code health issues detected</div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Algorithm Upgrades Tab ────────────────────────────────────────────────────

function AlgoUpgradesTab({ token, isAdmin }) {
  const [proposals, setProposals] = useState([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [expanded,  setExpanded]  = useState(null)

  async function load() {
    setLoading(true); setError('')
    try {
      const data = await fetchAlgoProposals(token)
      setProposals(data.proposals ?? [])
    } catch (e) { setError(e?.message ?? 'Failed') }
    finally { setLoading(false) }
  }

  const priorityColor = { HIGH: 'var(--color-bear)', MEDIUM: 'var(--color-warn)', LOW: 'var(--color-text-muted)' }
  const effortColor   = { LOW: 'var(--color-bull)', MEDIUM: 'var(--color-warn)', HIGH: 'var(--color-bear)' }

  return (
    <div className={styles.tabContent}>
      <div className={styles.scanBar}>
        <button className={styles.loadBtn} onClick={load} disabled={loading} type="button">
          {loading ? 'Loading…' : proposals.length > 0 ? '↺ Refresh' : 'Load Upgrade Proposals'}
        </button>
        <span className={styles.approvalNote}>All upgrades require admin approval before implementation</span>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {proposals.length > 0 && (
        <div className={styles.proposalList}>
          {proposals.map(p => (
            <div key={p.id} className={styles.proposalCard}>
              <div className={styles.proposalHead} onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setExpanded(expanded === p.id ? null : p.id)}>
                <div className={styles.proposalLeft}>
                  <span className={styles.proposalPriority} style={{ color: priorityColor[p.priority] }}>{p.priority}</span>
                  <span className={styles.proposalTitle}>{p.title}</span>
                  <span className={styles.proposalFile}>{p.file}</span>
                </div>
                <div className={styles.proposalRight}>
                  <span className={styles.proposalEffort} style={{ color: effortColor[p.effort] }}>effort: {p.effort}</span>
                  <span className={styles.proposalGain}>{p.expected_accuracy_gain}</span>
                  <span className={styles.expandHint}>{expanded === p.id ? '▲' : '▼'}</span>
                </div>
              </div>
              {expanded === p.id && (
                <div className={styles.proposalDetail}>
                  <p className={styles.proposalDesc}>{p.description}</p>
                  <div className={styles.proposalDeps}>
                    <strong>Dependencies:</strong> {p.dependencies?.join(', ') ?? 'none'}
                  </div>
                  {p.code_snippet && (
                    <pre className={styles.proposalCode}>{p.code_snippet}</pre>
                  )}
                  <div className={styles.proposalApproval}>
                    🔒 Requires admin approval — not auto-applied
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Approvals Tab ─────────────────────────────────────────────────────────────

function ApprovalsTab({ token, isAdmin, approvals, onRefresh }) {
  const [loading, setLoading] = useState({})
  const [error,   setError]   = useState('')

  async function handleApprove(actionId, approved) {
    setLoading(prev => ({ ...prev, [actionId]: true }))
    try {
      await approveJarvisAction(actionId, approved, token)
      onRefresh()
    } catch (e) { setError(e?.message ?? 'Failed') }
    finally { setLoading(prev => ({ ...prev, [actionId]: false })) }
  }

  return (
    <div className={styles.tabContent}>
      {error && <div className={styles.error}>{error}</div>}
      {approvals.length === 0 && (
        <div className={styles.empty}>No pending approvals. JARVIS is operating within approved parameters.</div>
      )}
      {approvals.map(action => (
        <div key={action.id} className={`${styles.approvalCard} ${styles[`sev_${action.severity?.toLowerCase()}`]}`}>
          <div className={styles.approvalHead}>
            <SeverityBadge severity={action.severity} />
            <span className={styles.approvalTitle}>{action.title}</span>
            <span className={styles.approvalType}>{action.type}</span>
          </div>
          <p className={styles.approvalReason}>{action.reason}</p>
          {action.packages && (
            <div className={styles.approvalPackages}>
              {action.packages.map(p => (
                <span key={p.name} className={styles.pkgChip}>{p.name}: {p.current} → {p.latest}</span>
              ))}
            </div>
          )}
          {action.files && (
            <div className={styles.approvalFiles}>
              Files: {action.files.join(', ')}
            </div>
          )}
          {isAdmin ? (
            <div className={styles.approvalActions}>
              <button className={styles.approveBtn} type="button"
                disabled={loading[action.id]}
                onClick={() => handleApprove(action.id, true)}>
                {loading[action.id] ? '…' : '✓ Approve'}
              </button>
              <button className={styles.rejectBtn} type="button"
                disabled={loading[action.id]}
                onClick={() => handleApprove(action.id, false)}>
                {loading[action.id] ? '…' : '✕ Reject'}
              </button>
            </div>
          ) : (
            <div className={styles.approvalNote}>Admin approval required</div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Shared components ─────────────────────────────────────────────────────────

function SeverityBadge({ severity }) {
  const color = SEVERITY_COLOR[severity] ?? 'var(--color-text-muted)'
  return (
    <span className={styles.severityBadge} style={{ color, borderColor: color }}>
      {SEVERITY_ICON[severity]} {severity}
    </span>
  )
}

// ── Theme Studio Tab ──────────────────────────────────────────────────────────

const EXAMPLE_PROMPTS = [
  { name: 'Quantum Storm',    desc: 'electric blue plasma with deep void black background and lightning accents' },
  { name: 'Crimson Nexus',    desc: 'deep red cyberpunk with dark blood background and gold circuit lines' },
  { name: 'Emerald Protocol', desc: 'hacker terminal green on pure black, matrix style with bright lime accents' },
  { name: 'Solar Flare',      desc: 'warm orange and gold sunrise with dark amber background, fire and energy' },
  { name: 'Void Walker',      desc: 'deep purple galaxy with cosmic nebula accents and dark space background' },
  { name: 'Arctic Ops',       desc: 'ice blue and frost white with stealth dark navy background, cold and precise' },
  { name: 'Toxic Reactor',    desc: 'radioactive acid green on near-black with toxic yellow warning accents' },
  { name: 'Sakura Night',     desc: 'soft pink cherry blossom with deep midnight blue background, japanese aesthetic' },
  { name: 'Obsidian Gold',    desc: 'luxury gold and amber on pure obsidian black, royal and powerful' },
  { name: 'Deep Ocean',       desc: 'bioluminescent teal and cyan on abyssal dark blue, deep sea exploration' },
]

function ThemeStudioTab({ token, isAdmin }) {
  const { addCustomTheme, removeCustomTheme, setTheme, previewTheme, cancelPreview,
          activeTheme, customThemes } = useThemeStore()

  const [name,           setName]           = useState('')
  const [description,    setDescription]    = useState('')
  const [smartSearch,    setSmartSearch]    = useState(true)   // true = web search + image extraction
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState('')
  const [generated,      setGenerated]      = useState(null)
  const [previewing,     setPreviewing]     = useState(false)
  const [writing,        setWriting]        = useState(false)
  const [writeResult,    setWriteResult]    = useState(null)
  const [selectedWp,     setSelectedWp]     = useState(0)   // index into wallpapers[]

  // Color swatch preview for a theme's key colors
  function ColorSwatch({ vars }) {
    const swatchColors = [
      vars['--color-bg-base'],
      vars['--color-bg-surface'],
      vars['--color-accent'],
      vars['--color-bull'],
      vars['--color-bear'],
      vars['--color-ai'],
      vars['--color-text-primary'],
    ].filter(Boolean)
    return (
      <div className={styles.colorSwatches} aria-label="Theme color preview">
        {swatchColors.map((c, i) => (
          <span key={i} className={styles.swatch}
            style={{ background: c }}
            title={c} aria-label={c} />
        ))}
      </div>
    )
  }

  // Build a theme variant with a specific wallpaper applied
  function themeWithWallpaper(theme, wpIdx) {
    if (!theme) return theme
    const wallpapers = theme.wallpapers ?? []
    if (!wallpapers.length || wpIdx < 0) return theme
    const wp = wallpapers[Math.min(wpIdx, wallpapers.length - 1)]
    if (!wp) return theme
    const isLight = theme.category === 'light'
    const overlay = isLight
      ? 'linear-gradient(135deg, rgba(255,255,255,0.85), rgba(255,255,255,0.75))'
      : 'linear-gradient(135deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.05) 50%, rgba(0,0,0,0.92) 100%)'
    return {
      ...theme,
      bg: {
        ...(theme.bg ?? {}),
        wallpaperUrl:       wp.url,
        wallpaperThumb:     wp.thumb_url ?? wp.url,
        wallpaperCredit:    wp.credit ?? '',
        wallpaperCreditUrl: wp.credit_url ?? '',
        wallpaperSource:    wp.source ?? '',
        overlay,
      },
    }
  }

  async function handleGenerate(e) {
    e.preventDefault()
    if (!name.trim() || !description.trim()) return
    setLoading(true); setError(''); setGenerated(null); setWriteResult(null); setSelectedWp(0)
    if (previewing) { cancelPreview(); setPreviewing(false) }
    try {
      // Smart mode: web search → image extraction → real palette
      // Classic mode: algorithmic color theory generation
      const useSmartSearch = smartSearch
      const endpoint = useSmartSearch
        ? `${import.meta.env.VITE_AI_API_URL?.replace('/api/inference', '') ?? 'http://localhost:8001'}/jarvis/smart-theme`
        : null

      let data
      if (useSmartSearch && endpoint) {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), style: description.trim(), image_count: 6, extract_from: 3 }),
          signal: AbortSignal.timeout(60000),
        })
        data = await res.json()
      } else {
        data = await generateTheme(name.trim(), description.trim(), token)
      }

      if (!data.ok || !data.theme) {
        setError(data.error ?? 'Generation failed')
        return
      }
      setGenerated(data.theme)
    } catch (err) {
      setError(err?.message ?? 'AI backend unavailable — start the Python server')
    } finally {
      setLoading(false)
    }
  }

  function handleSelectWallpaper(idx) {
    setSelectedWp(idx)
    if (previewing && generated) {
      previewTheme(themeWithWallpaper(generated, idx))
    }
  }

  function handlePreview() {
    if (!generated) return
    previewTheme(themeWithWallpaper(generated, selectedWp))
    setPreviewing(true)
  }

  function handleCancelPreview() {
    cancelPreview()
    setPreviewing(false)
  }

  function handleUseNow() {
    if (!generated) return
    const t = themeWithWallpaper(generated, selectedWp)
    addCustomTheme(t)
    setTheme(t.key)
    setPreviewing(false)
  }

  async function handleWritePermanently() {
    if (!generated || !isAdmin) return
    setWriting(true); setError('')
    try {
      const tokenData = await issueApprovalToken(token)
      if (!tokenData.token) { setError('Failed to get approval token'); return }
      const result = await writeTheme(tokenData.token, themeWithWallpaper(generated, selectedWp), token)
      if (!result.ok) { setError(result.error ?? 'Write failed'); return }
      setWriteResult(result)
      addCustomTheme(themeWithWallpaper(generated, selectedWp))
    } catch (err) {
      setError(err?.message ?? 'Write failed')
    } finally {
      setWriting(false)
    }
  }

  function handleRemoveCustom(key) {
    removeCustomTheme(key)
    if (previewing && generated?.key === key) {
      cancelPreview()
      setPreviewing(false)
    }
  }

  const wallpapers      = generated?.wallpapers ?? []
  const customThemeList = Object.values(customThemes)
  const activeWp        = wallpapers[selectedWp]

  return (
    <div className={styles.tabContent}>
      {/* ── Header ── */}
      <div className={styles.studioHeader}>
        <div>
          <h2 className={styles.studioTitle}>🎨 JARVIS Theme Studio</h2>
          <p className={styles.studioSubtitle}>
            Say the name or style → JARVIS searches the web → downloads images → extracts real colors → builds your theme.
            Or use Classic mode for instant algorithmic generation.
          </p>
        </div>
      </div>

      {/* ── Generator form ── */}
      <form className={styles.studioForm} onSubmit={handleGenerate} noValidate>
        <div className={styles.studioFormRow}>
          <div className={styles.field} style={{ flex: '0 0 200px' }}>
            <label className={styles.label} htmlFor="theme-name">Theme Name</label>
            <input id="theme-name" className={styles.input} value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Quantum Storm" maxLength={50} disabled={loading} />
          </div>
          <div className={styles.field} style={{ flex: 1 }}>
            <label className={styles.label} htmlFor="theme-desc">
              Description
              <span className={styles.charCount}>{description.length}/200</span>
            </label>
            <input id="theme-desc" className={styles.input} value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. electric blue plasma with deep void black background and lightning accents"
              maxLength={200} disabled={loading} />
          </div>
          <button className={styles.generateBtn} type="submit"
            disabled={loading || !name.trim() || !description.trim()}>
            {loading
              ? <><span className={styles.spinner} />Generating…</>
              : smartSearch ? '🔍 Search & Generate' : '✨ Generate Theme'}
          </button>
        </div>
        {/* Smart search toggle */}
        <div className={styles.smartToggleRow}>
          <label className={styles.smartToggle}>
            <input
              type="checkbox"
              checked={smartSearch}
              onChange={e => setSmartSearch(e.target.checked)}
              disabled={loading}
            />
            <span className={styles.smartToggleLabel}>
              {smartSearch
                ? '🔍 Smart Mode — web search + real image colors'
                : '⚡ Classic Mode — instant algorithmic generation'}
            </span>
          </label>
          {smartSearch && (
            <span className={styles.smartHint}>
              JARVIS will search the web, download images, and extract the actual dominant colors to build your theme.
            </span>
          )}
        </div>
      </form>

      {/* ── Example prompts ── */}
      <div className={styles.examplePrompts}>
        <span className={styles.examplesLabel}>Try:</span>
        <div className={styles.exampleChips}>
          {EXAMPLE_PROMPTS.map(p => (
            <button key={p.name} type="button" className={styles.exampleChip}
              onClick={() => { setName(p.name); setDescription(p.desc) }}
              disabled={loading}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {/* ── Generated theme result ── */}
      {generated && (
        <div className={styles.generatedTheme}>
          <div className={styles.generatedHeader}>
            <div className={styles.generatedInfo}>
              <span className={styles.generatedEmoji}>{generated.emoji}</span>
              <div>
                <div className={styles.generatedName}>{generated.name}</div>
                <div className={styles.generatedDesc}>{generated.description}</div>
                <div className={styles.generatedMeta}>
                  Category: {generated.category} · Key: <code>{generated.key}</code>
                  {generated.params && (
                    <> · Hue: {generated.params.hue}° · Accent: {generated.params.accent_hue}°</>
                  )}
                  {' '}
                  <span className={`${styles.paletteBadge} ${generated.palette_source === 'image_extraction' ? styles.paletteBadgeImage : styles.paletteBadgeAlgo}`}>
                    {generated.palette_source === 'image_extraction'
                      ? `🎨 Real image palette (${generated.images_found ?? 0} images searched, ${generated.palettes_extracted ?? 0} analyzed)`
                      : '⚡ Algorithmic palette'}
                  </span>
                </div>
                {/* Extracted palette chips */}
                {generated.palette?.length > 0 && (
                  <div className={styles.extractedPalette} style={{ marginTop: '6px' }}>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Palette:</span>
                    {generated.palette.map((hex, i) => (
                      <div
                        key={i}
                        className={styles.paletteChip}
                        style={{ background: hex }}
                        title={hex}
                        aria-label={`Color ${hex}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
            <ColorSwatch vars={generated.vars} />
          </div>

          {/* ── Wallpaper picker ── */}
          {wallpapers.length > 0 && (
            <div className={styles.wallpaperSection}>
              <div className={styles.wallpaperHeader}>
                <h4 className={styles.wallpaperTitle}>
                  🖼 Wallpapers ({wallpapers.length})
                  <span className={styles.wallpaperSources}>
                    {[...new Set(wallpapers.map(w => w.source))].join(' · ')}
                  </span>
                </h4>
                {activeWp?.credit && (
                  <a href={activeWp.credit_url ?? '#'} target="_blank" rel="noopener noreferrer"
                    className={styles.wallpaperCredit}>
                    📷 {activeWp.credit}
                  </a>
                )}
              </div>

              <div className={styles.wallpaperGrid}>
                {wallpapers.map((wp, i) => (
                  <button key={i} type="button"
                    className={`${styles.wallpaperThumb} ${selectedWp === i ? styles.wallpaperThumbActive : ''}`}
                    onClick={() => handleSelectWallpaper(i)}
                    aria-label={`Wallpaper ${i + 1}: ${wp.credit ?? ''}`}
                    aria-pressed={selectedWp === i}>
                    <img src={wp.thumb_url ?? wp.url} alt={wp.alt ?? `Wallpaper ${i + 1}`}
                      className={styles.wallpaperImg} loading="lazy"
                      onError={e => { e.target.style.display = 'none' }} />
                    {selectedWp === i && <div className={styles.wallpaperSelected}>✓</div>}
                    <div className={styles.wallpaperSource}>{wp.source}</div>
                  </button>
                ))}
                {/* No wallpaper option */}
                <button type="button"
                  className={`${styles.wallpaperThumb} ${styles.wallpaperNone} ${selectedWp === -1 ? styles.wallpaperThumbActive : ''}`}
                  onClick={() => setSelectedWp(-1)} aria-pressed={selectedWp === -1}>
                  <span className={styles.wallpaperNoneIcon}>⬛</span>
                  <span className={styles.wallpaperNoneLabel}>Pattern only</span>
                </button>
              </div>

              {/* Preview strip */}
              {activeWp && selectedWp >= 0 && (
                <div className={styles.wallpaperPreviewStrip}
                  style={{ backgroundImage: `url('${activeWp.thumb_url ?? activeWp.url}')` }}>
                  <div className={styles.wallpaperPreviewOverlay}>
                    <span className={styles.wallpaperPreviewText}>
                      Preview with dark overlay — text stays readable
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Color palette detail */}
          <div className={styles.paletteGrid}>
            {[
              ['Background', generated.vars['--color-bg-base']],
              ['Surface',    generated.vars['--color-bg-surface']],
              ['Accent',     generated.vars['--color-accent']],
              ['Bull',       generated.vars['--color-bull']],
              ['Bear',       generated.vars['--color-bear']],
              ['AI',         generated.vars['--color-ai']],
              ['Text',       generated.vars['--color-text-primary']],
              ['Muted',      generated.vars['--color-text-muted']],
            ].map(([label, color]) => (
              <div key={label} className={styles.paletteItem}>
                <div className={styles.paletteColor} style={{ background: color }} />
                <span className={styles.paletteLabel}>{label}</span>
                <span className={styles.paletteHex}>{color}</span>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className={styles.generatedActions}>
            {!previewing ? (
              <button className={styles.previewBtn} type="button" onClick={handlePreview}>
                👁 Live Preview
              </button>
            ) : (
              <button className={styles.cancelPreviewBtn} type="button" onClick={handleCancelPreview}>
                ✕ Cancel Preview
              </button>
            )}
            <button className={styles.useNowBtn} type="button" onClick={handleUseNow}>
              ⚡ Use Now (session)
            </button>
            {isAdmin && !writeResult && (
              <button className={styles.writeBtn} type="button"
                onClick={handleWritePermanently} disabled={writing}>
                {writing ? <><span className={styles.spinner} />Writing…</> : '💾 Save Permanently'}
              </button>
            )}
            {!isAdmin && <span className={styles.adminNote}>Admin required to save permanently</span>}
          </div>

          {writeResult && (
            <div className={styles.writeSuccess}>
              ✓ {writeResult.message}
              <br /><span className={styles.writeNote}>Reload the app to see the new theme in Settings.</span>
            </div>
          )}
          {previewing && (
            <div className={styles.previewBanner}>
              🎨 Previewing "{generated.name}"
              {activeWp ? ` with wallpaper by ${activeWp.credit}` : ''}
              {' '}— the entire app is now using this theme
            </div>
          )}
        </div>
      )}

      {/* ── Custom themes library ── */}
      {customThemeList.length > 0 && (
        <div className={styles.customLibrary}>
          <h3 className={styles.sectionTitle}>Your Custom Themes ({customThemeList.length})</h3>
          <p className={styles.hint}>These are saved in your browser. Use "Save Permanently" to add them to the app for all sessions.</p>
          <div className={styles.customGrid}>
            {customThemeList.map(t => (
              <div key={t.key}
                className={`${styles.customCard} ${activeTheme === t.key ? styles.customCardActive : ''}`}>
                {/* Wallpaper thumbnail if available */}
                {t.bg?.wallpaperThumb && (
                  <div className={styles.customWpThumb}
                    style={{ backgroundImage: `url('${t.bg.wallpaperThumb}')` }} />
                )}
                <div className={styles.customCardHead}>
                  <span className={styles.customEmoji}>{t.emoji}</span>
                  <div className={styles.customInfo}>
                    <span className={styles.customName}>{t.name}</span>
                    <span className={styles.customKey}>{t.key}</span>
                    {t.bg?.wallpaperCredit && (
                      <span className={styles.customWpCredit}>📷 {t.bg.wallpaperCredit}</span>
                    )}
                  </div>
                </div>
                <div className={styles.colorSwatches}>
                  {[t.vars?.['--color-bg-base'], t.vars?.['--color-accent'], t.vars?.['--color-bull'],
                    t.vars?.['--color-bear'], t.vars?.['--color-ai']].filter(Boolean).map((c, i) => (
                    <span key={i} className={styles.swatch} style={{ background: c }} title={c} />
                  ))}
                </div>
                <div className={styles.customActions}>
                  <button className={styles.useNowBtn} type="button"
                    onClick={() => { addCustomTheme(t); setTheme(t.key) }}
                    style={{ fontSize: 'var(--text-xs)', padding: '4px 10px' }}>
                    {activeTheme === t.key ? '✓ Active' : 'Use'}
                  </button>
                  <button className={styles.removeBtn} type="button"
                    onClick={() => handleRemoveCustom(t.key)}
                    aria-label={`Remove ${t.name}`}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── How it works ── */}
      <div className={styles.howItWorks}>
        <h3 className={styles.sectionTitle}>How JARVIS generates themes</h3>
        <div className={styles.howGrid}>
          <div className={styles.howStep}>
            <span className={styles.howNum}>1</span>
            <div>
              <strong>Parse description</strong>
              <p>Extracts color keywords (red, teal, gold), mood words (dark, neon, electric), and sci-fi references (matrix, tron, dune)</p>
            </div>
          </div>
          <div className={styles.howStep}>
            <span className={styles.howNum}>2</span>
            <div>
              <strong>Color theory</strong>
              <p>Derives all 23 CSS variables using HSL color space with WCAG AA contrast ratios</p>
            </div>
          </div>
          <div className={styles.howStep}>
            <span className={styles.howNum}>3</span>
            <div>
              <strong>Fetch wallpapers</strong>
              <p>Searches Unsplash, Pexels, and Pixabay for matching images. Always falls back to curated collection — no API key needed.</p>
            </div>
          </div>
          <div className={styles.howStep}>
            <span className={styles.howNum}>4</span>
            <div>
              <strong>Save permanently</strong>
              <p>Admin can write the theme to themes.js via JARVIS CodebaseEngineer — with automatic backup and rollback</p>
            </div>
          </div>
        </div>
        <div className={styles.wallpaperApiNote}>
          <strong>Add API keys for more wallpapers:</strong>
          {' '}Set <code>UNSPLASH_API_KEY</code>, <code>PEXELS_API_KEY</code>, or <code>PIXABAY_API_KEY</code> in your <code>.env</code> file.
          All are free. Without keys, JARVIS uses a curated collection of high-quality images.
        </div>
      </div>
    </div>
  )
}
