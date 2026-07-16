/**
 * JarvisOrb — Persistent JARVIS AI Presence
 *
 * Self-aware: knows which page the user is on, what they might need,
 * and proactively surfaces contextual suggestions.
 *
 * Features:
 *   - Page context detection — different suggestions per route
 *   - Proactive suggestions that appear automatically (not just on click)
 *   - System health monitoring with color-coded status
 *   - Quick chat — send a message to JARVIS without leaving the page
 *   - Market-hours awareness — different hints during / outside market
 *   - Pulse animation changes based on system state
 *   - Auto-dismissing suggestion toasts
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@store/authStore.js'
import { useMarketStore } from '@store/marketStore.js'
import { apiFetch } from '@services/apiClient.js'
import { brainChat } from '@services/jarvisClient.js'
import { usePageVisibility } from '@hooks/usePageVisibility.js'
import styles from './JarvisOrb.module.css'

// ── Page context map ──────────────────────────────────────────────────────────
const PAGE_CONTEXT = {
  '/dashboard':            { label: 'Dashboard',       emoji: '⊞',  suggestions: ['Generate signals for the active symbol', 'Show me today\'s market overview', 'What are the best opportunities right now?'] },
  '/predictions':          { label: 'Predictions',     emoji: '🎯', suggestions: ['Explain the top signal', 'What does grade A+ mean?', 'Is the current R:R ratio good?'] },
  '/charts':               { label: 'Charts',          emoji: '📊', suggestions: ['What indicators should I use for intraday?', 'Explain Supertrend', 'What does a Bollinger squeeze mean?'] },
  '/ami':                  { label: 'AMI Intel',       emoji: '🧬', suggestions: ['Explain AMI signals', 'What is institutional flow?', 'Show me dark pool indicators'] },
  '/multibagger':          { label: 'Multibagger',     emoji: '🚀', suggestions: ['What makes a multibagger?', 'How is the scanner scoring stocks?', 'Explain the fundamental filters'] },
  '/backtest':             { label: 'Backtest',        emoji: '📈', suggestions: ['What is walk-forward testing?', 'Explain the accuracy threshold', 'How do I interpret backtest results?'] },
  '/strategies':           { label: 'Strategies',     emoji: '🧩', suggestions: ['Create a momentum strategy', 'Explain swing trading', 'What is the best strategy for indices?'] },
  '/strategy-intelligence':{ label: 'AI Intelligence', emoji: '🧠', suggestions: ['Run a full strategy analysis', 'What strategy fits current market?', 'Compare momentum vs mean reversion'] },
  '/jarvis':               { label: 'JARVIS',          emoji: '🤖', suggestions: ['Show system health', 'What can you do?', 'Scan for issues'] },
  '/history':              { label: 'History',         emoji: '📋', suggestions: ['How accurate were my past predictions?', 'Show my best performing signals', 'What patterns do I miss most?'] },
  '/settings':             { label: 'Settings',        emoji: '⚙',  suggestions: ['Explain the prediction modes', 'How do I change my risk settings?', 'What does night light do?'] },
  '/learn':                { label: 'Learn',           emoji: '📚', suggestions: ['Teach me about RSI', 'Explain support and resistance', 'What is options delta?'] },
}

const STATUS_COLOR = { healthy: '#00ff9d', degraded: '#ffb700', critical: '#ff2d5f', offline: '#3d6080' }

function isMarketOpen() {
  const now = new Date()
  const d = now.getDay(), m = now.getHours() * 60 + now.getMinutes()
  return d >= 1 && d <= 5 && m >= 555 && m <= 930
}

// ── Component ─────────────────────────────────────────────────────────────────

export function JarvisOrb() {
  const token    = useAuthStore(s => s.token)
  const user     = useAuthStore(s => s.user)
  const navigate = useNavigate()
  const location = useLocation()

  const [expanded,     setExpanded]     = useState(false)
  const [status,       setStatus]       = useState('offline')
  const [uptime,       setUptime]       = useState(null)
  const [growth,       setGrowth]       = useState(null)
  const [toast,        setToast]        = useState(null)   // { text, type }
  const [chatInput,    setChatInput]    = useState('')
  const [chatReply,    setChatReply]    = useState(null)
  const [chatLoading,  setChatLoading]  = useState(false)
  const [suggIdx,      setSuggIdx]      = useState(0)

  const panelRef   = useRef(null)
  const toastTimer = useRef(null)
  const suggTimer  = useRef(null)
  const isVisible  = usePageVisibility()

  const pageCtx = PAGE_CONTEXT[location.pathname] ?? {
    label: 'App', emoji: '⚡',
    suggestions: ['How can I make more informed trading decisions?', 'Show me system status', 'What features are available?'],
  }

  // ── System health polling ─────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return
    let mounted = true
    async function poll() {
      if (!mounted) return
      try {
        const [health, g] = await Promise.allSettled([
          apiFetch('/api/jarvis/node-health'),
          apiFetch('/api/growth-worker/status'),
        ])
        if (!mounted) return
        if (health.status === 'fulfilled') {
          setStatus('healthy')
          setUptime(health.value.uptime_human)
        }
        if (g.status === 'fulfilled') setGrowth(g.value)
      } catch {
        if (mounted) setStatus('offline')
      }
    }

    // Only poll when tab is visible
    if (!isVisible) return

    poll()  // immediate on visibility restore
    const t = setInterval(poll, 20_000)
    return () => { mounted = false; clearInterval(t) }
  }, [token, isVisible])

  // ── Proactive suggestion toasts ───────────────────────────────────────────
  // Show a contextual hint ~30s after landing on a new page
  useEffect(() => {
    clearTimeout(suggTimer.current)
    setChatReply(null)
    setSuggIdx(0)
    if (!token) return

    suggTimer.current = setTimeout(() => {
      const suggs = pageCtx.suggestions
      if (!suggs?.length) return
      // Show market-aware toast
      const marketMsg = isMarketOpen()
        ? `Market is open. ${suggs[0]}`
        : `Market closed. ${suggs[0]}`
      showToast(marketMsg, 'info')
    }, 35_000)   // 35s — enough time to settle on the page

    return () => clearTimeout(suggTimer.current)
  }, [location.pathname, token]) // eslint-disable-line react-hooks/exhaustive-deps

  function showToast(text, type = 'info') {
    clearTimeout(toastTimer.current)
    setToast({ text, type })
    toastTimer.current = setTimeout(() => setToast(null), 8000)
  }

  // ── Quick chat ────────────────────────────────────────────────────────────
  const sendQuickChat = useCallback(async (msg) => {
    if (!msg.trim() || chatLoading) return
    setChatLoading(true)
    setChatReply(null)
    try {
      const data = await brainChat(
        `[Context: user is on the ${pageCtx.label} page] ${msg}`,
        null, false, token
      )
      const reply = data.result ?? data.response ?? 'I\'m processing that...'
      setChatReply(reply.slice(0, 280) + (reply.length > 280 ? '…' : ''))
    } catch {
      setChatReply('AI backend offline — start the Python server to enable full JARVIS.')
    } finally {
      setChatLoading(false)
      setChatInput('')
    }
  }, [chatLoading, pageCtx.label, token])

  // ── Close on outside click ────────────────────────────────────────────────
  useEffect(() => {
    if (!expanded) return
    function h(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setExpanded(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [expanded])

  if (!token) return null

  const color    = STATUS_COLOR[status]
  const suggs    = pageCtx.suggestions
  const marketOpen = isMarketOpen()

  return (
    <div className={styles.wrap} ref={panelRef}>

      {/* ── Proactive toast ── */}
      {toast && !expanded && (
        <div className={`${styles.toast} ${styles[`toast_${toast.type}`]}`}
          role="status" aria-live="polite">
          <span className={styles.toastIcon}>💡</span>
          <span className={styles.toastText}>{toast.text}</span>
          <button className={styles.toastClose} onClick={() => setToast(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* ── Expanded panel ── */}
      {expanded && (
        <div className={styles.panel} role="dialog" aria-label="JARVIS assistant panel">

          {/* Header */}
          <div className={styles.panelHeader}>
            <div className={styles.panelLeft}>
              <span className={styles.panelDot} style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
              <span className={styles.panelName}>JARVIS</span>
              <span className={styles.panelStatus} style={{ color }}>{status.toUpperCase()}</span>
            </div>
            <div className={styles.panelRight}>
              <span className={`${styles.marketPill} ${marketOpen ? styles.marketPillOpen : ''}`}>
                {marketOpen ? '● MARKET OPEN' : '○ CLOSED'}
              </span>
              <button className={styles.closeBtn} onClick={() => setExpanded(false)} aria-label="Close">×</button>
            </div>
          </div>

          {/* Page context */}
          <div className={styles.pageCtx}>
            <span className={styles.pageCtxIcon}>{pageCtx.emoji}</span>
            <span className={styles.pageCtxLabel}>You are on <strong>{pageCtx.label}</strong></span>
          </div>

          {/* System metrics */}
          <div className={styles.metrics}>
            <Metric icon="⏱" label="Uptime"  value={uptime ?? '—'} />
            <Metric icon="🔄" label="Cycles"  value={growth?.total_cycles ?? '—'} />
            <Metric icon="⚡" label="Engine"  value={status === 'healthy' ? 'ON' : 'OFF'} color={color} />
            <Metric icon="📡" label="Backend" value={status === 'offline' ? 'DOWN' : 'UP'} color={color} />
          </div>

          {/* Suggestions for this page */}
          <div className={styles.suggestionsSection}>
            <span className={styles.suggestionsLabel}>ASK JARVIS</span>
            <div className={styles.suggestions}>
              {suggs.map((s, i) => (
                <button key={i} className={styles.suggChip}
                  onClick={() => sendQuickChat(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Quick chat */}
          <div className={styles.quickChat}>
            <div className={styles.chatInputRow}>
              <input
                className={styles.chatInput}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuickChat(chatInput) } }}
                placeholder={`Ask about ${pageCtx.label}…`}
                disabled={chatLoading}
                maxLength={300}
              />
              <button className={styles.chatSend}
                onClick={() => sendQuickChat(chatInput)}
                disabled={chatLoading || !chatInput.trim()}
                aria-label="Send">
                {chatLoading ? <span className={styles.spinner} /> : '▶'}
              </button>
            </div>
            {chatReply && (
              <div className={styles.chatReply} aria-live="polite">
                <span className={styles.chatReplyIcon}>🤖</span>
                <span className={styles.chatReplyText}>{chatReply}</span>
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className={styles.footerActions}>
            <button className={styles.footerBtn} onClick={() => { navigate('/jarvis'); setExpanded(false) }}>
              Open JARVIS →
            </button>
            <button className={styles.footerBtn} onClick={() => { navigate('/predictions'); setExpanded(false) }}>
              Predict →
            </button>
          </div>
        </div>
      )}

      {/* ── Orb ── */}
      <button
        className={`${styles.orb} ${expanded ? styles.orbActive : ''}`}
        style={{ '--orb-color': color }}
        onClick={() => setExpanded(s => !s)}
        aria-label={`JARVIS — ${status}. ${pageCtx.label} context. Click to expand.`}
        title="JARVIS AI"
      >
        <span className={styles.ring1} aria-hidden="true" />
        <span className={styles.ring2} aria-hidden="true" />
        <span className={styles.core} aria-hidden="true">J</span>
        {/* Page context mini icon */}
        <span className={styles.ctxBadge} aria-hidden="true">{pageCtx.emoji}</span>
      </button>
    </div>
  )
}

function Metric({ icon, label, value, color }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricIcon}>{icon}</span>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue} style={color ? { color } : {}}>{value}</span>
    </div>
  )
}

export default JarvisOrb
