/**
 * RamaOrb — Persistent Rama AGI Conversational Interface
 *
 * Rama (राम) — named after the Hindu deity, the embodiment of virtue and wisdom.
 * The orb maintains full conversation context, speaks back, and acts autonomously.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@store/authStore.js'
import { apiFetch } from '@services/apiClient.js'
import { brainChat, newConversation } from '@services/jarvisClient.js'
import { usePageVisibility } from '@hooks/usePageVisibility.js'
import { useJarvisCommander, speak } from '@hooks/useJarvisCommander.js'
import { useVoiceCommand } from '@hooks/useVoiceCommand.js'
import styles from './JarvisOrb.module.css'

// ── Page context ──────────────────────────────────────────────────────────────
const PAGE_CONTEXT = {
  '/dashboard':             { label: 'Dashboard',       emoji: '⊞' },
  '/predictions':           { label: 'Predictions',     emoji: '🎯' },
  '/charts':                { label: 'Charts',          emoji: '📊' },
  '/ami':                   { label: 'AMI Intel',       emoji: '🧬' },
  '/multibagger':           { label: 'Multibagger',     emoji: '🚀' },
  '/backtest':              { label: 'Backtest',        emoji: '📈' },
  '/strategies':            { label: 'Strategies',     emoji: '🧩' },
  '/strategy-intelligence': { label: 'AI Intelligence', emoji: '🧠' },
  '/jarvis':                { label: 'Rama Console',    emoji: '🪔' },
  '/history':               { label: 'History',         emoji: '📋' },
  '/settings':              { label: 'Settings',        emoji: '⚙' },
  '/learn':                 { label: 'Learn',           emoji: '📚' },
}

const STATUS_META = {
  healthy:  { color: '#00ff9d', label: 'ONLINE',   glow: '0 0 22px rgba(0,255,157,0.55)' },
  degraded: { color: '#ffb700', label: 'DEGRADED', glow: '0 0 22px rgba(255,183,0,0.5)' },
  critical: { color: '#ff2d5f', label: 'CRITICAL', glow: '0 0 22px rgba(255,45,95,0.5)' },
  offline:  { color: '#3d6080', label: 'OFFLINE',  glow: '0 0 10px rgba(61,96,128,0.3)' },
}

const ORB_SIZE    = 56
const SNAP_MARGIN = 16
const STORAGE_KEY = 'rama_orb_pos'

// ── Rama personality openers per page ────────────────────────────────────────
const PAGE_GREETINGS = {
  '/dashboard':    ['Ready to serve, Sir. Markets await.', 'Shall I scan for signals?'],
  '/predictions':  ['Prediction engine standing by.', 'Tell me the symbol and I\'ll analyse it.'],
  '/charts':       ['Chart analysis mode active.', 'Which instrument shall we study?'],
  '/ami':          ['AMI intelligence feed loaded.', 'Institutional flow data is ready.'],
  '/multibagger':  ['Scanning for high-growth candidates.', 'Multibagger scanner is active.'],
  '/backtest':     ['Backtest engine ready.', 'Historical data loaded for analysis.'],
  '/jarvis':       ['Full console access granted.', 'All systems nominal. What do you need?'],
  '/learn':        ['Knowledge is power. What shall we learn today?', 'Ready to teach anything.'],
}

function isMarketOpen() {
  const now = new Date()
  const d = now.getDay(), m = now.getHours() * 60 + now.getMinutes()
  return d >= 1 && d <= 5 && m >= 555 && m <= 930
}

function loadPosition() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) } catch { return null }
}
function savePosition(pos) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)) } catch {}
}

// ── Message helpers ───────────────────────────────────────────────────────────
let _msgId = 0
function mkMsg(role, content, extra = {}) {
  return { id: ++_msgId, role, content, timestamp: Date.now(), ...extra }
}

export function JarvisOrb() {
  const token    = useAuthStore(s => s.token)
  const user     = useAuthStore(s => s.user)
  const navigate = useNavigate()
  const location = useLocation()
  const role     = user?.role ?? 'user'

  // ── Drag position ─────────────────────────────────────────────────────────
  const [pos, setPos] = useState(() => {
    const saved = loadPosition()
    return saved ?? { x: window.innerWidth - ORB_SIZE - SNAP_MARGIN, y: window.innerHeight - 200 }
  })
  const [dragging,   setDragging]   = useState(false)
  const [hasDragged, setHasDragged] = useState(false)
  const dragOffset   = useRef({ dx: 0, dy: 0 })
  const posRef       = useRef(pos)
  posRef.current     = pos

  // ── Panel & conversation state ────────────────────────────────────────────
  const [expanded,   setExpanded]   = useState(false)
  const [messages,   setMessages]   = useState([])   // full conversation history
  const [input,      setInput]      = useState('')
  const [thinking,   setThinking]   = useState(false)
  const [convId,     setConvId]     = useState(null)
  const [status,     setStatus]     = useState('offline')
  const [uptime,     setUptime]     = useState(null)
  const [voiceOn,    setVoiceOn]    = useState(false)

  const panelRef   = useRef(null)
  const orbRef     = useRef(null)
  const bottomRef  = useRef(null)
  const inputRef   = useRef(null)
  const isVisible  = usePageVisibility()

  const pageCtx  = PAGE_CONTEXT[location.pathname] ?? { label: 'App', emoji: '⚡' }
  const statusMeta = STATUS_META[status]

  // ── Drag: mouse ───────────────────────────────────────────────────────────
  const handleOrbMouseDown = useCallback(e => {
    if (e.button !== 0) return
    e.preventDefault()
    setHasDragged(false)
    const rect = orbRef.current.getBoundingClientRect()
    dragOffset.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    setDragging(true)
  }, [])

  useEffect(() => {
    if (!dragging) return
    const onMove = e => {
      const cx = Math.max(0, Math.min(window.innerWidth - ORB_SIZE, e.clientX - dragOffset.current.dx))
      const cy = Math.max(0, Math.min(window.innerHeight - ORB_SIZE, e.clientY - dragOffset.current.dy))
      setPos({ x: cx, y: cy }); setHasDragged(true)
    }
    const onUp = () => { setDragging(false); snapToEdge() }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [dragging]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleOrbTouchStart = useCallback(e => {
    if (e.touches.length !== 1) return
    const t = e.touches[0]
    setHasDragged(false)
    const rect = orbRef.current.getBoundingClientRect()
    dragOffset.current = { dx: t.clientX - rect.left, dy: t.clientY - rect.top }
    setDragging(true)
  }, [])

  useEffect(() => {
    if (!dragging) return
    const onMove = e => {
      if (e.touches.length !== 1) return
      e.preventDefault()
      const t = e.touches[0]
      const cx = Math.max(0, Math.min(window.innerWidth - ORB_SIZE, t.clientX - dragOffset.current.dx))
      const cy = Math.max(0, Math.min(window.innerHeight - ORB_SIZE, t.clientY - dragOffset.current.dy))
      setPos({ x: cx, y: cy }); setHasDragged(true)
    }
    const onEnd = () => { setDragging(false); snapToEdge() }
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
    return () => { document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onEnd) }
  }, [dragging]) // eslint-disable-line react-hooks/exhaustive-deps

  const snapToEdge = useCallback(() => {
    const { x, y } = posRef.current
    const vw = window.innerWidth, vh = window.innerHeight
    const cx = x + ORB_SIZE / 2, cy = y + ORB_SIZE / 2
    const d = { l: cx, r: vw - cx, t: cy, b: vh - cy }
    const min = Math.min(d.l, d.r, d.t, d.b)
    let s
    if (min === d.r) s = { x: vw - ORB_SIZE - SNAP_MARGIN, y: Math.max(SNAP_MARGIN, Math.min(vh - ORB_SIZE - SNAP_MARGIN, y)) }
    else if (min === d.l) s = { x: SNAP_MARGIN, y: Math.max(SNAP_MARGIN, Math.min(vh - ORB_SIZE - SNAP_MARGIN, y)) }
    else if (min === d.b) s = { x: Math.max(SNAP_MARGIN, Math.min(vw - ORB_SIZE - SNAP_MARGIN, x)), y: vh - ORB_SIZE - SNAP_MARGIN }
    else s = { x: Math.max(SNAP_MARGIN, Math.min(vw - ORB_SIZE - SNAP_MARGIN, x)), y: SNAP_MARGIN }
    setPos(s); savePosition(s)
  }, [])

  useEffect(() => { if (!dragging) savePosition(pos) }, [pos, dragging])
  useEffect(() => {
    const fn = () => setPos(p => ({ x: Math.min(p.x, window.innerWidth - ORB_SIZE - SNAP_MARGIN), y: Math.min(p.y, window.innerHeight - ORB_SIZE - SNAP_MARGIN) }))
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])

  // ── Health polling ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !isVisible) return
    let mounted = true
    const poll = async () => {
      if (!mounted) return
      try {
        const h = await apiFetch('/api/jarvis/node-health')
        if (!mounted) return
        const heapPct = h.memory?.heap_used_mb / (h.memory?.heap_total_mb || 512)
        setStatus(heapPct > 0.85 ? 'degraded' : 'healthy')
        setUptime(h.uptime_human)
      } catch { if (mounted) setStatus('offline') }
    }
    poll()
    const t = setInterval(poll, 20_000)
    return () => { mounted = false; clearInterval(t) }
  }, [token, isVisible])

  // ── JARVIS commander ──────────────────────────────────────────────────────
  const { processInput } = useJarvisCommander({
    onAction: (action, reply) => {
      window.dispatchEvent(new CustomEvent('jarvis:action', { detail: { action, reply } }))
    },
    token, enabled: !!token,
  })

  // ── Voice in the orb panel ────────────────────────────────────────────────
  useVoiceCommand({
    onCommand: ({ command, action, reply, transcript }) => {
      if (expanded && transcript) {
        // Add the voice transcript as a user message and process it
        sendMessage(transcript)
      } else if (action) {
        window.dispatchEvent(new CustomEvent('jarvis:action', { detail: { action, reply } }))
      }
    },
    enabled: voiceOn && !!token,
    token,
  })

  // ── Greeting when panel opens ─────────────────────────────────────────────
  const greetedPagesRef = useRef(new Set())

  const addJarvisGreeting = useCallback(() => {
    const pageKey = location.pathname
    if (greetedPagesRef.current.has(pageKey)) return
    greetedPagesRef.current.add(pageKey)

    const greetings = PAGE_GREETINGS[pageKey]
    const marketLine = isMarketOpen() ? ' Market is open.' : ' Market is closed.'
    const text = greetings
      ? greetings[Math.floor(Math.random() * greetings.length)] + marketLine
      : `I\'m here to help with ${pageCtx.label}.${marketLine}`

    setMessages(prev => [...prev, mkMsg('jarvis', text, { isGreeting: true })])
    speak(text)
  }, [location.pathname, pageCtx.label])

  useEffect(() => {
    if (expanded && messages.length === 0) {
      setTimeout(addJarvisGreeting, 400)
    }
  }, [expanded]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  // Close on outside click
  useEffect(() => {
    if (!expanded) return
    const h = e => {
      if (panelRef.current && !panelRef.current.contains(e.target) &&
          orbRef.current  && !orbRef.current.contains(e.target)) setExpanded(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [expanded])

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text) => {
    if (!text?.trim() || thinking) return
    const userText = text.trim()
    setInput('')
    setMessages(prev => [...prev, mkMsg('user', userText)])
    setThinking(true)

    try {
      // 1. Try local fast-path (no network, instant)
      const localResult = await processInput(userText)
      if (localResult?.action && localResult.action.type !== 'chat') {
        // Action executed — confirm it conversationally
        const confirmMsg = localResult.response ?? 'Done.'
        setMessages(prev => [...prev, mkMsg('jarvis', confirmMsg, { isAction: true, actionType: localResult.action.type })])
        speak(confirmMsg)
        return
      }

      // 2. JARVIS brain — full conversational response
      let cid = convId
      if (!cid) {
        try { const d = await newConversation(token); cid = d.conv_id; setConvId(cid) } catch {}
      }

      const resp = await brainChat(
        `[Page: ${pageCtx.label}] ${userText}`,
        cid,
        true,   // use cloud
        token
      )
      if (!convId && resp.conv_id) setConvId(resp.conv_id)

      const replyText = resp.result ?? resp.response ?? 'I\'m processing that.'
      setMessages(prev => [...prev, mkMsg('jarvis', replyText, {
        intent:   resp.intent,
        provider: resp.provider,
        steps:    resp.steps ?? [],
      })])
      speak(replyText.replace(/\*\*/g,'').replace(/\*/g,'').replace(/`[^`]+`/g, '').split('\n')[0].slice(0, 180))

    } catch {
      const offline = 'My AI backend is offline. Start the Python server to enable full reasoning. I can still execute commands locally.'
      setMessages(prev => [...prev, mkMsg('jarvis', offline, { isError: true })])
      speak('AI backend offline.')
    } finally {
      setThinking(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [thinking, token, convId, pageCtx.label, processInput])

  // ── Clear conversation ────────────────────────────────────────────────────
  function clearConversation() {
    setMessages([])
    setConvId(null)
    greetedPagesRef.current.clear()
    setTimeout(addJarvisGreeting, 300)
  }

  // ── Panel placement ───────────────────────────────────────────────────────
  const panelRight  = pos.x + ORB_SIZE / 2 > window.innerWidth  / 2
  const panelBottom = pos.y + ORB_SIZE / 2 > window.innerHeight / 2

  if (!token) return null

  const orbStyle = {
    left:  `${pos.x}px`,
    top:   `${pos.y}px`,
    cursor: dragging ? 'grabbing' : 'grab',
    '--orb-color': statusMeta.color,
    '--orb-glow':  statusMeta.glow,
    transition: dragging ? 'none' : 'left 0.3s cubic-bezier(0.34,1.56,0.64,1), top 0.3s cubic-bezier(0.34,1.56,0.64,1)',
  }

  const panelStyle = {
    position: 'fixed', zIndex: 451,
    ...(panelRight  ? { right:  `${window.innerWidth  - pos.x - ORB_SIZE}px`  } : { left:   `${pos.x}px` }),
    ...(panelBottom ? { bottom: `${window.innerHeight - pos.y + 8}px` }          : { top:    `${pos.y + ORB_SIZE + 8}px` }),
  }

  return (
    <>
      {/* ── Conversation panel ── */}
      {expanded && (
        <div className={styles.panel} ref={panelRef} style={panelStyle} role="dialog" aria-label="JARVIS conversation">

          {/* Header */}
          <div className={styles.panelHeader}>
            <div className={styles.panelLeft}>
              <span className={styles.statusDot} style={{ background: statusMeta.color, boxShadow: statusMeta.glow }} />
              <span className={styles.panelName}>RAMA</span>
              <span className={styles.panelStatusLabel} style={{ color: statusMeta.color }}>{statusMeta.label}</span>
              <span className={styles.pageTag}>{pageCtx.emoji} {pageCtx.label}</span>
            </div>
            <div className={styles.panelRight}>
              <span className={`${styles.marketPill} ${isMarketOpen() ? styles.marketOpen : ''}`}>
                {isMarketOpen() ? '● OPEN' : '○ CLOSED'}
              </span>
              <button className={styles.clearBtn} onClick={clearConversation} title="Clear conversation" aria-label="Clear">↺</button>
              <button className={styles.closeBtn} onClick={() => setExpanded(false)} aria-label="Close">×</button>
            </div>
          </div>

          {/* Conversation messages */}
          <div className={styles.messages} aria-live="polite">
            {messages.map(msg => (
              <Message key={msg.id} msg={msg} />
            ))}

            {thinking && (
              <div className={styles.thinkingRow}>
                <div className={styles.thinkingOrb}>R</div>
                <div className={styles.thinkingDots}>
                  <span /><span /><span />
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input row */}
          <div className={styles.inputRow}>
            <button
              className={`${styles.voiceBtn} ${voiceOn ? styles.voiceBtnOn : ''}`}
              onClick={() => setVoiceOn(v => !v)}
              title={voiceOn ? 'Voice on — say Hey JARVIS' : 'Enable voice'}
              aria-label="Voice"
            >
              {voiceOn ? '🎙' : '🎤'}
            </button>
            <input
              ref={inputRef}
              className={styles.chatInput}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
              placeholder={thinking ? 'JARVIS is thinking…' : 'Ask anything or give a command…'}
              disabled={thinking}
              maxLength={500}
              autoFocus
            />
            <button
              className={styles.sendBtn}
              onClick={() => sendMessage(input)}
              disabled={thinking || !input.trim()}
              aria-label="Send"
            >
              {thinking ? <span className={styles.spinner} /> : '▶'}
            </button>
          </div>

          {/* Uptime footer */}
          {uptime && (
            <div className={styles.panelFooter}>
              ⏱ {uptime} uptime · {role === 'super-admin' ? '👑 AGI' : role === 'admin' ? '⚡ Admin' : '🪔 Rama'}
            </div>
          )}
        </div>
      )}

      {/* ── Orb ── */}
      <div
        ref={orbRef}
        className={`${styles.orb} ${expanded ? styles.orbActive : ''} ${dragging ? styles.orbDragging : ''}`}
        style={orbStyle}
        onMouseDown={handleOrbMouseDown}
        onTouchStart={handleOrbTouchStart}
        onClick={() => { if (!hasDragged) setExpanded(s => !s) }}
        role="button"
        tabIndex={0}
        aria-label={`JARVIS — ${statusMeta.label}. Click to chat.`}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setExpanded(s => !s) }}
      >
        <span className={styles.ring1} aria-hidden="true" />
        <span className={styles.ring2} aria-hidden="true" />
        <span className={styles.core} aria-hidden="true">R</span>
        <span className={styles.statusBadge}
          style={{ background: statusMeta.color, boxShadow: `0 0 6px ${statusMeta.color}` }}
          aria-hidden="true" />
        <span className={styles.ctxBadge} aria-hidden="true">{pageCtx.emoji}</span>
        {/* Unread indicator when panel is closed and there are messages */}
        {!expanded && messages.length > 0 && (
          <span className={styles.unreadDot} aria-hidden="true" />
        )}
      </div>
    </>
  )
}

// ── Message bubble ────────────────────────────────────────────────────────────
function Message({ msg }) {
  if (msg.role === 'user') {
    return (
      <div className={styles.userMsgRow}>
        <div className={styles.userBubble}>{msg.content}</div>
      </div>
    )
  }

  // JARVIS message
  return (
    <div className={styles.jarvisMsgRow}>
      <div className={styles.jarvisMsgIcon}>R</div>
      <div className={`${styles.jarvisBubble} ${msg.isAction ? styles.jarvisBubbleAction : ''} ${msg.isError ? styles.jarvisBubbleError : ''}`}>
        <RenderContent content={msg.content} />
        {msg.intent && msg.intent !== 'UNKNOWN' && !msg.isGreeting && (
          <span className={styles.intentTag}>{msg.intent.toLowerCase().replace(/_/g, ' ')}</span>
        )}
        {msg.provider && msg.provider !== 'safety' && (
          <span className={styles.providerTag}>{msg.provider}</span>
        )}
      </div>
    </div>
  )
}

// Simple inline markdown renderer
function RenderContent({ content }) {
  if (!content) return null
  // Split on code blocks
  const parts = content.split(/(```[\s\S]*?```)/g)
  return (
    <div className={styles.msgContent}>
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const lines = part.slice(3).split('\n')
          const code  = lines.slice(1, -1).join('\n')
          return (
            <pre key={i} className={styles.codeBlock}>
              <code>{code}</code>
            </pre>
          )
        }
        // Render line by line with basic markdown
        return part.split('\n').map((line, j) => {
          if (!line.trim()) return null
          if (line.startsWith('### ')) return <p key={`${i}-${j}`} className={styles.h3}>{line.slice(4)}</p>
          if (line.startsWith('## '))  return <p key={`${i}-${j}`} className={styles.h2}>{line.slice(3)}</p>
          if (line.startsWith('# '))   return <p key={`${i}-${j}`} className={styles.h1}>{line.slice(2)}</p>
          if (line.startsWith('- ') || line.startsWith('• ')) return <p key={`${i}-${j}`} className={styles.bullet}>{inlineFormat(line.slice(2))}</p>
          return <p key={`${i}-${j}`} className={styles.para}>{inlineFormat(line)}</p>
        })
      })}
    </div>
  )
}

function inlineFormat(text) {
  // **bold**, *italic*, `code`
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2,-2)}</strong>
    if (p.startsWith('*')  && p.endsWith('*'))  return <em key={i}>{p.slice(1,-1)}</em>
    if (p.startsWith('`')  && p.endsWith('`'))  return <code key={i} className={styles.inlineCode}>{p.slice(1,-1)}</code>
    return p
  })
}

export default JarvisOrb
