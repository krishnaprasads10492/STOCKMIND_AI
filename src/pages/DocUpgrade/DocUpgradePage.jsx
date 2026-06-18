/**
 * DocUpgradePage.jsx — Tech Doc → Change Proposal Review
 *
 * Upload a tech doc (API docs, changelog, SDK guide)
 * → AI analyses it vs current implementation
 * → Shows each change: WHAT / BEFORE / AFTER / MERITS / RISKS / EFFORT
 * → User approves or rejects each independently
 * → Combination engine resolves what's safe given the mix
 * → Apply button patches files, runs tests, commits to git
 */

import { useState, useRef, useCallback } from 'react'
import { apiFetch } from '@services/apiClient.js'
import { Disclaimer } from '@components/Disclaimer.jsx'
import styles from './DocUpgradePage.module.css'

const PROVIDERS = [
  { id: 'openai',     label: 'OpenAI' },
  { id: 'anthropic',  label: 'Anthropic' },
  { id: 'gemini',     label: 'Google Gemini' },
  { id: 'groq',       label: 'Groq' },
  { id: 'xai',        label: 'xAI Grok' },
  { id: 'deepseek',   label: 'DeepSeek' },
  { id: 'mistral',    label: 'Mistral' },
  { id: 'mongodb',    label: 'MongoDB' },
  { id: 'postgres',   label: 'PostgreSQL' },
  { id: 'zerodha',    label: 'Zerodha' },
  { id: 'finnhub',    label: 'Finnhub' },
  { id: 'newsapi',    label: 'NewsAPI' },
  { id: 'other',      label: 'Other…' },
]

const EFFORT_COLOR = { low: 'var(--color-bull)', medium: 'var(--color-warn)', high: 'var(--color-bear)' }
const PRIORITY_COLOR = { critical: 'var(--color-bear)', high: 'var(--color-warn)', medium: 'var(--color-accent)', low: 'var(--color-text-muted)' }
const CATEGORY_ICON  = { schema: '📋', ui: '🎨', api: '🔌', db: '🗄', dependency: '📦', test: '🧪' }

export default function DocUpgradePage() {
  const fileRef = useRef(null)
  const [file,        setFile]        = useState(null)
  const [docText,     setDocText]     = useState('')
  const [provider,    setProvider]    = useState('openai')
  const [loading,     setLoading]     = useState(false)
  const [proposals,   setProposals]   = useState(null)
  const [setId,       setSetId]       = useState(null)
  const [summary,     setSummary]     = useState('')
  const [decisions,   setDecisions]   = useState({})   // {id: 'approved'|'rejected'}
  const [resolution,  setResolution]  = useState(null)
  const [applying,    setApplying]    = useState(false)
  const [applyResult, setApplyResult] = useState(null)
  const [error,       setError]       = useState(null)
  const [activeProposal, setActiveProposal] = useState(null)

  const handleFile = useCallback((f) => {
    if (!f) return
    setFile(f)
    setError(null)
    setProposals(null)
    setApplyResult(null)
  }, [])

  const analyse = useCallback(async () => {
    setLoading(true); setError(null); setProposals(null); setResolution(null); setApplyResult(null)
    try {
      const form = new FormData()
      form.append('provider_id', provider)
      if (file) {
        form.append('file', file)
      } else if (docText.trim()) {
        form.append('doc_text', docText)
        form.append('doc_name', 'pasted_text')
      } else {
        setError('Upload a file or paste doc text'); setLoading(false); return
      }

      // Use fetch directly for multipart
      const r = await fetch('/api/doc-upgrade/analyse', {
        method: 'POST',
        headers: { 'x-session-token': localStorage.getItem('sm_session') ?? '' },
        body: form,
      })
      const data = await r.json()
      if (!data.ok) throw new Error(data.error ?? 'Analysis failed')

      setProposals(data.proposals ?? [])
      setSetId(data.set_id)
      setSummary(data.summary ?? '')
      // Default: all pending
      const d = {}
      ;(data.proposals ?? []).forEach(p => { d[p.id] = 'pending' })
      setDecisions(d)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [file, docText, provider])

  const decide = useCallback((id, verdict) => {
    setDecisions(prev => ({ ...prev, [id]: verdict }))
  }, [])

  const resolveCombo = useCallback(async () => {
    if (!setId) return
    // Send decisions to backend first
    const decisionsToSend = {}
    Object.entries(decisions).forEach(([id, v]) => { if (v !== 'pending') decisionsToSend[id] = v })

    const dr = await apiFetch('/api/doc-upgrade/decide', {
      method: 'POST',
      body: JSON.stringify({ set_id: setId, decisions: decisionsToSend }),
    }).then(r => r.json()).catch(() => null)

    if (dr?.ok) setResolution(dr.resolution)
    return dr
  }, [setId, decisions])

  const applyChanges = useCallback(async () => {
    setApplying(true)
    try {
      // First push decisions
      await resolveCombo()
      const r = await apiFetch(`/api/doc-upgrade/apply/${setId}`, {
        method: 'POST', body: JSON.stringify({}),
      }).then(r => r.json())
      setApplyResult(r)
    } catch (e) { setError(e.message) }
    finally { setApplying(false) }
  }, [setId, resolveCombo])

  const approvedCount = Object.values(decisions).filter(v => v === 'approved').length
  const rejectedCount = Object.values(decisions).filter(v => v === 'rejected').length
  const pendingCount  = Object.values(decisions).filter(v => v === 'pending').length

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>📄 Doc-Driven Upgrade</h1>
          <p className={styles.subtitle}>
            Upload a tech doc → AI compares it with current integration →
            review each proposed change → approve/reject individually →
            safe combination is applied automatically
          </p>
        </div>
      </div>

      {/* ── Input ── */}
      {!proposals && (
        <div className={styles.inputSection}>
          <div className={styles.providerRow}>
            <label className={styles.label}>Which provider/resource is this doc for?</label>
            <select className={styles.select} value={provider} onChange={e => setProvider(e.target.value)}>
              {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>

          <div className={styles.inputModes}>
            {/* File upload */}
            <div className={`${styles.uploadBox} ${file ? styles.uploadBoxFilled : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]) }}>
              {file
                ? <><span className={styles.fileIcon}>📄</span><span className={styles.fileName}>{file.name}</span><span className={styles.fileSize}>{(file.size/1024).toFixed(0)} KB</span></>
                : <><span className={styles.uploadIcon}>⬆</span><span className={styles.uploadTxt}>Drop or click to upload</span><span className={styles.uploadHint}>PDF · TXT · MD · JSON · HTML</span></>
              }
            </div>
            <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.json,.html" style={{display:'none'}} onChange={e => handleFile(e.target.files?.[0])} />

            <div className={styles.orDivider}>— or paste text —</div>

            <textarea className={styles.docTextArea} value={docText} onChange={e => setDocText(e.target.value)}
              placeholder="Paste API documentation, changelog, SDK reference, or migration guide here…" rows={8} />
          </div>

          {error && <div className={styles.error}>⚠ {error}</div>}

          <button className={styles.analyseBtn} onClick={analyse} disabled={loading || (!file && !docText.trim())}>
            {loading ? '⏳ AI is analysing…' : '🔍 Analyse & Generate Proposals'}
          </button>
        </div>
      )}

      {/* ── Proposals ── */}
      {proposals && (
        <div className={styles.proposalsSection}>
          {/* Summary + stats */}
          <div className={styles.analysisSummary}>
            <div className={styles.summaryText}>{summary}</div>
            <div className={styles.stats}>
              <span className={styles.statTotal}>{proposals.length} proposals</span>
              <span className={styles.statApproved}>✓ {approvedCount} approved</span>
              <span className={styles.statRejected}>✗ {rejectedCount} rejected</span>
              <span className={styles.statPending}>… {pendingCount} pending</span>
            </div>
          </div>

          {/* Proposal cards */}
          <div className={styles.proposalList}>
            {proposals.map(p => (
              <ProposalCard
                key={p.id}
                proposal={p}
                decision={decisions[p.id] ?? 'pending'}
                onApprove={() => decide(p.id, 'approved')}
                onReject={() => decide(p.id, 'rejected')}
                onReset={() => decide(p.id, 'pending')}
                expanded={activeProposal === p.id}
                onToggle={() => setActiveProposal(activeProposal === p.id ? null : p.id)}
                allProposals={proposals}
              />
            ))}
          </div>

          {/* Combination resolution */}
          <div className={styles.comboSection}>
            <button className={styles.resolveBtn} onClick={resolveCombo} disabled={pendingCount > 0}>
              {pendingCount > 0 ? `Decide all ${pendingCount} pending proposals first` : '⚖ Analyse Combination Safety'}
            </button>

            {resolution && <CombinationPanel resolution={resolution} />}
          </div>

          {/* Apply */}
          {resolution && resolution.stats?.safe_to_apply > 0 && (
            <div className={styles.applySection}>
              <div className={styles.applyInfo}>
                <span className={styles.applyCount}>{resolution.stats.safe_to_apply} change(s) ready to apply</span>
                <span className={styles.applyNote}>
                  A backup of every modified file is created before applying.
                  Changes are committed to git automatically.
                </span>
              </div>
              <button className={styles.applyBtn} onClick={applyChanges} disabled={applying}>
                {applying ? '⏳ Applying changes…' : `🚀 Apply ${resolution.stats.safe_to_apply} Approved Change(s)`}
              </button>
            </div>
          )}

          {applyResult && <ApplyResultPanel result={applyResult} />}

          <button className={styles.resetBtn} onClick={() => { setProposals(null); setFile(null); setDocText('') }}>
            ← Start over with a new document
          </button>
        </div>
      )}

      <Disclaimer compact />
    </div>
  )
}

// ── ProposalCard ──────────────────────────────────────────────────────────────

function ProposalCard({ proposal: p, decision, onApprove, onReject, onReset, expanded, onToggle, allProposals }) {
  const depTitles = (p.requires ?? []).map(id => allProposals.find(x => x.id === id)?.title).filter(Boolean)
  const confTitles= (p.conflicts?? []).map(id => allProposals.find(x => x.id === id)?.title).filter(Boolean)

  return (
    <div className={`${styles.card} ${styles[`decision_${decision}`]}`} role="article">
      {/* Card header */}
      <div className={styles.cardHeader}>
        <div className={styles.cardHeaderLeft}>
          <span className={styles.catIcon} title={p.category}>{CATEGORY_ICON[p.category] ?? '📝'}</span>
          <div>
            <div className={styles.cardTitle}>{p.title}</div>
            <div className={styles.cardMeta}>
              <span style={{ color: PRIORITY_COLOR[p.priority] }}>{p.priority}</span>
              <span className={styles.dot}>·</span>
              <span style={{ color: EFFORT_COLOR[p.effort] }}>effort: {p.effort}</span>
              <span className={styles.dot}>·</span>
              <span className={styles.provider}>{p.provider}</span>
            </div>
          </div>
        </div>

        {/* Decision buttons */}
        <div className={styles.decisionBtns} role="group" aria-label={`Decision for ${p.title}`}>
          <button className={`${styles.approveBtn} ${decision === 'approved' ? styles.approveBtnActive : ''}`}
            onClick={onApprove} aria-pressed={decision === 'approved'} type="button">✓ Approve</button>
          <button className={`${styles.rejectBtn}  ${decision === 'rejected' ? styles.rejectBtnActive  : ''}`}
            onClick={onReject}  aria-pressed={decision === 'rejected'} type="button">✗ Reject</button>
          {decision !== 'pending' && (
            <button className={styles.resetBtn2} onClick={onReset} type="button" title="Reset to pending">↺</button>
          )}
        </div>
      </div>

      {/* WHAT changed (always visible) */}
      <p className={styles.whatText}>{p.what}</p>

      {/* Dependencies / conflicts warning */}
      {depTitles.length > 0 && (
        <div className={styles.depWarning}>⚠ Requires: {depTitles.join(', ')}</div>
      )}
      {confTitles.length > 0 && (
        <div className={styles.confWarning}>⚡ Conflicts with: {confTitles.join(', ')}</div>
      )}

      {/* Expand for full detail */}
      <button className={styles.expandBtn} onClick={onToggle} type="button" aria-expanded={expanded}>
        {expanded ? '▲ Hide detail' : '▼ Show BEFORE / AFTER / MERITS / RISKS'}
      </button>

      {expanded && (
        <div className={styles.detail}>
          <DetailBlock label="📋 Before (current)" code={p.before} type="before" />
          <DetailBlock label="✨ After (proposed)"  code={p.after}  type="after" />

          <div className={styles.detailRow}>
            <div className={styles.merits}>
              <span className={styles.detailLabel}>✓ Merits</span>
              <p className={styles.detailText}>{p.merits}</p>
            </div>
            <div className={styles.risks}>
              <span className={styles.detailLabel}>⚠ Risks</span>
              <p className={styles.detailText}>{p.risks}</p>
            </div>
          </div>

          {p.components?.length > 0 && (
            <div className={styles.components}>
              <span className={styles.detailLabel}>📁 Files affected</span>
              <div className={styles.componentList}>
                {p.components.map((c, i) => (
                  <span key={i} className={styles.componentTag}>{c.file} → {c.section}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DetailBlock({ label, code, type }) {
  return (
    <div className={`${styles.codeBlock} ${styles[`codeBlock_${type}`]}`}>
      <span className={styles.codeBlockLabel}>{label}</span>
      <pre className={styles.codeBlockPre}><code>{code || '(none)'}</code></pre>
    </div>
  )
}

// ── CombinationPanel ──────────────────────────────────────────────────────────

function CombinationPanel({ resolution }) {
  const { safe_to_apply, skipped, warnings, stats } = resolution
  return (
    <div className={styles.comboPanel}>
      <div className={styles.comboPanelHeader}>⚖ Combination Analysis</div>

      <div className={styles.comboStats}>
        <div className={styles.comboStat}>
          <span className={styles.comboStatNum} style={{ color: 'var(--color-bull)' }}>{stats.safe_to_apply}</span>
          <span className={styles.comboStatLbl}>Safe to apply</span>
        </div>
        <div className={styles.comboStat}>
          <span className={styles.comboStatNum} style={{ color: 'var(--color-bear)' }}>{stats.skipped}</span>
          <span className={styles.comboStatLbl}>Skipped</span>
        </div>
        <div className={styles.comboStat}>
          <span className={styles.comboStatNum}>{stats.rejected}</span>
          <span className={styles.comboStatLbl}>Rejected</span>
        </div>
      </div>

      {safe_to_apply?.length > 0 && (
        <div className={styles.safeList}>
          <span className={styles.detailLabel}>Will be applied (in order):</span>
          {safe_to_apply.map((p, i) => (
            <div key={p.id} className={styles.safeItem}>
              <span className={styles.safeIdx}>{i + 1}</span>
              <span>{p.title}</span>
              <span className={styles.safeEffort} style={{ color: EFFORT_COLOR[p.effort] }}>{p.effort}</span>
            </div>
          ))}
        </div>
      )}

      {skipped?.length > 0 && (
        <div className={styles.skippedList}>
          <span className={styles.detailLabel}>Skipped (dependency rejected):</span>
          {skipped.map(s => (
            <div key={s.proposal?.id} className={styles.skippedItem}>
              ✗ {s.proposal?.title} — <em>{s.reason}</em>
            </div>
          ))}
        </div>
      )}

      {warnings?.length > 0 && (
        <div className={styles.comboWarnings}>
          {warnings.map((w, i) => <div key={i} className={styles.comboWarning}>{w}</div>)}
        </div>
      )}
    </div>
  )
}

// ── ApplyResultPanel ──────────────────────────────────────────────────────────

function ApplyResultPanel({ result }) {
  return (
    <div className={`${styles.applyResult} ${result.applied > 0 ? styles.applyResultOk : styles.applyResultPartial}`}>
      <div className={styles.applyResultHeader}>
        {result.applied > 0 ? '✓ Applied' : '⚠ Partial'} — {result.applied} applied, {result.failed} failed, {result.skipped} skipped
        {result.committed && <span className={styles.committedBadge}>📦 Committed to git</span>}
      </div>
      {result.warnings?.map((w, i) => <div key={i} className={styles.applyWarning}>{w}</div>)}
      {result.results?.failed?.map(f => (
        <div key={f.proposal_id} className={styles.applyFailed}>
          ✗ {f.title}: {f.ops?.map(o => o.error).filter(Boolean).join(', ')}
        </div>
      ))}
    </div>
  )
}
