/**
 * JarvisChat — Role-differentiated conversational AI interface.
 *
 * super-admin → Full AGI: web search, code ops, self-improvement, unrestricted
 * admin       → Advanced chatbot: market intelligence, system monitoring
 * user        → Educational chatbot: market Q&A with disclaimers
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '@store/authStore.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import {
  brainChat, brainFeedback, newConversation,
  agiExecute, fetchAGICapabilities, agiFeedback,
  approveJarvisAction, issueApprovalToken,
  triggerSelfOptimize,
} from '@services/jarvisClient.js'
import styles from './JarvisChat.module.css'

// ── Role config ───────────────────────────────────────────────────────────────

const ROLE_CONFIG = {
  'super-admin': {
    label:       'Super-Admin AGI Mode',
    badge:       '👑 AGI',
    badgeColor:  '#a855f7',
    placeholder: 'Tell Rama anything — search the web, modify code, optimize itself…',
    quickPrompts: [
      { label: '🔍 Web search',       text: 'Search the web for latest LightGBM improvements for financial time series' },
      { label: '🧠 Improve accuracy', text: 'Analyze current ML accuracy, search for improvements, and propose upgrades' },
      { label: '⚙ Add feature',      text: 'Add a real-time portfolio P&L tracker page' },
      { label: '🎨 New theme',        text: 'Create a Stark JARVIS inspired theme with red gold accents' },
      { label: '📦 Security scan',    text: 'Scan all dependencies for vulnerabilities, find patches, propose upgrades' },
      { label: '🔧 Self-optimize',    text: 'Analyze your own response quality and improve your reasoning' },
      { label: '📊 System deep dive', text: 'Full system audit: code health, ML drift, dependency vulnerabilities' },
      { label: '🌐 Market research',  text: 'Search web for current NIFTY50 market analysis and macro outlook' },
    ],
    canSelfOptimize: true,
    canExecuteCode:  true,
    useAgent:        true,
  },
  'admin': {
    label:       'Admin Intelligence Mode',
    badge:       '⚡ Admin',
    badgeColor:  '#00d4ff',
    placeholder: 'Ask about markets, strategies, system health, prediction analysis…',
    quickPrompts: [
      { label: '📊 Market overview',  text: 'What is the current market regime and key indicators to watch?' },
      { label: '🎯 Signal analysis',  text: 'How do I interpret A+ vs B grade signals?' },
      { label: '📈 Strategy help',    text: 'What strategy fits a sideways market with low volatility?' },
      { label: '🖥️ System health',   text: 'What is the current system health and ML accuracy?' },
      { label: '📉 Backtest tips',    text: 'How do I interpret walk-forward backtest results?' },
      { label: '🔍 Indicator guide',  text: 'When should I use Supertrend vs EMA crossover?' },
    ],
    canSelfOptimize: false,
    canExecuteCode:  false,
    useAgent:        false,
  },
  'user': {
    label:       'Rama Market Assistant',
    badge:       '🪔 Rama',
    badgeColor:  '#00ff9d',
    placeholder: 'Ask about signals, indicators, market analysis, trading concepts…',
    quickPrompts: [
      { label: '❓ What is RSI?',        text: 'Explain RSI and how to use it for trading decisions' },
      { label: '📈 Read a signal',       text: 'How do I read and act on a prediction signal?' },
      { label: '📊 MACD explained',      text: 'What is MACD and what does a crossover mean?' },
      { label: '🛡 Risk management',     text: 'How should I manage risk with stop-loss orders?' },
      { label: '🕯 Candlestick basics',  text: 'Explain the most important candlestick patterns' },
      { label: '🧠 AI predictions',      text: 'How does the AI generate market predictions?' },
    ],
    canSelfOptimize: false,
    canExecuteCode:  false,
    useAgent:        false,
  },
}

const PROVIDER_COLORS = {
  openai:    '#10a37f',
  anthropic: '#d97706',
  gemini:    '#4285f4',
  groq:      '#f43f5e',
  local:     'var(--color-text-muted)',
}
const PROVIDER_LABELS = {
  openai:    'GPT-4o',
  anthropic: 'Claude',
  gemini:    'Gemini',
  groq:      'Llama',
  local:     'Local',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function JarvisChat({ token }) {
  const user     = useAuthStore(s => s.user)
  const role     = user?.role ?? 'user'
  const cfg      = ROLE_CONFIG[role] ?? ROLE_CONFIG['user']
  const isSuperAdmin = role === 'super-admin'

  const [messages,      setMessages]      = useState([])
  const [input,         setInput]         = useState('')
  const [loading,       setLoading]       = useState(false)
  const [convId,        setConvId]        = useState(null)
  const [useAgent,      setUseAgent]      = useState(cfg.useAgent)
  const [useCloud,      setUseCloud]      = useState(true)
  const [capabilities,  setCapabilities]  = useState(null)
  const [error,         setError]         = useState('')
  const [selfOptLoading, setSelfOptLoading] = useState(false)
  const [selfOptResult,  setSelfOptResult]  = useState(null)

  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => {
    if (!token) return
    fetchAGICapabilities(token).then(setCapabilities).catch(() => {})
  }, [token])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleNewConversation() {
    try {
      const data = await newConversation(token)
      setConvId(data.conv_id)
      setMessages([])
    } catch {
      setConvId(null)
      setMessages([])
    }
  }

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading) return
    setError('')

    const userMsg = { id: Date.now(), role: 'user', content: text.trim(), timestamp: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      let response

      if (isSuperAdmin && useAgent) {
        // Super-admin: full AGI ReAct loop
        response = await agiExecute(text.trim(), convId, true, token)
        if (!convId && response.conv_id) setConvId(response.conv_id)
      } else {
        // Admin / User: brain chat (role-restricted on Python side)
        response = await brainChat(text.trim(), convId, useCloud, token)
        if (!convId && response.conv_id) setConvId(response.conv_id)
      }

      const assistantMsg = {
        id:               Date.now() + 1,
        role:             'assistant',
        content:          response.result ?? response.response ?? 'No response',
        timestamp:        Date.now(),
        intent:           response.intent,
        confidence:       response.confidence,
        provider:         response.provider ?? response.active_provider,
        mode:             response.mode,
        agent:            response.agent,
        steps:            response.steps ?? [],
        pending_approvals: response.pending_approvals ?? [],
        suggestions:      response.suggestions ?? [],
        actions:          response.actions ?? [],
        safety_warnings:  response.safety_warnings ?? [],
        was_filtered:     response.was_filtered ?? false,
        role_mode:        response.role_mode ?? role,
      }
      setMessages(prev => [...prev, assistantMsg])

    } catch (err) {
      const msg = err?.message ?? 'Connection failed'
      setError(msg)
      setMessages(prev => [...prev, {
        id: Date.now() + 1, role: 'error', content: msg, timestamp: Date.now()
      }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }, [loading, convId, useAgent, useCloud, token, isSuperAdmin, role])

  async function handleFeedback(msg, feedback) {
    try {
      if (useAgent && isSuperAdmin) {
        await agiFeedback(msg.content, feedback, msg.intent ?? '', token)
      } else {
        const idx = messages.findIndex(m => m.id === msg.id)
        if (convId && idx >= 0) {
          await brainFeedback(convId, idx, feedback, msg.intent ?? '', token)
        }
      }
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, feedback } : m))
    } catch {}
  }

  async function handleSelfOptimize() {
    if (!isSuperAdmin) return
    setSelfOptLoading(true)
    setSelfOptResult(null)
    try {
      const result = await triggerSelfOptimize(token)
      setSelfOptResult(result)
      // Show in chat as a system message
      setMessages(prev => [...prev, {
        id:        Date.now(),
        role:      'system',
        content:   result.status === 'proposal_generated'
          ? `🧠 **Self-optimization proposal:**\n\n${result.proposal}\n\n*Acceptance rate: ${result.insights?.acceptance_rate}%*`
          : `Self-optimization: ${result.status}. ${result.message ?? ''}`,
        timestamp: Date.now(),
      }])
    } catch (err) {
      setError('Self-optimization failed: ' + (err?.message ?? 'unknown'))
    } finally {
      setSelfOptLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) }
  }

  const hasCloud = capabilities?.providers?.has_cloud ?? false

  return (
    <div className={styles.chat}>
      {/* ── Header ── */}
      <div className={styles.chatHeader}>
        <div className={styles.chatHeaderLeft}>
          <span
            className={styles.roleBadge}
            style={{ background: `${cfg.badgeColor}18`, border: `1px solid ${cfg.badgeColor}40`, color: cfg.badgeColor }}
          >
            {cfg.badge}
          </span>
          <span className={styles.chatTitle}>{cfg.label}</span>
          {capabilities?.providers?.active && (
            <span
              className={styles.providerBadge}
              style={{ color: PROVIDER_COLORS[capabilities.providers.active] ?? 'var(--color-text-muted)' }}
            >
              {PROVIDER_LABELS[capabilities.providers.active] ?? capabilities.providers.active}
              {!hasCloud && ' (local)'}
            </span>
          )}
        </div>

        <div className={styles.chatHeaderRight}>
          {/* Super-admin: agent toggle + self-optimize button */}
          {isSuperAdmin && (
            <>
              <label className={styles.toggleLabel} title="Full AGI ReAct loop vs direct brain chat">
                <input type="checkbox" checked={useAgent} onChange={e => setUseAgent(e.target.checked)} />
                <span>🤖 AGI</span>
              </label>
              <button
                className={`${styles.selfOptBtn} ${selfOptLoading ? styles.selfOptBtnLoading : ''}`}
                type="button"
                onClick={handleSelfOptimize}
                disabled={selfOptLoading}
                title="Trigger JARVIS self-improvement cycle"
              >
                {selfOptLoading ? '⟳ Optimizing…' : '🧬 Self-Optimize'}
              </button>
            </>
          )}
          {/* Admin: cloud toggle */}
          {role === 'admin' && (
            <label className={styles.toggleLabel}>
              <input type="checkbox" checked={useCloud} onChange={e => setUseCloud(e.target.checked)} />
              <span>☁ Cloud</span>
            </label>
          )}
          <button className={styles.newChatBtn} type="button" onClick={handleNewConversation}>
            + New
          </button>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className={styles.messages} aria-live="polite" aria-label="Chat messages">
        {messages.length === 0 && (
          <div className={styles.welcome}>
            <div className={styles.welcomeIcon}>
              {isSuperAdmin ? '👑' : role === 'admin' ? '⚡' : '🤖'}
            </div>
            <h3 className={styles.welcomeTitle}>
              {isSuperAdmin ? 'Rama AGI — Full Power Mode' : role === 'admin' ? 'Rama Intelligence' : 'Rama Assistant'}
            </h3>
            <p className={styles.welcomeText}>
              {isSuperAdmin
                ? hasCloud
                  ? `Full AGI active via ${PROVIDER_LABELS[capabilities?.providers?.active] ?? 'cloud AI'}. Rama can search the web, modify code, run analysis, and improve itself. What shall we build?`
                  : 'AGI mode active (local reasoning). Add OPENAI_API_KEY, ANTHROPIC_API_KEY, or GROQ_API_KEY in .env to unlock full cloud AI power.'
                : role === 'admin'
                  ? 'Market intelligence and system monitoring. Ask Rama about signals, strategies, indicators, or system health.'
                  : 'Your market education assistant. Ask Rama about trading concepts, indicators, signals, or how the AI works.'}
            </p>
            <div className={styles.quickPrompts}>
              {cfg.quickPrompts.map(p => (
                <button key={p.label} type="button" className={styles.quickPrompt}
                  onClick={() => sendMessage(p.text)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <ErrorBoundary key={msg.id}>
            <ChatMessage
              message={msg}
              onFeedback={handleFeedback}
              token={token}
              isAdmin={role === 'admin' || isSuperAdmin}
              isSuperAdmin={isSuperAdmin}
            />
          </ErrorBoundary>
        ))}

        {loading && <TypingIndicator role={role} />}
        {error && <div className={styles.errorMsg} role="alert">⚠ {error}</div>}
        <div ref={bottomRef} />
      </div>

      {/* ── Input ── */}
      <div className={styles.inputArea}>
        <textarea
          ref={inputRef}
          className={styles.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={cfg.placeholder}
          rows={2}
          maxLength={isSuperAdmin ? 3000 : 1000}
          disabled={loading}
          aria-label="Message input"
        />
        <div className={styles.inputFooter}>
          <span className={styles.charCount}>{input.length}/{isSuperAdmin ? 3000 : 1000}</span>
          <span className={styles.inputHint}>Enter to send · Shift+Enter for newline</span>
          <button
            className={styles.sendBtn}
            type="button"
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            aria-label="Send"
          >
            {loading ? <span className={styles.spinner} /> : '▶ Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Chat Message ──────────────────────────────────────────────────────────────

function ChatMessage({ message: msg, onFeedback, token, isAdmin, isSuperAdmin }) {
  const [showSteps, setShowSteps] = useState(false)

  if (msg.role === 'user') {
    return (
      <div className={styles.userMsg}>
        <div className={styles.userBubble}>{msg.content}</div>
        <span className={styles.msgTime}>{formatTime(msg.timestamp)}</span>
      </div>
    )
  }

  if (msg.role === 'error') {
    return <div className={styles.errorBubble}>⚠ {msg.content}</div>
  }

  if (msg.role === 'system') {
    return (
      <div className={styles.systemMsg}>
        <MarkdownContent content={msg.content} />
      </div>
    )
  }

  const providerColor = PROVIDER_COLORS[msg.provider] ?? 'var(--color-text-muted)'

  return (
    <div className={styles.assistantMsg}>
      <div className={styles.assistantHeader}>
        <span className={styles.assistantIcon}>
          {msg.role_mode === 'super-admin' ? '👑' : msg.role_mode === 'admin' ? '⚡' : '🤖'}
        </span>
        <div className={styles.assistantMeta}>
          {msg.agent && <span className={styles.agentLabel}>{msg.agent.replace('_', ' ')}</span>}
          {msg.provider && (
            <span className={styles.providerLabel} style={{ color: providerColor }}>
              {PROVIDER_LABELS[msg.provider] ?? msg.provider}
            </span>
          )}
          {msg.intent && msg.intent !== 'UNKNOWN' && msg.intent !== 'SAFETY_BLOCK' && (
            <span className={styles.intentLabel}>{msg.intent.toLowerCase().replace(/_/g, ' ')}</span>
          )}
          {msg.intent === 'SAFETY_BLOCK' && (
            <span className={styles.safetyBlock}>🛡 Safety</span>
          )}
        </div>
        <span className={styles.msgTime}>{formatTime(msg.timestamp)}</span>
      </div>

      {/* Message content */}
      <div className={styles.assistantBubble}>
        <MarkdownContent content={msg.content} />
      </div>

      {/* Suggestions */}
      {msg.suggestions?.length > 0 && (
        <div className={styles.suggestions}>
          <span className={styles.suggestionsLabel}>💡 Better approaches:</span>
          {msg.suggestions.map((s, i) => (
            <div key={i} className={styles.suggestion}>• {s}</div>
          ))}
        </div>
      )}

      {/* ReAct reasoning steps — super-admin only */}
      {isSuperAdmin && msg.steps?.length > 0 && (
        <div className={styles.stepsSection}>
          <button className={styles.stepsToggle} type="button"
            onClick={() => setShowSteps(s => !s)}>
            {showSteps ? '▲' : '▼'} {msg.steps.length} reasoning step{msg.steps.length !== 1 ? 's' : ''}
          </button>
          {showSteps && (
            <div className={styles.steps}>
              {msg.steps.map(step => (
                <div key={step.step} className={styles.step}>
                  <div className={styles.stepNum}>Step {step.step}</div>
                  {step.thought && (
                    <div className={styles.stepThought}>
                      <span className={styles.stepLabel}>💭 Thought:</span> {step.thought}
                    </div>
                  )}
                  {step.action && (
                    <div className={styles.stepAction}>
                      <span className={styles.stepLabel}>🔧 Action:</span>
                      <code className={styles.stepCode}>{step.action}({JSON.stringify(step.action_input ?? {})})</code>
                    </div>
                  )}
                  {step.observation && (
                    <div className={styles.stepObservation}>
                      <span className={styles.stepLabel}>👁 Observation:</span> {step.observation}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pending approvals — admin+ */}
      {isAdmin && msg.pending_approvals?.length > 0 && (
        <div className={styles.pendingApprovals}>
          <div className={styles.pendingTitle}>🔔 Pending Approvals ({msg.pending_approvals.length})</div>
          {msg.pending_approvals.map(approval => (
            <ApprovalCard key={approval.id} approval={approval} token={token} />
          ))}
        </div>
      )}

      {/* Feedback + safety */}
      <div className={styles.feedback}>
        {msg.feedback ? (
          <span className={styles.feedbackGiven}>
            {msg.feedback === 'accepted' ? '👍 Helpful' : '👎 Not helpful'}
          </span>
        ) : (
          <>
            <button className={styles.feedbackBtn} type="button"
              onClick={() => onFeedback(msg, 'accepted')} aria-label="Helpful">👍</button>
            <button className={styles.feedbackBtn} type="button"
              onClick={() => onFeedback(msg, 'rejected')} aria-label="Not helpful">👎</button>
          </>
        )}
        {msg.was_filtered && (
          <span className={styles.safetyBadge} title="Output reviewed by safety guardrails">
            🛡 Safety reviewed
          </span>
        )}
        {msg.safety_warnings?.length > 0 && (
          <span className={styles.safetyWarning} title={msg.safety_warnings.join('; ')}>
            ⚠ {msg.safety_warnings[0]}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Approval Card ─────────────────────────────────────────────────────────────

function ApprovalCard({ approval, token }) {
  const [status,  setStatus]  = useState('pending')
  const [loading, setLoading] = useState(false)

  async function handleApprove(approved) {
    setLoading(true)
    try {
      const tokenData = await issueApprovalToken(token)
      if (tokenData.token && approval.params) {
        const { apiFetch } = await import('@services/apiClient.js')
        if (approval.action === 'patch_file') {
          await apiFetch('/api/jarvis/patch', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-session-token': token },
            body:    JSON.stringify({
              approval_token: tokenData.token,
              rel_path:       approval.params.path,
              old_content:    approval.params.old_code,
              new_content:    approval.params.new_code,
            }),
          })
        }
      }
      setStatus(approved ? 'approved' : 'rejected')
    } catch {
      setStatus('error')
    } finally {
      setLoading(false)
    }
  }

  if (status !== 'pending') {
    return (
      <div className={styles.approvalDone}>
        {status === 'approved' ? '✓ Applied' : status === 'rejected' ? '✕ Rejected' : '⚠ Error'}
      </div>
    )
  }

  return (
    <div className={styles.approvalCard}>
      <div className={styles.approvalAction}>{approval.action}</div>
      {approval.preview?.path && <div className={styles.approvalPath}>{approval.preview.path}</div>}
      {approval.preview?.message && <div className={styles.approvalMsg}>{approval.preview.message}</div>}
      <div className={styles.approvalBtns}>
        <button className={styles.approveBtn} type="button" disabled={loading}
          onClick={() => handleApprove(true)}>
          {loading ? '…' : '✓ Apply'}
        </button>
        <button className={styles.rejectBtn} type="button" disabled={loading}
          onClick={() => handleApprove(false)}>
          ✕ Skip
        </button>
      </div>
    </div>
  )
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function MarkdownContent({ content }) {
  if (!content) return null
  const blocks = content.split(/```(\w*)\n?([\s\S]*?)```/g)
  const elements = []

  for (let i = 0; i < blocks.length; i++) {
    if (i % 3 === 0) {
      const text = blocks[i]
      if (text.trim()) {
        elements.push(<div key={i} className={styles.mdText}>{renderInline(text)}</div>)
      }
    } else if (i % 3 === 1) {
      // language identifier — skip
    } else {
      const lang = blocks[i - 1] || 'text'
      const code = blocks[i]
      elements.push(
        <div key={i} className={styles.codeBlock}>
          <div className={styles.codeHeader}>
            <span className={styles.codeLang}>{lang}</span>
            <button className={styles.copyBtn} type="button"
              onClick={() => navigator.clipboard.writeText(code).catch(() => {})}>
              ⎘ Copy
            </button>
          </div>
          <pre className={styles.codePre}><code>{code}</code></pre>
        </div>
      )
    }
  }
  return <div className={styles.mdContent}>{elements}</div>
}

function renderInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2,-2)}</strong>
    if (part.startsWith('*')  && part.endsWith('*'))  return <em key={i}>{part.slice(1,-1)}</em>
    if (part.startsWith('`')  && part.endsWith('`'))  return <code key={i} className={styles.inlineCode}>{part.slice(1,-1)}</code>
    return part.split('\n').map((line, j) => {
      if (line.startsWith('- ') || line.startsWith('• ')) return <div key={`${i}-${j}`} className={styles.mdBullet}>{line}</div>
      if (line.startsWith('# '))  return <h3 key={`${i}-${j}`} className={styles.mdH3}>{line.slice(2)}</h3>
      if (line.startsWith('## ')) return <h4 key={`${i}-${j}`} className={styles.mdH4}>{line.slice(3)}</h4>
      return line ? <span key={`${i}-${j}`}>{line}<br /></span> : <br key={`${i}-${j}`} />
    })
  })
}

// ── Typing indicator ──────────────────────────────────────────────────────────

function TypingIndicator({ role }) {
  const labels = {
    'super-admin': 'Rama AGI is reasoning…',
    'admin':       'Rama is analyzing…',
    'user':        'Rama is thinking…',
  }
  }
  return (
    <div className={styles.typing} aria-label="JARVIS is thinking">
      <span className={styles.typingDot} />
      <span className={styles.typingDot} />
      <span className={styles.typingDot} />
      <span className={styles.typingLabel}>{labels[role] ?? 'JARVIS is thinking…'}</span>
    </div>
  )
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit' })
}
