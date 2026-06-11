/**
 * StrategiesPage — AI-powered strategy hub.
 *
 * Tab 1: Library     — builtin + AI-generated + user-combined strategies with live stats
 * Tab 2: AI Generate — describe what you want → JARVIS generates strategies
 * Tab 3: Combine     — select 2+ strategies → AI merges into one
 * Tab 4: Intel Hub   — image/doc/news → AI analysis → strategy recommendations
 * Tab 5: Stock Picker— timeframe/risk → AI picks stocks
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import { Disclaimer } from '@components/Disclaimer.jsx'
import { GlobalSymbolPicker } from '@components/GlobalSymbolPicker.jsx'
import { apiFetch } from '@services/apiClient.js'
import styles from './StrategiesPage.module.css'

const TABS = [
  { id: 'library',  label: '📚 Library' },
  { id: 'generate', label: '🤖 AI Generate' },
  { id: 'combine',  label: '🔗 Combine' },
  { id: 'intel',    label: '🧠 Intel Hub' },
  { id: 'picker',   label: '🎯 Stock Picker' },
]

const CATEGORIES = ['All','Trend Following','Mean Reversion','Breakout','Momentum','Options','Options Income','Long Term','Combined','AI Generated']
const INSTRUMENTS = ['All','spot','futures','options']
const COMPLEXITIES = ['All','beginner','intermediate','advanced']

export default function StrategiesPage() {
  const [activeTab, setActiveTab] = useState('library')

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>Strategy Intelligence</h1>
          <p className={styles.subtitle}>AI-powered strategies · web-researched · backtested · wealth-focused</p>
        </div>
      </div>

      <div className={styles.tabs} role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            className={`${styles.tab} ${activeTab === t.id ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(t.id)}
          >{t.label}</button>
        ))}
      </div>

      <ErrorBoundary>
        {activeTab === 'library'  && <LibraryTab />}
        {activeTab === 'generate' && <GenerateTab />}
        {activeTab === 'combine'  && <CombineTab />}
        {activeTab === 'intel'    && <IntelTab />}
        {activeTab === 'picker'   && <PickerTab />}
      </ErrorBoundary>

      <Disclaimer />
    </div>
  )
}

// ── Tab 1: Library ────────────────────────────────────────────────────────────

function LibraryTab() {
  const navigate = useNavigate()
  const [strategies, setStrategies] = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [category,   setCategory]   = useState('All')
  const [instrType,  setInstrType]  = useState('All')
  const [complexity, setComplexity] = useState('All')
  const [minAcc,     setMinAcc]     = useState(0)
  const [search,     setSearch]     = useState('')
  const [expanded,   setExpanded]   = useState(null)

  useEffect(() => {
    apiFetch('/api/strategy-ai/library')
      .then(d => { if (d.ok) setStrategies(d.strategies ?? []) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => strategies.filter(s => {
    if (category   !== 'All' && s.category   !== category)   return false
    if (instrType  !== 'All' && s.instrType  !== instrType)  return false
    if (complexity !== 'All' && s.complexity !== complexity) return false
    if ((s.accuracy ?? 0) < minAcc) return false
    if (search) {
      const q = search.toLowerCase()
      if (!s.name?.toLowerCase().includes(q) && !(s.tags ?? []).some(t => t.toLowerCase().includes(q))) return false
    }
    return true
  }), [strategies, category, instrType, complexity, minAcc, search])

  function handleApply(s) {
    navigate(`/predictions?module=${encodeURIComponent(s.symbol === 'Any' ? 'indices-india' : 'fno-india')}&strategy=${encodeURIComponent(s.id)}`)
  }

  if (loading) return <div className={styles.loading}>Loading strategy library…</div>
  if (error)   return <div className={styles.errorMsg}>Failed to load: {error}</div>

  return (
    <div className={styles.tabContent}>
      <div className={styles.filters}>
        <input className={styles.searchInput} value={search}
          onChange={e => setSearch(e.target.value)} placeholder="Search strategies or tags…" aria-label="Search" />
        <FilterGroup label="Category"   value={category}   options={CATEGORIES}   onChange={setCategory} />
        <FilterGroup label="Instrument" value={instrType}  options={INSTRUMENTS}  onChange={setInstrType} />
        <FilterGroup label="Complexity" value={complexity} options={COMPLEXITIES} onChange={setComplexity} />
        <div className={styles.accFilter}>
          <label className={styles.accFilterLabel}>Min Accuracy</label>
          <div className={styles.accFilterRow}>
            <input type="range" min={0} max={90} step={5} value={minAcc}
              onChange={e => setMinAcc(Number(e.target.value))} className={styles.accSlider}
              aria-label={`Min accuracy ${minAcc}%`} />
            <span className={styles.accVal}>{minAcc}%+</span>
          </div>
        </div>
      </div>
      <div className={styles.resultsCount}>{filtered.length} strategies</div>
      {filtered.length === 0
        ? <div className={styles.empty}>No strategies match your filters.</div>
        : <div className={styles.grid}>
            {filtered.map(s => (
              <ErrorBoundary key={s.id}>
                <StrategyCard strategy={s} expanded={expanded === s.id}
                  onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
                  onApply={() => handleApply(s)} />
              </ErrorBoundary>
            ))}
          </div>
      }
    </div>
  )
}

// ── Tab 2: AI Generate ────────────────────────────────────────────────────────

function GenerateTab() {
  const [request,    setRequest]    = useState('')
  const [symbol,     setSymbol]     = useState('')
  const [instrType,  setInstrType]  = useState('spot')
  const [timeframe,  setTimeframe]  = useState('daily')
  const [riskLevel,  setRiskLevel]  = useState('medium')
  const [loading,    setLoading]    = useState(false)
  const [result,     setResult]     = useState(null)
  const [error,      setError]      = useState(null)
  const [saved,      setSaved]      = useState({})

  async function generate() {
    if (!request.trim()) return
    setLoading(true); setError(null); setResult(null)
    try {
      const d = await apiFetch('/api/strategy-ai/generate', {
        method: 'POST',
        body: JSON.stringify({ request, symbol, instrType, timeframe, riskLevel, webSearch: true }),
      })
      if (d.ok) setResult(d)
      else setError(d.error ?? 'Generation failed')
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  async function saveStrategy(s) {
    try {
      const d = await apiFetch('/api/strategy-ai/save', { method: 'POST', body: JSON.stringify({ strategy: s }) })
      if (d.ok) setSaved(prev => ({ ...prev, [s.id]: true }))
    } catch {}
  }

  return (
    <div className={styles.tabContent}>
      <div className={styles.genForm}>
        <div className={styles.genFormRow}>
          <div className={styles.genField} style={{ flex: 3 }}>
            <label className={styles.genLabel}>What strategy do you need?</label>
            <textarea className={styles.genTextarea} rows={3} value={request}
              onChange={e => setRequest(e.target.value)}
              placeholder="e.g. I want a strategy for NIFTY options when market is volatile, low risk, for intraday. Or: give me a long-term wealth creation strategy for mid-cap stocks." />
          </div>
        </div>
        <div className={styles.genFormRow}>
          <div className={styles.genField}>
            <label className={styles.genLabel}>Symbol (optional)</label>
            <GlobalSymbolPicker value={symbol} onChange={setSymbol} placeholder="Any symbol" />
          </div>
          <div className={styles.genField}>
            <label className={styles.genLabel}>Instrument</label>
            <select className={styles.genSelect} value={instrType} onChange={e => setInstrType(e.target.value)}>
              <option value="spot">Spot / Equity</option>
              <option value="futures">Futures</option>
              <option value="options">Options</option>
            </select>
          </div>
          <div className={styles.genField}>
            <label className={styles.genLabel}>Timeframe</label>
            <select className={styles.genSelect} value={timeframe} onChange={e => setTimeframe(e.target.value)}>
              <option value="intraday">Intraday</option>
              <option value="daily">Daily / Swing</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly+</option>
            </select>
          </div>
          <div className={styles.genField}>
            <label className={styles.genLabel}>Risk Level</label>
            <select className={styles.genSelect} value={riskLevel} onChange={e => setRiskLevel(e.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
        <button className={styles.genBtn} onClick={generate} disabled={loading || !request.trim()}>
          {loading ? '⏳ Generating…' : '🤖 Generate Strategies with AI'}
        </button>
        {error && <div className={styles.errorMsg}>{error}</div>}
      </div>

      {result && (
        <div className={styles.genResults}>
          <div className={styles.genResultsHeader}>
            <span className={styles.genResultsTitle}>
              {result.strategies.length} strategies generated
              {result.webContext && <span className={styles.webBadge}>🌐 Web-researched</span>}
            </span>
          </div>
          {result.webContext?.abstract && (
            <div className={styles.webContext}>
              <span className={styles.webContextLabel}>Web context:</span> {result.webContext.abstract}
            </div>
          )}
          <div className={styles.grid}>
            {result.strategies.map(s => (
              <ErrorBoundary key={s.id}>
                <StrategyCard strategy={s} expanded={false} onToggle={() => {}}
                  onApply={() => {}}
                  extraAction={
                    <button className={styles.saveBtn} onClick={() => saveStrategy(s)} disabled={saved[s.id]}>
                      {saved[s.id] ? '✓ Saved' : '💾 Save to Library'}
                    </button>
                  } />
              </ErrorBoundary>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab 3: Combine ────────────────────────────────────────────────────────────

function CombineTab() {
  const [strategies, setStrategies] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [selected,   setSelected]   = useState([])
  const [name,       setName]       = useState('')
  const [combining,  setCombining]  = useState(false)
  const [result,     setResult]     = useState(null)
  const [error,      setError]      = useState(null)

  useEffect(() => {
    apiFetch('/api/strategy-ai/library')
      .then(d => { if (d.ok) setStrategies(d.strategies ?? []) })
      .finally(() => setLoading(false))
  }, [])

  function toggleSelect(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function combine() {
    if (selected.length < 2) return
    setCombining(true); setError(null); setResult(null)
    try {
      const d = await apiFetch('/api/strategy-ai/combine', {
        method: 'POST',
        body: JSON.stringify({ strategyIds: selected, name: name.trim() || undefined }),
      })
      if (d.ok) setResult(d.strategy)
      else setError(d.error ?? 'Combine failed')
    } catch (e) { setError(e.message) }
    finally { setCombining(false) }
  }

  if (loading) return <div className={styles.loading}>Loading strategies…</div>

  return (
    <div className={styles.tabContent}>
      <div className={styles.combineInfo}>
        <span className={styles.combineInfoText}>
          Select 2 or more strategies to combine. The AI merges all their conditions into one powerful multi-confirmation strategy.
        </span>
        <span className={styles.combineCount}>{selected.length} selected</span>
      </div>

      <div className={styles.combineForm}>
        <input className={styles.genInput} value={name} onChange={e => setName(e.target.value)}
          placeholder="Combined strategy name (optional)" />
        <button className={styles.genBtn} onClick={combine} disabled={selected.length < 2 || combining}>
          {combining ? '⏳ Combining…' : `🔗 Combine ${selected.length} Strategies`}
        </button>
      </div>
      {error && <div className={styles.errorMsg}>{error}</div>}

      {result && (
        <div className={styles.combineResult}>
          <div className={styles.combineResultLabel}>✅ Combined Strategy Created</div>
          <StrategyCard strategy={result} expanded={true} onToggle={() => {}} onApply={() => {}} />
        </div>
      )}

      <div className={styles.combineGrid}>
        {strategies.map(s => (
          <button key={s.id} type="button"
            className={`${styles.combineCard} ${selected.includes(s.id) ? styles.combineCardSelected : ''}`}
            onClick={() => toggleSelect(s.id)}
            aria-pressed={selected.includes(s.id)}>
            <div className={styles.combineCardName}>{s.name}</div>
            <div className={styles.combineCardMeta}>
              <span>{s.category}</span>
              <span className={s.accuracy >= 75 ? styles.accGood : styles.accWarn}>{s.accuracy}%</span>
              <span>{s.instrType}</span>
            </div>
            {selected.includes(s.id) && <span className={styles.combineCheck}>✓</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Tab 4: Intel Hub ──────────────────────────────────────────────────────────

function IntelTab() {
  const [symbol,     setSymbol]     = useState('')
  const [timeframe,  setTimeframe]  = useState('1 month')
  const [question,   setQuestion]   = useState('')
  const [newsInput,  setNewsInput]  = useState('')
  const [docText,    setDocText]    = useState('')
  const [imageB64,   setImageB64]   = useState(null)
  const [imageName,  setImageName]  = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [result,     setResult]     = useState(null)
  const [error,      setError]      = useState(null)
  const fileRef = useRef()

  function handleImageFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageName(file.name)
    const reader = new FileReader()
    reader.onload = ev => setImageB64(ev.target.result.split(',')[1])
    reader.readAsDataURL(file)
  }

  async function analyze() {
    setLoading(true); setError(null); setResult(null)
    const headlines = newsInput.split('\n').map(s => s.trim()).filter(Boolean)
    try {
      const d = await apiFetch('/api/strategy-ai/intel', {
        method: 'POST',
        body: JSON.stringify({
          symbol: symbol || undefined,
          timeframe,
          question: question || undefined,
          newsHeadlines: headlines.length ? headlines : undefined,
          docText: docText || undefined,
          imageBase64: imageB64 || undefined,
        }),
      })
      if (d.ok) setResult(d)
      else setError(d.error ?? 'Analysis failed')
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className={styles.tabContent}>
      <div className={styles.intelDesc}>
        Feed any combination of inputs — chart images, financial documents, news headlines — and get AI-powered analysis with strategy recommendations.
      </div>

      <div className={styles.intelForm}>
        <div className={styles.intelRow}>
          <div className={styles.genField}>
            <label className={styles.genLabel}>Symbol (optional)</label>
            <GlobalSymbolPicker value={symbol} onChange={setSymbol} placeholder="Any symbol" />
          </div>
          <div className={styles.genField}>
            <label className={styles.genLabel}>Timeframe</label>
            <select className={styles.genSelect} value={timeframe} onChange={e => setTimeframe(e.target.value)}>
              <option>Intraday</option><option>1 week</option><option>1 month</option>
              <option>3 months</option><option>6 months</option><option>1 year</option>
            </select>
          </div>
        </div>

        <div className={styles.genField}>
          <label className={styles.genLabel}>Your question / analysis request</label>
          <textarea className={styles.genTextarea} rows={2} value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="e.g. Is this stock a good buy? What does this chart pattern suggest? Should I hold or exit?" />
        </div>

        <div className={styles.intelRow}>
          <div className={styles.genField} style={{ flex: 1 }}>
            <label className={styles.genLabel}>📰 News headlines (one per line)</label>
            <textarea className={styles.genTextarea} rows={4} value={newsInput}
              onChange={e => setNewsInput(e.target.value)}
              placeholder={'RBI holds rates at 6.5%\nNifty hits all-time high\nReliance Q4 profit up 18%'} />
          </div>
          <div className={styles.genField} style={{ flex: 1 }}>
            <label className={styles.genLabel}>📄 Financial document / statement text</label>
            <textarea className={styles.genTextarea} rows={4} value={docText}
              onChange={e => setDocText(e.target.value)}
              placeholder="Paste balance sheet, P&L, annual report excerpts, or any financial text…" />
          </div>
        </div>

        <div className={styles.genField}>
          <label className={styles.genLabel}>📊 Chart / image upload</label>
          <div className={styles.imageUpload} onClick={() => fileRef.current?.click()}>
            {imageName
              ? <span className={styles.imageUploaded}>✓ {imageName}</span>
              : <span className={styles.imageUploadHint}>Click to upload chart image (PNG/JPG)</span>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageFile} />
        </div>

        <button className={styles.genBtn} onClick={analyze}
          disabled={loading || (!symbol && !question && !newsInput && !docText && !imageB64)}>
          {loading ? '⏳ Analyzing…' : '🧠 Analyze & Get Strategy Recommendations'}
        </button>
        {error && <div className={styles.errorMsg}>{error}</div>}
      </div>

      {result && (
        <div className={styles.intelResult}>
          <div className={styles.intelResultHeader}>
            <span className={styles.intelResultTitle}>AI Analysis</span>
            <span className={styles.intelResultMeta}>{result.symbol ?? 'Market'} · {timeframe}</span>
          </div>
          <div className={styles.intelContent}>{result.analysis?.content}</div>
          {result.inputSummary && (
            <div className={styles.intelSummary}>Inputs analyzed: {result.inputSummary}</div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Tab 5: Stock Picker ───────────────────────────────────────────────────────

function PickerTab() {
  const [timeframe,  setTimeframe]  = useState('3-6 months')
  const [riskLevel,  setRiskLevel]  = useState('medium')
  const [capital,    setCapital]    = useState(100000)
  const [sector,     setSector]     = useState('')
  const [instrType,  setInstrType]  = useState('Equity')
  const [loading,    setLoading]    = useState(false)
  const [result,     setResult]     = useState(null)
  const [error,      setError]      = useState(null)

  async function pick() {
    setLoading(true); setError(null); setResult(null)
    try {
      const d = await apiFetch('/api/strategy-ai/stock-pick', {
        method: 'POST',
        body: JSON.stringify({ timeframe, riskLevel, capital: Number(capital), sector, instrType }),
      })
      if (d.ok) setResult(d)
      else setError(d.error ?? 'Stock pick failed')
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className={styles.tabContent}>
      <div className={styles.intelDesc}>
        AI picks the best stocks/instruments for your timeframe and risk profile. All picks are AI-generated suggestions — not financial advice.
      </div>

      <div className={styles.pickerForm}>
        <div className={styles.intelRow}>
          <div className={styles.genField}>
            <label className={styles.genLabel}>Timeframe</label>
            <select className={styles.genSelect} value={timeframe} onChange={e => setTimeframe(e.target.value)}>
              <option>1-3 months</option><option>3-6 months</option>
              <option>6-12 months</option><option>1-2 years</option><option>2+ years</option>
            </select>
          </div>
          <div className={styles.genField}>
            <label className={styles.genLabel}>Risk Level</label>
            <select className={styles.genSelect} value={riskLevel} onChange={e => setRiskLevel(e.target.value)}>
              <option value="low">Low (Large Cap)</option>
              <option value="medium">Medium (Mid Cap)</option>
              <option value="high">High (Small Cap / F&O)</option>
            </select>
          </div>
          <div className={styles.genField}>
            <label className={styles.genLabel}>Capital (₹)</label>
            <input className={styles.genInput} type="number" value={capital}
              onChange={e => setCapital(e.target.value)} min={10000} step={10000} />
          </div>
          <div className={styles.genField}>
            <label className={styles.genLabel}>Sector (optional)</label>
            <select className={styles.genSelect} value={sector} onChange={e => setSector(e.target.value)}>
              <option value="">Any</option>
              <option>Banking</option><option>IT</option><option>Pharma</option>
              <option>Auto</option><option>FMCG</option><option>Energy</option>
              <option>Infra</option><option>Metals</option><option>Realty</option>
            </select>
          </div>
          <div className={styles.genField}>
            <label className={styles.genLabel}>Instrument</label>
            <select className={styles.genSelect} value={instrType} onChange={e => setInstrType(e.target.value)}>
              <option>Equity</option><option>F&O</option><option>ETF</option><option>Index</option>
            </select>
          </div>
        </div>
        <button className={styles.genBtn} onClick={pick} disabled={loading}>
          {loading ? '⏳ Picking…' : '🎯 Pick Best Stocks with AI'}
        </button>
        {error && <div className={styles.errorMsg}>{error}</div>}
      </div>

      {result && (
        <div className={styles.pickerResults}>
          <div className={styles.pickerResultsHeader}>
            AI Stock Picks · {result.timeframe} · {result.riskLevel} risk
          </div>
          <div className={styles.pickerGrid}>
            {(result.picks ?? []).map((p, i) => (
              <div key={i} className={styles.pickerCard}>
                <div className={styles.pickerCardTop}>
                  <span className={styles.pickerSymbol}>{p.symbol ?? p.ticker ?? `Pick ${i+1}`}</span>
                  <span className={styles.pickerConf} style={{ color: (p.confidence ?? 70) >= 75 ? 'var(--color-bull)' : 'var(--color-warn)' }}>
                    {p.confidence ?? 70}% confidence
                  </span>
                </div>
                {p.name && <div className={styles.pickerName}>{p.name}</div>}
                {p.rationale && <div className={styles.pickerRationale}>{p.rationale}</div>}
                <div className={styles.pickerMeta}>
                  {p.target && <span>🎯 Target: {p.target}</span>}
                  {p.stopLoss && <span>🛑 SL: {p.stopLoss}</span>}
                  {p.risk && <span className={p.risk === 'low' ? styles.accGood : styles.accWarn}>Risk: {p.risk}</span>}
                </div>
                {p.riskFactors && <div className={styles.pickerRisk}>⚠ {p.riskFactors}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Shared: Strategy Card ─────────────────────────────────────────────────────

function StrategyCard({ strategy: s, expanded, onToggle, onApply, extraAction }) {
  const navigate = useNavigate()
  const stats    = s.stats ?? {}
  const total    = (stats.hits ?? 0) + (stats.misses ?? 0)
  const liveAcc  = total > 0 ? Math.round(stats.hits / total * 100) : null
  const accColor = (s.accuracy ?? 0) >= 75 ? 'var(--color-bull)' : (s.accuracy ?? 0) >= 65 ? 'var(--color-warn)' : 'var(--color-bear)'

  const sourceLabel = s.source === 'ai_generated' ? '🤖 AI' : s.source === 'user_combined' ? '🔗 Combined' : s.source === 'user_created' ? '👤 User' : '📚 Built-in'

  return (
    <article className={`${styles.card} ${expanded ? styles.cardExpanded : ''}`} aria-label={`Strategy: ${s.name}`}>
      <div className={styles.cardHead}>
        <div className={styles.cardHeadLeft}>
          <div className={styles.cardTopRow}>
            <span className={styles.cardCategory}>{s.category}</span>
            <span className={styles.sourceTag}>{sourceLabel}</span>
          </div>
          <h3 className={styles.cardName}>{s.name}</h3>
          <div className={styles.cardBadges}>
            <span className={`${styles.badge} ${styles[`instr_${s.instrType}`]}`}>{s.instrType}</span>
            <span className={`${styles.badge} ${s.direction === 'long' ? styles.dirLong : s.direction === 'short' ? styles.dirShort : styles.dirBoth}`}>{s.direction}</span>
            <span className={`${styles.badge} ${styles[`cx_${s.complexity}`]}`}>{s.complexity}</span>
          </div>
        </div>
        <div className={styles.cardHeadRight}>
          <div className={styles.accBlock}>
            <span className={styles.accNum} style={{ color: accColor }}>{s.accuracy ?? '—'}%</span>
            <span className={styles.accLabel}>backtest</span>
          </div>
        </div>
      </div>

      {/* Live stats row */}
      <div className={styles.statsRow}>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Applied</span>
          <span className={styles.statVal}>{stats.applied ?? 0}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Hits ✓</span>
          <span className={styles.statVal} style={{ color: 'var(--color-bull)' }}>{stats.hits ?? 0}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Misses ✗</span>
          <span className={styles.statVal} style={{ color: 'var(--color-bear)' }}>{stats.misses ?? 0}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Live Acc</span>
          <span className={styles.statVal} style={{ color: liveAcc != null ? (liveAcc >= 65 ? 'var(--color-bull)' : 'var(--color-warn)') : 'var(--color-text-muted)' }}>
            {liveAcc != null ? `${liveAcc}%` : '—'}
          </span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Win Rate</span>
          <span className={styles.statVal}>{s.winRate ?? '—'}%</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>R:R</span>
          <span className={styles.statVal}>1:{s.avgRR ?? '—'}</span>
        </div>
      </div>

      <p className={styles.description}>{s.description}</p>
      <div className={styles.tags}>{(s.tags ?? []).map(t => <span key={t} className={styles.tag}>{t}</span>)}</div>

      <button className={styles.expandBtn} onClick={onToggle} aria-expanded={expanded}>
        {expanded ? '▲ Less detail' : '▼ Full strategy'}
      </button>

      {expanded && (
        <div className={styles.expandedContent}>
          {s.logic && (
            <div className={styles.expandSection}>
              <h4 className={styles.expandTitle}>Why it works</h4>
              <p className={styles.expandText}>{s.logic}</p>
            </div>
          )}
          {(s.filters ?? []).length > 0 && (
            <div className={styles.expandSection}>
              <h4 className={styles.expandTitle}>Entry Conditions</h4>
              <div className={styles.filterList}>
                {s.filters.map((f, i) => <span key={i} className={styles.filterChip}>{f}</span>)}
              </div>
            </div>
          )}
          <div className={styles.expandGrid}>
            {s.bestFor && (
              <div className={styles.expandSection}>
                <h4 className={styles.expandTitle}>✓ Best for</h4>
                <p className={styles.expandText}>{s.bestFor}</p>
              </div>
            )}
            {s.avoid && (
              <div className={styles.expandSection}>
                <h4 className={styles.expandTitle}>✗ Avoid when</h4>
                <p className={styles.expandText}>{s.avoid}</p>
              </div>
            )}
          </div>
          <div className={styles.expandSection}>
            <h4 className={styles.expandTitle}>Backtest Stats</h4>
            <div className={styles.paramGrid}>
              <div className={styles.paramItem}><span className={styles.paramKey}>Accuracy</span><span className={styles.paramVal}>{s.accuracy}%</span></div>
              <div className={styles.paramItem}><span className={styles.paramKey}>Max DD</span><span className={styles.paramVal}>{s.maxDrawdown}%</span></div>
              <div className={styles.paramItem}><span className={styles.paramKey}>Sharpe</span><span className={styles.paramVal}>{s.sharpe}</span></div>
              <div className={styles.paramItem}><span className={styles.paramKey}>Years</span><span className={styles.paramVal}>{s.backtestYears}y</span></div>
              <div className={styles.paramItem}><span className={styles.paramKey}>Risk</span><span className={styles.paramVal}>{s.risk}</span></div>
            </div>
          </div>
        </div>
      )}

      <div className={styles.cardActions}>
        <button className={styles.applyBtn} onClick={onApply} type="button">⚡ Apply to Predictions</button>
        {extraAction}
      </div>
    </article>
  )
}

// ── Shared: FilterGroup ───────────────────────────────────────────────────────

function FilterGroup({ label, value, options, onChange }) {
  return (
    <div className={styles.filterGroup}>
      <span className={styles.filterLabel}>{label}</span>
      <div className={styles.filterBtns}>
        {options.map(opt => (
          <button key={opt} type="button"
            className={`${styles.filterBtn} ${value === opt ? styles.filterBtnActive : ''}`}
            onClick={() => onChange(opt)}>{opt}</button>
        ))}
      </div>
    </div>
  )
}
