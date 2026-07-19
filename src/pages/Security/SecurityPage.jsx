/**
 * SecurityPage.jsx — Threat Shield Dashboard
 * Super-admin only. Shows real-time threat statistics, trapped IPs,
 * AI agent detections, and eternal loop activity.
 */

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@services/apiClient.js'
import { useAuthStore } from '@store/authStore.js'
import { Disclaimer } from '@components/Disclaimer.jsx'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import styles from './SecurityPage.module.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(minutes) {
  if (minutes < 1)    return 'just now'
  if (minutes < 60)   return `${minutes}m ago`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`
  return `${Math.round(minutes / 1440)}d ago`
}

function ThreatBadge({ level }) {
  const map = {
    honeypot_path:      { label: '🍯 Honeypot',      cls: styles.badgeHoneypot },
    ai_bot:             { label: '🤖 AI Bot',         cls: styles.badgeAI },
    ai_prompt_injection:{ label: '💉 Prompt Inject',  cls: styles.badgeCritical },
    rapid_scan:         { label: '⚡ Rapid Scan',     cls: styles.badgeScan },
    aggressive_scan:    { label: '🔥 Aggressive Scan',cls: styles.badgeCritical },
    path_traversal:     { label: '🗂 Path Traversal', cls: styles.badgeCritical },
    sql_injection:      { label: '💾 SQLi',           cls: styles.badgeCritical },
    xss_or_injection:   { label: '⚠ XSS/Inject',     cls: styles.badgeWarn },
    no_user_agent:      { label: '👤 No UA',          cls: styles.badgeWarn },
    automated_client:   { label: '🕷 Automated',     cls: styles.badgeScan },
    repeat_offender:    { label: '🔁 Repeat',         cls: styles.badgeWarn },
    previously_trapped: { label: '♾ Looped',         cls: styles.badgeLoop },
    system_file_probe:  { label: '🔍 File Probe',     cls: styles.badgeCritical },
    known_attack_path:  { label: '🚨 Attack Path',    cls: styles.badgeCritical },
  }
  const { label, cls } = map[level] ?? { label: level, cls: styles.badgeWarn }
  return <span className={`${styles.badge} ${cls}`}>{label}</span>
}

function StatCard({ icon, label, value, sublabel, highlight }) {
  return (
    <div className={`${styles.statCard} ${highlight ? styles.statCardHighlight : ''}`}>
      <div className={styles.statIcon}>{icon}</div>
      <div className={styles.statBody}>
        <div className={styles.statValue}>{value ?? '—'}</div>
        <div className={styles.statLabel}>{label}</div>
        {sublabel && <div className={styles.statSub}>{sublabel}</div>}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SecurityPage() {
  const { user } = useAuthStore()
  const [stats, setStats]       = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

  const isSuperAdmin = user?.role === 'super-admin'

  const fetchStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch('/api/threat/stats')
      setStats(data)
      setLastRefresh(new Date())
    } catch (err) {
      setError(err.message ?? 'Failed to load threat stats')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 15_000)
    return () => clearInterval(interval)
  }, [fetchStats])

  if (!isSuperAdmin) {
    return (
      <div className={styles.accessDenied}>
        <span className={styles.deniedIcon}>🔒</span>
        <h2>Access Restricted</h2>
        <p>Security dashboard requires super-admin privileges.</p>
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
              <span className={styles.titleIcon}>🛡</span>
              Threat Shield
            </h1>
            <p className={styles.subtitle}>
              Eternal Loop Security Protocol — Real-time threat monitoring
            </p>
          </div>
          <div className={styles.headerRight}>
            {lastRefresh && (
              <span className={styles.refreshTime}>
                Last updated: {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <button
              className={styles.refreshBtn}
              onClick={fetchStats}
              disabled={loading}
              aria-label="Refresh threat stats"
            >
              {loading ? '⏳ Loading…' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {error && (
          <div className={styles.errorBanner} role="alert">
            ⚠ {error}
          </div>
        )}

        {/* Stats strip */}
        {stats && (
          <>
            <div className={styles.statsStrip}>
              <StatCard
                icon="♾"
                label="Eternal Loops Active"
                value={stats.eternal_loop_count}
                sublabel="IPs trapped indefinitely"
                highlight={stats.eternal_loop_count > 0}
              />
              <StatCard
                icon="🐢"
                label="Slow Trap Pool"
                value={stats.slow_trap_count}
                sublabel="Suspicious IPs in delay"
              />
              <StatCard
                icon="🍯"
                label="Honeypot Triggers"
                value={stats.honeypot_triggers}
                sublabel="Scanner traps hit"
              />
              <StatCard
                icon="🤖"
                label="AI Agents Detected"
                value={stats.ai_agents_seen}
                sublabel="Bot fingerprints seen"
                highlight={stats.ai_agents_seen > 0}
              />
            </div>

            {/* Eternal loop detail table */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>
                <span>♾ Eternal Loop — Trapped IPs</span>
                <span className={styles.sectionCount}>{stats.eternal_ips?.length ?? 0}</span>
              </h2>

              {!stats.eternal_ips?.length ? (
                <div className={styles.emptyState}>
                  <span className={styles.emptyIcon}>✅</span>
                  <p>No IPs currently trapped. All clean.</p>
                </div>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table} role="grid" aria-label="Trapped IPs">
                    <thead>
                      <tr>
                        <th scope="col">IP Address</th>
                        <th scope="col">Trapped For</th>
                        <th scope="col">Offences</th>
                        <th scope="col">Trap Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.eternal_ips.map((entry, i) => (
                        <tr key={entry.ip ?? i}>
                          <td className={styles.ipCell}>
                            <span className={styles.ipAddr}>{entry.ip}</span>
                          </td>
                          <td>
                            <span className={styles.timeCell}>
                              {timeAgo(entry.trapped_for_minutes)}
                            </span>
                          </td>
                          <td>
                            <span className={styles.offenceCount}>{entry.offences}</span>
                          </td>
                          <td>
                            <ThreatBadge level={entry.trap_type} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Protocol description */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Protocol Overview</h2>
              <div className={styles.protocolGrid}>
                <div className={styles.protocolCard}>
                  <div className={styles.protocolIcon}>♾</div>
                  <h3>Eternal Loop</h3>
                  <p>Confirmed threats get trapped in an infinite SSE stream. The server drips fake data every 3–7s, holding the connection open forever. Wastes attacker resources and connection pool.</p>
                </div>
                <div className={styles.protocolCard}>
                  <div className={styles.protocolIcon}>🐢</div>
                  <h3>Slow Trap</h3>
                  <p>Suspicious requests get exponential delays (2s → 4s → 8s → 30s). After 5 hits, promoted to eternal loop. Returns fake decoy responses that look plausible.</p>
                </div>
                <div className={styles.protocolCard}>
                  <div className={styles.protocolIcon}>🪞</div>
                  <h3>Mirror Trap</h3>
                  <p>AI agents and bots receive a fake API schema pointing back at themselves — creating recursive confusion and wasting AI tokens/compute.</p>
                </div>
                <div className={styles.protocolCard}>
                  <div className={styles.protocolIcon}>🍯</div>
                  <h3>Honeypot Paths</h3>
                  <p>Hidden paths that no legitimate user ever visits (/admin, /wp-admin, /.env, etc.). Any request triggers instant eternal loop. Catches automated scanners immediately.</p>
                </div>
                <div className={styles.protocolCard}>
                  <div className={styles.protocolIcon}>💉</div>
                  <h3>Prompt Injection Guard</h3>
                  <p>Detects AI-to-AI attacks: "ignore previous instructions", jailbreak attempts, system prompt overrides. Instant eternal loop for any prompt injection attempt.</p>
                </div>
                <div className={styles.protocolCard}>
                  <div className={styles.protocolIcon}>🔍</div>
                  <h3>Pattern Detection</h3>
                  <p>Monitors: path traversal, SQLi, XSS, rapid scanning (&gt;30 req/min), missing user agents, and known attack clients. Multi-signal scoring escalates response severity.</p>
                </div>
              </div>
            </div>
          </>
        )}

        {loading && !stats && (
          <div className={styles.loadingState}>
            <div className={styles.loadingOrb} aria-hidden="true" />
            <p>Loading threat intelligence…</p>
          </div>
        )}

        <Disclaimer compact />
      </ErrorBoundary>
    </div>
  )
}
