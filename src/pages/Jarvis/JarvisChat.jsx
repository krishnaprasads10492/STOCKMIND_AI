/**
 * JarvisChat — Full conversational AI interface for JARVIS.
 *
 * Features:
 *   - Chat with JARVIS using natural language
 *   - Supports all AI paradigms: Narrow AI, Gen AI, Agentic AI, Multi-Agent
 *   - Shows reasoning steps (ReAct loop) in real-time
 *   - Markdown rendering with code block highlighting
 *   - Feedback buttons (👍/👎) on every response
 *   - Conversation history with session persistence
 *   - Provider indicator (OpenAI / Anthropic / Gemini / Local)
 *   - Pending approvals from agentic tasks
 *   - Capabilities panel showing available tools
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '@store/authStore.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import {
  brainChat, brainFeedback, newConversation,
  agiExecute, fetchAGICapabilities, agiFeedback, fetchAGIInsights,
  approveJarvisAction, issueApprovalToken,
} from '@services/jarvisClient.js'
import styles from './JarvisChat.module.css'

const PROVIDER_COLORS = {
  openai:    '#10a37f',
  anthropic: '#d97706',
  gemini:    '#4285f4',
  local:     'var(--color-text-muted)',
}

const PROVIDER_LABELS = {
  openai:    'GPT-4o',
  anthropic: 'Claude',
  gemini:    'Gemini',
  local:     'Local',
}

const AGENT_EMOJIS = {
  market_analyst: '📊',
  code_engineer:  '⚙',
  ml_researcher:  '🧠',
  ui_designer:    '🎨',
}

const QUICK_PROMPTS = [
  { label: '🎨 Create a theme',       text: 'Create a dark red cyberpunk theme called Crimson Protocol' },
  { label: '📊 System status',        text: 'What is the current system health and ML accuracy?' },
  { label: '🧠 Improve accuracy',     text: 'How can I improve the prediction accuracy of the ML models?' },
  { label: '⚙ Add a feature',        text: 'Add a portfolio tracker page that shows P&L across all predictions' },
  { label: '📦 Check dependencies',   text: 'Scan for outdated dependencies and security issues' },
  { label: '🔍 Explain the codebase', text: 'Explain how the prediction engine works end to end' },
  { label: '📈 Fetch NIFTY data',     text: 'Fetch the last 30 days of NIFTY50 price data' },
  { label: '🤖 What can you do?',     text: 'What are all your capabilities?' },
]

export default function JarvisChat({ token }) {
  const user       = useAuthStore(s => s.user)
  const isAdmin    = user?.role === 'admin' || user?.role === 'super-admin'

  const [messages,     setMessages]     = useState([])
  const [input,        setInput]        = useState('')
  const [loading,      setLoading]      = useState(false)
  const [convId,       setConvId]       = useState(null)
  const [useAgent,     setUseAgent]     = useState(true)
  const [useCloud,     setUseCloud]     = useState(true)
  const [capabilities, setCapabilities] = useState(null)
  const [insights,     setInsights]     = useState(null)
  const [showCaps,     setShowCaps]     = useState(false)
  const [error,        setError]        = useState('')

  const bottomRef  = useRef(null)
  const inputRef   = useRef(null)

  // Load capabilities on mount
  useEffect(() => {
    if (!token) return
    fetchAGICapabilities(token).then(setCapabilities).catch(() => {})
  }, [token])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Start a new conversation
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

    const userMsg = {
      id:        Date.now(),
      role:      'user',
      content:   text.trim(),
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      let response
      if (useAgent) {
        // Use full AGI stack
        response = await agiExecute(text.trim(), convId, true, token)
        if (!convId && response.conv_id) setConvId(response.conv_id)
      } else {
        // Use direct brain chat
        response = await brainChat(text.trim(), convId, useCloud, token)
        if (!convId && response.conv_id) setConvId(response.conv_id)
      }

      const assistantMsg = {
        id:          Date.now() + 1,
        role:        'assistant',
        content:     response.result ?? response.response ?? 'No response',
        timestamp:   Date.now(),
        intent:      response.intent,
        confidence:  response.confidence,
        provider:    response.provider ?? response.active_provider,
        mode:        response.mode,
        agent:       response.agent,
        agent_emoji: response.agent_emoji,
        steps:       response.steps ?? [],
        pending_approvals: response.pending_approvals ?? [],
        suggestions: response.suggestions ?? [],
        actions:     response.actions ?? [],
        task_id:     response.task_id,
        status:      response.status,
      }
      setMessages(prev => [...prev, assistantMsg])

    } catch (err) {
      setError(err?.message ?? 'Failed to get response — is the AI backend running?')
      setMessages(prev => [...prev, {
        id:        Date.now() + 1,
        role:      'error',
        content:   err?.message ?? 'Connection failed',
        timestamp: Date.now(),
      }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }, [loading, convId, useAgent, useCloud, token])

  async function handleFeedback(msg, feedback) {
    try {
      if (useAgent) {
        await agiFeedback(msg.content, feedback, msg.intent ?? '', token)
      } else {
        const idx = messages.findIndex(m => m.id === msg.id)
        if (convId && idx >= 0) {
          await brainFeedback(convId, idx, feedback, msg.intent ?? '', token)
        }
      }
      // Update message with feedback
      setMessages(prev => prev.map(m =>
        m.id === msg.id ? { ...m, feedback } : m
      ))
    } catch { /* ignore */ }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const hasCloud = capabilities?.providers?.has_cloud ?? false

  return (
    <div className={styles.chat}>
      {/* ── Chat header ── */}
      <div className={styles.chatHeader}>
        <div className={styles.chatHeaderLeft}>
          <span className={styles.chatTitle}>💬 JARVIS Chat</span>
          {capabilities && (
            <span className={styles.providerBadge}
              style={{ color: PROVIDER_COLORS[capabilities.providers?.active] ?? 'var(--color-text-muted)' }}>
              {PROVIDER_LABELS[capabilities.providers?.active] ?? 'Local'}
              {!hasCloud && ' (no cloud key)'}
            </span>
          )}
        </div>
        <div className={styles.chatHeaderRight}>
          <label className={styles.toggleLabel}>
            <input type="checkbox" checked={useAgent} onChange={e => setUseAgent(e.target.checked)} />
            <span>🤖 Agentic</span>
          </label>
          {!useAgent && (
            <label className={styles.toggleLabel}>
              <input type="checkbox" checked={useCloud} onChange={e => setUseCloud(e.target.checked)} />
              <span>☁ Cloud AI</span>
            </label>
          )}
          <button className={styles.capsBtn} type="button" onClick={() => setShowCaps(s => !s)}>
            🛠 Tools
          </button>
          <button className={styles.newChatBtn} type="button" onClick={handleNewConversation}>
            + New Chat
          </button>
        </div>
      </div>

      {/* ── Capabilities panel ── */}
      {showCaps && capabilities && (
        <div className={styles.capsPanel}>
          <div className={styles.capsPanelTitle}>JARVIS AI Paradigms & Tools</div>
          <div className={styles.paradigmsGrid}>
            {capabilities.ai_paradigms?.map(p => (
              <div key={p.name} className={styles.paradigmCard}>
                <strong>{p.name}</strong>
                <p>{p.description}</p>
              </div>
            ))}
          </div>
          <div className={styles.toolsGrid}>
            {capabilities.tools?.map(t => (
              <span key={t} className={styles.toolChip}>{t}</span>
            ))}
          </div>
        </div>
      )}

      {/* ── Messages ── */}
      <div className={styles.messages} aria-live="polite" aria-label="Chat messages">
        {messages.length === 0 && (
          <div className={styles.welcome}>
            <div className={styles.welcomeIcon}>🤖</div>
            <h3 className={styles.welcomeTitle}>JARVIS is ready</h3>
            <p className={styles.welcomeText}>
              {hasCloud
                ? `Connected to ${PROVIDER_LABELS[capabilities?.providers?.active]}. Ask me anything — I can add features, analyze code, generate themes, fetch market data, and more.`
                : 'Running in local mode. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY in .env to unlock full AI capabilities.'}
            </p>
            <div className={styles.quickPrompts}>
              {QUICK_PROMPTS.map(p => (
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
              isAdmin={isAdmin}
            />
          </ErrorBoundary>
        ))}

        {loading && <TypingIndicator />}
        {error && <div className={styles.errorMsg} role="alert">{error}</div>}
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
          placeholder={useAgent
            ? 'Ask JARVIS anything — it will plan and execute autonomously…'
            : 'Ask JARVIS a question…'}
          rows={2}
          maxLength={3000}
          disabled={loading}
          aria-label="Message input"
        />
        <div className={styles.inputFooter}>
          <span className={styles.charCount}>{input.length}/3000</span>
          <span className={styles.inputHint}>Enter to send · Shift+Enter for newline</span>
          <button
            className={styles.sendBtn}
            type="button"
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            aria-label="Send message"
          >
            {loading ? <span className={styles.spinner} /> : '▶ Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Chat Message ──────────────────────────────────────────────────────────────

function ChatMessage({ message: msg, onFeedback, token, isAdmin }) {
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
    return (
      <div className={styles.errorBubble}>
        ⚠ {msg.content}
      </div>
    )
  }

  // Assistant message
  const providerColor = PROVIDER_COLORS[msg.provider] ?? 'var(--color-text-muted)'
  const agentEmoji    = msg.agent_emoji ?? AGENT_EMOJIS[msg.agent] ?? '🤖'

  return (
    <div className={styles.assistantMsg}>
      <div className={styles.assistantHeader}>
        <span className={styles.assistantIcon}>{agentEmoji}</span>
        <div className={styles.assistantMeta}>
          {msg.agent && <span className={styles.agentLabel}>{msg.agent.replace('_', ' ')}</span>}
          {msg.mode && <span className={styles.modeLabel}>{msg.mode}</span>}
          {msg.provider && (
            <span className={styles.providerLabel} style={{ color: providerColor }}>
              {PROVIDER_LABELS[msg.provider] ?? msg.provider}
            </span>
          )}
          {msg.intent && msg.intent !== 'UNKNOWN' && (
            <span className={styles.intentLabel}>{msg.intent.toLowerCase().replace('_', ' ')}</span>
          )}
        </div>
        <span className={styles.msgTime}>{formatTime(msg.timestamp)}</span>
      </div>

      {/* Message content with markdown */}
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

      {/* ReAct steps */}
      {msg.steps?.length > 0 && (
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
                      <code className={styles.stepCode}>{step.action}({JSON.stringify(step.action_input)})</code>
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

      {/* Pending approvals from agentic tasks */}
      {msg.pending_approvals?.length > 0 && isAdmin && (
        <div className={styles.pendingApprovals}>
          <div className={styles.pendingTitle}>🔔 Pending Approvals ({msg.pending_approvals.length})</div>
          {msg.pending_approvals.map(approval => (
            <ApprovalCard key={approval.id} approval={approval} token={token} />
          ))}
        </div>
      )}

      {/* Feedback */}
      <div className={styles.feedback}>
        {msg.feedback ? (
          <span className={styles.feedbackGiven}>
            {msg.feedback === 'accepted' ? '👍 Helpful' : '👎 Not helpful'}
          </span>
        ) : (
          <>
            <button className={styles.feedbackBtn} type="button"
              onClick={() => onFeedback(msg, 'accepted')} aria-label="Helpful">
              👍
            </button>
            <button className={styles.feedbackBtn} type="button"
              onClick={() => onFeedback(msg, 'rejected')} aria-label="Not helpful">
              👎
            </button>
          </>
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
        // Execute the actual action
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
      {approval.preview?.path && (
        <div className={styles.approvalPath}>{approval.preview.path}</div>
      )}
      {approval.preview?.message && (
        <div className={styles.approvalMsg}>{approval.preview.message}</div>
      )}
      <div className={styles.approvalBtns}>
        <button className={styles.approveBtn} type="button"
          disabled={loading} onClick={() => handleApprove(true)}>
          {loading ? '…' : '✓ Apply'}
        </button>
        <button className={styles.rejectBtn} type="button"
          disabled={loading} onClick={() => handleApprove(false)}>
          ✕ Skip
        </button>
      </div>
    </div>
  )
}

// ── Markdown renderer (lightweight, no external deps) ─────────────────────────

function MarkdownContent({ content }) {
  if (!content) return null

  // Split into blocks
  const blocks = content.split(/```(\w*)\n?([\s\S]*?)```/g)
  const elements = []

  for (let i = 0; i < blocks.length; i++) {
    if (i % 3 === 0) {
      // Regular text — apply inline formatting
      const text = blocks[i]
      if (text.trim()) {
        elements.push(
          <div key={i} className={styles.mdText}>
            {renderInline(text)}
          </div>
        )
      }
    } else if (i % 3 === 1) {
      // Language identifier — skip
    } else {
      // Code block
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
  // Split by bold (**text**), italic (*text*), inline code (`code`)
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className={styles.inlineCode}>{part.slice(1, -1)}</code>
    }
    // Render line breaks and bullet points
    return part.split('\n').map((line, j) => {
      if (line.startsWith('- ') || line.startsWith('• ')) {
        return <div key={`${i}-${j}`} className={styles.mdBullet}>{line}</div>
      }
      if (line.startsWith('# ')) {
        return <h3 key={`${i}-${j}`} className={styles.mdH3}>{line.slice(2)}</h3>
      }
      if (line.startsWith('## ')) {
        return <h4 key={`${i}-${j}`} className={styles.mdH4}>{line.slice(3)}</h4>
      }
      return line ? <span key={`${i}-${j}`}>{line}<br /></span> : <br key={`${i}-${j}`} />
    })
  })
}

// ── Typing indicator ──────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className={styles.typing} aria-label="JARVIS is thinking">
      <span className={styles.typingDot} />
      <span className={styles.typingDot} />
      <span className={styles.typingDot} />
      <span className={styles.typingLabel}>JARVIS is thinking…</span>
    </div>
  )
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit' })
}
