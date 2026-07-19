/**
 * JarvisOrb — Persistent JARVIS AI Presence
 *
 * Features:
 *   - Draggable to any screen position (mouse + touch)
 *   - Snaps to nearest screen edge on release
 *   - Position persisted in localStorage
 *   - Online/offline/degraded status badge on orb (color + label)
 *   - Real-time status pulse — orb glow changes with system health
 *   - Page-context awareness — different suggestions per route
 *   - Quick chat inline, proactive suggestion toasts
 *   - Panel opens toward the center of screen (avoids edge clipping)
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@store/authStore.js'
import { apiFetch } from '@services/apiClient.js'
import { brainChat } from '@services/jarvisClient.js'
import { usePageVisibility } from '@hooks/usePageVisibility.js'
import styles from './JarvisOrb.module.css'

// ── Page context ──────────────────────────────────────────────────────────────
const PAGE_CONTEXT = {
  '/dashboard':            { label: 'Dashboard',       emoji: '⊞',  suggestions: ['Generate signals for the active symbol', 'What are the best opportunities right now?', 'Show today\'s market overview'] },
  '/predictions':          { label: 'Predictions',     emoji: '🎯', suggestions: ['Explain the top signal', 'What does grade A+ mean?', 'Is the current R:R ratio good?'] },
  '/charts':               { label: 'Charts',          emoji: '📊', suggestions: ['What indicators should I use for intraday?', 'Explain Supertrend', 'What does a Bollinger squeeze mean?'] },
  '/ami':                  { label: 'AMI Intel',       emoji: '🧬', suggestions: ['Explain AMI signals', 'What is institutional flow?', 'Show dark pool indicators'] },
  '/multibagger':          { label: 'Multibagger',     emoji: '🚀', suggestions: ['What makes a multibagger?', 'How is the scanner scoring stocks?', 'Explain the fundamental filters'] },
  '/backtest':             { label: 'Backtest',        emoji: '📈', suggestions: ['What is walk-forward testing?', 'Explain the accuracy threshold', 'How do I interpret backtest results?'] },
  '/strategies':           { label: 'Strategies',     emoji: '🧩', suggestions: ['Create a momentum strategy', 'Explain swing trading', 'What strategy fits current market?'] },
  '/strategy-intelligence':{ label: 'AI Intelligence', emoji: '🧠', suggestions: ['Run a full strategy analysis', 'Compare momentum vs mean reversion', 'Which strategy has best accuracy?'] },
  '/jarvis':               { label: 'JARVIS',          emoji: '🤖', suggestions: ['Show system health', 'What can you do?', 'Scan for issues'] },
  '/history':              { label: 'History',         emoji: '📋', suggestions: ['How accurate were my past predictions?', 'Show my best performing signals', 'What patterns do I miss most?'] },
  '/settings':             { label: 'Settings',        emoji: '⚙',  suggestions: ['Explain the prediction modes', 'How do I change my risk settings?', 'What does night light do?'] },
  '/learn':                { label: 'Learn',           emoji: '📚', suggestions: ['Teach me about RSI', 'Explain support and resistance', 'What is options delta?'] },
}

const STATUS_META = {
  healthy:  { color: '#00ff9d', label: 'ONLINE',   glow: '0 0 20px rgba(0,255,157,0.5)' },
  degraded: { color: '#ffb700', label: 'DEGRADED', glow: '0 0 20px rgba(255,183,0,0.5)' },
  critical: { color: '#ff2d5f', label: 'CRITICAL', glow: '0 0 20px rgba(255,45,95,0.5)' },
  offline:  { color: '#3d6080', label: 'OFFLINE',  glow: '0 0 10px rgba(61,96,128,0.3)' },
}

const ORB_SIZE  = 56   // px
const SNAP_MARGIN = 16  // px from edge after snap
const STORAGE_KEY = 'jarvis_orb_pos'

function isMarketOpen() {
  const now = new Date()
  const d = now.getDay(), m = now.getHours() * 60 + now.getMinutes()
  return d >= 1 && d <= 5 && m >= 555 && m <= 930
}

function loadPosition() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return null
}

function savePosition(pos) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)) } catch {}
}

// ── Main component ────────────────────────────────────────────────────────────

export function JarvisOrb() {
  const token    = useAuthStore(s => s.token)
  const navigate = useNavigate()
  const location = useLocation()

  // ── Position / drag state ────────────────────────────────────────────────
  // pos = { x, y } in pixels from top-left of viewport
  const [pos,       setPos]       = useState(() => {
    const saved = loadPosition()
    if (saved) return saved
    // Default: bottom-right
    return {
      x: window.innerWidth  - ORB_SIZE - SNAP_MARGIN,
      y: window.innerHeight - ORB_SIZE - SNAP_MARGIN - 80,
    }
  })
  const [dragging,  setDragging]  = useState(false)
  const [hasDragged, setHasDragged] = useState(false) // distinguish click vs drag
  const dragOffset  = useRef({ dx: 0, dy: 0 })
  const posRef      = useRef(pos)
  posRef.current    = pos

  // ── UI state ─────────────────────────────────────────────────────────────
  const [expanded,    setExpanded]    = useState(false)
  const [status,      setStatus]      = useState('offline')
  const [uptime,      setUptime]      = useState(null)
  const [growth,      setGrowth]      = useState(null)
  const [toast,       setToast]       = useState(null)
  const [chatInput,   setChatInput]   = useState('')
  const [chatReply,   setChatReply]   = useState(null)
  const [chatLoading, setChatLoading] = useState(false)

  const panelRef   = useRef(null)
  const orbRef     = useRef(null)
  const wrapRef    = useRef(null)
  const toastTimer = useRef(null)
  const suggTimer  = useRef(null)
  const isVisible  = usePageVisibility()

  const pageCtx = PAGE_CONTEXT[location.pathname] ?? {
    label: 'App', emoji: '⚡',
    suggestions: ['How can I make better trading decisions?', 'Show me system status', 'What features are available?'],
  }
  const statusMeta = STATUS_META[status]

  // ── Drag: mouse ───────────────────────────────────────────────────────────
  const handleOrbMouseDown = useCallback((e) => {
    // Only left button, not clicking buttons inside the orb
    if (e.button !== 0) return
    e.preventDefault()
    setHasDragged(false)
    const rect = orbRef.current.getBoundingClientRect()
    dragOffset.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
    }
    setDragging(true)
  }, [])

  useEffect(() => {
    if (!dragging) return

    function onMouseMove(e) {
      const nx = e.clientX - dragOffset.current.dx
      const ny = e.clientY - dragOffset.current.dy
      // Clamp to viewport
      const cx = Math.max(0, Math.min(window.innerWidth  - ORB_SIZE, nx))
      const cy = Math.max(0, Math.min(window.innerHeight - ORB_SIZE, ny))
      setPos({ x: cx, y: cy })
      setHasDragged(true)
    }

    function onMouseUp() {
      setDragging(false)
      snapToEdge()
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [dragging]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drag: touch ───────────────────────────────────────────────────────────
  const handleOrbTouchStart = useCallback((e) => {
    if (e.touches.length !== 1) return
    const touch = e.touches[0]
    setHasDragged(false)
    const rect = orbRef.current.getBoundingClientRect()
    dragOffset.current = {
      dx: touch.clientX - rect.left,
      dy: touch.clientY - rect.top,
    }
    setDragging(true)
  }, [])

  useEffect(() => {
    if (!dragging) return

    function onTouchMove(e) {
      if (e.touches.length !== 1) return
      e.preventDefault()
      const touch = e.touches[0]
      const nx = touch.clientX - dragOffset.current.dx
      const ny = touch.clientY - dragOffset.current.dy
      const cx = Math.max(0, Math.min(window.innerWidth  - ORB_SIZE, nx))
      const cy = Math.max(0, Math.min(window.innerHeight - ORB_SIZE, ny))
      setPos({ x: cx, y: cy })
      setHasDragged(true)
    }

    function onTouchEnd() {
      setDragging(false)
      snapToEdge()
    }

    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend',  onTouchEnd)
    return () => {
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend',  onTouchEnd)
    }
  }, [dragging]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Snap to nearest edge ──────────────────────────────────────────────────
  const snapToEdge = useCallback(() => {
    const { x, y } = posRef.current
    const vw = window.innerWidth
    const vh = window.innerHeight
    const cx = x + ORB_SIZE / 2
    const cy = y + ORB_SIZE / 2

    // Distances to each edge
    const dLeft   = cx
    const dRight  = vw - cx
    const dTop    = cy
    const dBottom = vh - cy

    const minDist = Math.min(dLeft, dRight, dTop, dBottom)
    let snapped

    if (minDist === dRight) {
      snapped = { x: vw - ORB_SIZE - SNAP_MARGIN, y: Math.max(SNAP_MARGIN, Math.min(vh - ORB_SIZE - SNAP_MARGIN, y)) }
    } else if (minDist === dLeft) {
      snapped = { x: SNAP_MARGIN, y: Math.max(SNAP_MARGIN, Math.min(vh - ORB_SIZE - SNAP_MARGIN, y)) }
    } else if (minDist === dBottom) {
      snapped = { x: Math.max(SNAP_MARGIN, Math.min(vw - ORB_SIZE - SNAP_MARGIN, x)), y: vh - ORB_SIZE - SNAP_MARGIN }
    } else {
      snapped = { x: Math.max(SNAP_MARGIN, Math.min(vw - ORB_SIZE - SNAP_MARGIN, x)), y: SNAP_MARGIN }
    }

    setPos(snapped)
    savePosition(snapped)
  }, [])

  // Save position after snapping
  useEffect(() => {
    if (!dragging) savePosition(pos)
  }, [pos, dragging])

  // Handle window resize — keep orb in viewport
  useEffect(() => {
    function onResize() {
      setPos(prev => ({
        x: Math.min(prev.x, window.innerWidth  - ORB_SIZE - SNAP_MARGIN),
        y: Math.min(prev.y, window.innerHeight - ORB_SIZE - SNAP_MARGIN),
      }))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ── System health polling ─────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !isVisible) return
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
          const h = health.value
          // Determine degraded vs healthy
          const heapPct = h.memory?.heap_used_mb / (h.memory?.heap_total_mb || 512)
          setStatus(heapPct > 0.85 ? 'degraded' : 'healthy')
          setUptime(h.uptime_human)
        } else {
          setStatus('offline')
        }
        if (g.status === 'fulfilled') setGrowth(g.value)
      } catch {
        if (mounted) setStatus('offline')
      }
    }

    poll()
    const t = setInterval(poll, 20_000)
    return () => { mounted = false; clearInterval(t) }
  }, [token, isVisible])

  // ── Proactive suggestion toasts ───────────────────────────────────────────
  useEffect(() => {
    clearTimeout(suggTimer.current)
    setChatReply(null)
    if (!token) return
    suggTimer.current = setTimeout(() => {
      const s = pageCtx.suggestions[0]
      if (!s) return
      const prefix = isMarketOpen() ? 'Market open.' : 'Market closed.'
      showToast(`${prefix} ${s}`, 'info')
    }, 35_000)
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
        `[Context: ${pageCtx.label} page] ${msg}`,
        null, false, token
      )
      const reply = data.result ?? data.response ?? 'Processing…'
      setChatReply(reply.slice(0, 300) + (reply.length > 300 ? '…' : ''))
    } catch {
      setChatReply('AI backend offline. Start the Python server to enable JARVIS.')
    } finally {
      setChatLoading(false)
      setChatInput('')
    }
  }, [chatLoading, pageCtx.label, token])

  // ── Close panel on outside click ─────────────────────────────────────────
  useEffect(() => {
    if (!expanded) return
    function h(e) {
      if (panelRef.current && !panelRef.current.contains(e.target) &&
          orbRef.current  && !orbRef.current.contains(e.target)) {
        setExpanded(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [expanded])

  // ── Panel direction — open toward center of screen ────────────────────────
  const panelRight  = pos.x + ORB_SIZE / 2 > window.innerWidth  / 2
  const panelBottom = pos.y + ORB_SIZE / 2 > window.innerHeight / 2

  if (!token) return null

  const orbStyle = {
    left:     `${pos.x}px`,
    top:      `${pos.y}px`,
    cursor:   dragging ? 'grabbing' : 'grab',
    '--orb-color':  statusMeta.color,
    '--orb-glow':   statusMeta.glow,
    // During drag: no transition so it feels instant
    transition: dragging ? 'none' : 'left 0.3s cubic-bezier(0.34,1.56,0.64,1), top 0.3s cubic-bezier(0.34,1.56,0.64,1)',
  }

  const panelStyle = {
    // Position panel toward center
    ...(panelRight  ? { right: `${window.innerWidth  - pos.x - ORB_SIZE}px`  } : { left:   `${pos.x}px` }),
    ...(panelBottom ? { bottom: `${window.innerHeight - pos.y + 8}px`          } : { top:    `${pos.y + ORB_SIZE + 8}px` }),
  }

  return (
    <>
      {/* ── Proactive toast (always near orb) ── */}
      {toast && !expanded && (
        <div
          className={`${styles.toast} ${styles[`toast_${toast.type}`]}`}
          style={{
            position: 'fixed',
            zIndex: 449,
            ...(panelRight ? { right: `${window.innerWidth - pos.x - ORB_SIZE}px` } : { left: `${pos.x}px` }),
            ...(panelBottom ? { bottom: `${window.innerHeight - pos.y + 8}px` } : { top: `${pos.y + ORB_SIZE + 8}px` }),
          }}
          role="status" aria-live="polite"
        >
          <span className={styles.toastIcon}>💡</span>
          <span className={styles.toastText}>{toast.text}</span>
          <button className={styles.toastClose} onClick={() => setToast(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* ── Expanded panel ── */}
      {expanded && (
        <div
          className={styles.panel}
          ref={panelRef}
          style={{ position: 'fixed', zIndex: 451, ...panelStyle }}
          role="dialog"
          aria-label="JARVIS assistant panel"
        >
          {/* Drag hint row at top of panel */}
          <div className={styles.panelHeader}>
            <div className={styles.panelLeft}>
              <span className={styles.statusDot} style={{ background: statusMeta.color, boxShadow: statusMeta.glow }} />
              <span className={styles.panelName}>JARVIS</span>
              <span className={styles.panelStatus} style={{ color: statusMeta.color }}>
                {statusMeta.label}
              </span>
            </div>
            <div className={styles.panelRight}>
              <span className={`${styles.marketPill} ${isMarketOpen() ? styles.marketOpen : ''}`}>
                {isMarketOpen() ? '● OPEN' : '○ CLOSED'}
              </span>
              <button className={styles.closeBtn} onClick={() => setExpanded(false)} aria-label="Close">×</button>
            </div>
          </div>

          {/* Page context */}
          <div className={styles.pageCtx}>
            <span>{pageCtx.emoji}</span>
            <span className={styles.pageCtxLabel}>
              On <strong>{pageCtx.label}</strong>
            </span>
            <span className={styles.uptime}>{uptime ? `⏱ ${uptime}` : ''}</span>
          </div>

          {/* Status metrics */}
          <div className={styles.metrics}>
            <Metric icon="⚡" label="Engine"  value={status === 'healthy' ? 'ACTIVE' : status === 'offline' ? 'OFFLINE' : status.toUpperCase()} color={statusMeta.color} />
            <Metric icon="🔄" label="Cycles"  value={growth?.total_cycles ?? '—'} />
            <Metric icon="📡" label="Backend" value={status === 'offline' ? 'DOWN' : 'UP'} color={statusMeta.color} />
            <Metric icon="🎯" label="Symbols" value={growth?.symbols_tracked ?? '—'} />
          </div>

          {/* Suggestions */}
          <div className={styles.suggestionsSection}>
            <span className={styles.suggestionsLabel}>ASK JARVIS</span>
            {pageCtx.suggestions.map((s, i) => (
              <button key={i} className={styles.suggChip} onClick={() => sendQuickChat(s)}>
                {s}
              </button>
            ))}
          </div>

          {/* Quick chat */}
          <div className={styles.quickChat}>
            <div className={styles.chatRow}>
              <input
                className={styles.chatInput}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendQuickChat(chatInput) } }}
                placeholder={`Ask about ${pageCtx.label}…`}
                disabled={chatLoading}
                maxLength={300}
                autoFocus
              />
              <button
                className={styles.chatSend}
                onClick={() => sendQuickChat(chatInput)}
                disabled={chatLoading || !chatInput.trim()}
              >
                {chatLoading ? <span className={styles.spinner} /> : '▶'}
              </button>
            </div>
            {chatReply && (
              <div className={styles.chatReply}>
                <span>🤖</span>
                <span>{chatReply}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className={styles.panelFooter}>
            <button className={styles.footerBtn} onClick={() => { navigate('/jarvis'); setExpanded(false) }}>
              JARVIS Console
            </button>
            <button className={styles.footerBtn} onClick={() => { navigate('/predictions'); setExpanded(false) }}>
              Predict Now
            </button>
          </div>
        </div>
      )}

      {/* ── Orb (draggable) ── */}
      <div
        ref={orbRef}
        className={`${styles.orb} ${expanded ? styles.orbActive : ''} ${dragging ? styles.orbDragging : ''}`}
        style={orbStyle}
        onMouseDown={handleOrbMouseDown}
        onTouchStart={handleOrbTouchStart}
        onClick={() => {
          // Only toggle if it was a click not a drag
          if (!hasDragged) setExpanded(s => !s)
        }}
        role="button"
        tabIndex={0}
        aria-label={`JARVIS — ${statusMeta.label}. ${pageCtx.label}. Click to expand, drag to move.`}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setExpanded(s => !s) }}
      >
        {/* Spinning rings */}
        <span className={styles.ring1} aria-hidden="true" />
        <span className={styles.ring2} aria-hidden="true" />

        {/* Core J */}
        <span className={styles.core} aria-hidden="true">J</span>

        {/* Online status badge — bottom-left of orb */}
        <span
          className={styles.statusBadge}
          style={{ background: statusMeta.color, boxShadow: `0 0 6px ${statusMeta.color}` }}
          aria-hidden="true"
          title={statusMeta.label}
        />

        {/* Page context icon — top-right */}
        <span className={styles.ctxBadge} aria-hidden="true">{pageCtx.emoji}</span>
      </div>
    </>
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
