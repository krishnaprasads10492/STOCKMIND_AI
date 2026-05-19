/**
 * AMIPage — Advanced Market Intelligence
 * Multi-timeframe strategies, derivatives matrix, document upload, trendlines.
 */

import { useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@store/authStore.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import { Disclaimer } from '@components/Disclaimer.jsx'
import { ImageAnalyser } from '@components/ImageAnalyser.jsx'
import { sanitizeTicker } from '@utils/sanitize.js'
import { apiFetch } from '@services/apiClient.js'

// Helper: get clean symbol string or null
function cleanSymbol(raw) {
  const r = sanitizeTicker(raw)
  return r.ok ? r.value : null
}
import styles from './AMIPage.module.css'

const TIMEFRAMES = ['5m','15m','1h','1d','1w','1mo','3mo','1y']
const TF_LABELS  = { '5m':'5 Min','15m':'15 Min','1h':'1 Hour','1d':'Daily','1w':'Weekly','1mo':'Monthly','3mo':'Quarterly','1y':'Yearly' }
const VIEWS      = ['Bullish','Bearish','Neutral','Volatile','Range-bound']
const MONEYNESS  = ['All','ATM','OTM','ITM']

export default function AMIPage() {
  const [searchParams] = useSearchParams()
  const token = useAuthStore(s => s.token)

  const [symbol,     setSymbol]     = useState(searchParams.get('symbol') ?? 'NIFTY50')
  const [exchange,   setExchange]   = useState('NSE')
  const [activeTab,  setActiveTab]  = useState('mtf')

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>🧬 Advanced Market Intelligence</h1>
          <p className={styles.subtitle}>Multi-timeframe · Derivatives · Document Analysis · Trendlines</p>
        </div>
        <div className={styles.symbolRow}>
          <input className={styles.symbolInput} value={symbol}
            onChange={e => setSymbol(e.target.value.toUpperCase())}
            placeholder="Symbol e.g. NIFTY50" maxLength={20} />
          <select className={styles.select} value={exchange} onChange={e => setExchange(e.target.value)}>
            <option value="NSE">NSE</option>
            <option value="BSE">BSE</option>
            <option value="CRYPTO">Crypto</option>
          </select>
        </div>
      </div>

      <div className={styles.tabs} role="tablist">
        {[['mtf','📅 Multi-Timeframe'],['deriv','⚙ Derivatives'],['docs','📄 Documents'],['image','📸 Image Analysis'],['danger','⚠ Danger Log']].map(([id,label]) => (
          <button key={id} role="tab" aria-selected={activeTab===id}
            className={`${styles.tab} ${activeTab===id ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(id)}>{label}</button>
        ))}
      </div>

      <ErrorBoundary>
        {activeTab === 'mtf'    && <MTFTab    symbol={symbol} exchange={exchange} token={token} />}
        {activeTab === 'deriv'  && <DerivTab  symbol={symbol} exchange={exchange} token={token} />}
        {activeTab === 'docs'   && <DocsTab   symbol={symbol} exchange={exchange} token={token} />}
        {activeTab === 'image'  && <ImageTab  symbol={symbol} />}
        {activeTab === 'danger' && <DangerTab symbol={symbol} token={token} />}
      </ErrorBoundary>

      <Disclaimer />
    </div>
  )
}

// ── Multi-Timeframe Tab ───────────────────────────────────────────────────────

function MTFTab({ symbol, exchange, token }) {
  const [selectedTFs, setSelectedTFs] = useState(['1d','1w'])
  const [loading,     setLoading]     = useState(false)
  const [results,     setResults]     = useState(null)
  const [error,       setError]       = useState('')

  function toggleTF(tf) {
    setSelectedTFs(prev => prev.includes(tf) ? prev.filter(t => t !== tf) : [...prev, tf])
  }

  async function handleRun() {
    const clean = cleanSymbol(symbol)
    if (!clean) { setError('Invalid symbol'); return }
    setLoading(true); setError(''); setResults(null)
    try {
      const res  = await apiFetch('/api/ami/mtf-signals', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': token },
        body:    JSON.stringify({ symbol: clean, exchange, timeframes: selectedTFs }),
      })
      const data = await res.json()
      setResults(data)
    } catch (e) { setError(e?.message ?? 'Failed') }
    finally { setLoading(false) }
  }

  return (
    <div className={styles.tabContent}>
      <div className={styles.tfSelector}>
        <span className={styles.tfLabel}>Select timeframes:</span>
        {TIMEFRAMES.map(tf => (
          <button key={tf} type="button"
            className={`${styles.tfBtn} ${selectedTFs.includes(tf) ? styles.tfBtnActive : ''}`}
            onClick={() => toggleTF(tf)}>
            {TF_LABELS[tf]}
          </button>
        ))}
        <button className={styles.runBtn} onClick={handleRun} disabled={loading || selectedTFs.length === 0} type="button">
          {loading ? '⏳ Running…' : '▶ Run Analysis'}
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {results && (
        <div className={styles.mtfGrid}>
          {selectedTFs.map(tf => {
            const r = results.results?.[tf]
            const e = results.errors?.[tf]
            return (
              <ErrorBoundary key={tf}>
                <div className={styles.tfColumn}>
                  <div className={styles.tfColHeader}>{TF_LABELS[tf]}</div>
                  {e && <div className={styles.tfError}>{e}</div>}
                  {r?.signals?.map((s, i) => (
                    <SignalCard key={i} signal={s} />
                  ))}
                  {r && !r.signals?.length && <div className={styles.tfEmpty}>No signals</div>}
                </div>
              </ErrorBoundary>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SignalCard({ signal: s }) {
  const dirColor = s.type === 'LONG' ? 'var(--color-bull)' : 'var(--color-bear)'
  const gradeColors = { 'A+':'var(--color-bull)','A':'var(--color-bull)','B':'var(--color-warn)','C':'var(--color-warn)','D':'var(--color-bear)' }
  return (
    <div className={styles.signalCard}>
      <div className={styles.signalHead}>
        <span style={{ color: dirColor, fontWeight: 700 }}>{s.type}</span>
        <span style={{ color: gradeColors[s.grade] ?? 'var(--color-text-muted)' }}>Grade {s.grade}</span>
        <span className={styles.signalProb}>{s.probability}%</span>
      </div>
      <div className={styles.signalLevels}>
        <span>Entry ₹{s.entryPrice?.toLocaleString('en-IN',{maximumFractionDigits:0})}</span>
        <span className={styles.slLevel}>SL ₹{s.stopLoss?.toLocaleString('en-IN',{maximumFractionDigits:0})}</span>
        <span className={styles.t1Level}>T1 ₹{s.t1Price?.toLocaleString('en-IN',{maximumFractionDigits:0})}</span>
      </div>
    </div>
  )
}

// ── Derivatives Tab ───────────────────────────────────────────────────────────

function DerivTab({ symbol, exchange, token }) {
  const [basePrice,  setBasePrice]  = useState('')
  const [marketView, setMarketView] = useState('Neutral')
  const [moneyness,  setMoneyness]  = useState('All')
  const [loading,    setLoading]    = useState(false)
  const [matrix,     setMatrix]     = useState(null)
  const [error,      setError]      = useState('')
  const [expanded,   setExpanded]   = useState(null)

  async function handleCompute() {
    const clean = cleanSymbol(symbol)
    if (!clean) { setError('Invalid symbol'); return }
    if (!basePrice || Number(basePrice) <= 0) { setError('Enter base price'); return }
    setLoading(true); setError(''); setMatrix(null)
    try {
      const res  = await apiFetch('/api/derivatives/matrix', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': token },
        body:    JSON.stringify({ symbol: clean, exchange, basePrice: Number(basePrice), marketView }),
      })
      const data = await res.json()
      setMatrix(data)
    } catch (e) { setError(e?.message ?? 'Failed') }
    finally { setLoading(false) }
  }

  const filtered = matrix?.strategies?.filter(s =>
    moneyness === 'All' || s.moneyness === moneyness
  ) ?? []

  return (
    <div className={styles.tabContent}>
      <div className={styles.derivControls}>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Base Price (₹)</label>
          <input className={styles.input} type="number" value={basePrice}
            onChange={e => setBasePrice(e.target.value)} placeholder="e.g. 22500" />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Market View</label>
          <select className={styles.select} value={marketView} onChange={e => setMarketView(e.target.value)}>
            {VIEWS.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Moneyness</label>
          <select className={styles.select} value={moneyness} onChange={e => setMoneyness(e.target.value)}>
            {MONEYNESS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <button className={styles.runBtn} onClick={handleCompute} disabled={loading} type="button">
          {loading ? '⏳ Computing…' : '⚙ Compute Matrix'}
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {matrix && (
        <div className={styles.derivMatrix}>
          <div className={styles.derivHeader}>
            <span>{symbol} @ ₹{matrix.basePrice} · Strike ₹{matrix.strike} · {matrix.T}d to expiry</span>
            <span className={styles.derivView}>{matrix.marketView} view</span>
          </div>
          {filtered.map((s, i) => (
            <ErrorBoundary key={s.name}>
              <div className={`${styles.stratCard} ${s.recommended ? styles.stratCardTop : ''}`}>
                <div className={styles.stratHead} onClick={() => setExpanded(expanded === i ? null : i)}
                  role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setExpanded(expanded === i ? null : i)}>
                  <div className={styles.stratLeft}>
                    {s.recommended && <span className={styles.topBadge}>⭐ Top Pick</span>}
                    <span className={styles.stratName}>{s.name}</span>
                    <span className={styles.stratMoney}>{s.moneyness}</span>
                  </div>
                  <div className={styles.stratRight}>
                    <span className={styles.stratPoP}>PoP {(s.pop * 100).toFixed(0)}%</span>
                    <span className={styles.stratPremium}>{s.netPremium >= 0 ? '+' : ''}₹{s.netPremium?.toFixed(0)}</span>
                    <span className={styles.expandHint}>{expanded === i ? '▲' : '▼'}</span>
                  </div>
                </div>
                {expanded === i && (
                  <div className={styles.stratDetail}>
                    <div className={styles.stratMetrics}>
                      <MetricPair label="Max Profit" value={s.maxProfit != null ? `₹${s.maxProfit.toFixed(0)}` : '∞'} />
                      <MetricPair label="Max Loss"   value={s.maxLoss   != null ? `₹${s.maxLoss.toFixed(0)}`   : '∞'} />
                      <MetricPair label="Breakeven"  value={s.breakevens?.map(b => `₹${b.toFixed(0)}`).join(' / ')} />
                      <MetricPair label="Δ Delta"    value={s.greeks?.delta} />
                      <MetricPair label="Θ Theta"    value={s.greeks?.theta} />
                      <MetricPair label="ν Vega"     value={s.greeks?.vega} />
                    </div>
                    <div className={styles.stratLegs}>
                      {s.legs?.map((leg, li) => (
                        <span key={li} className={`${styles.legChip} ${leg.action === 'Long' ? styles.legLong : styles.legShort}`}>
                          {leg.action} {leg.type} {leg.strike ? `₹${leg.strike.toFixed(0)}` : ''} {leg.premium ? `@ ₹${leg.premium.toFixed(1)}` : ''}
                        </span>
                      ))}
                    </div>
                    <PayoffDiagram strategy={s} basePrice={matrix.basePrice} />
                  </div>
                )}
              </div>
            </ErrorBoundary>
          ))}
        </div>
      )}
    </div>
  )
}

function MetricPair({ label, value }) {
  return (
    <div className={styles.metricPair}>
      <span className={styles.metricPairLabel}>{label}</span>
      <span className={styles.metricPairValue}>{value ?? '—'}</span>
    </div>
  )
}

function PayoffDiagram({ strategy: s, basePrice }) {
  if (!basePrice) return null
  const range = basePrice * 0.20
  const points = 40
  const step   = (range * 2) / points
  const data   = []

  for (let i = 0; i <= points; i++) {
    const price = basePrice - range + i * step
    // Simplified payoff: approximate from max profit/loss and breakevens
    let pnl = 0
    if (s.breakevens?.length >= 2) {
      const [low, high] = s.breakevens
      if (price < low)  pnl = -(s.maxLoss ?? 0)
      else if (price > high) pnl = -(s.maxLoss ?? 0)
      else pnl = s.maxProfit ?? 0
    } else if (s.breakevens?.length === 1) {
      const be = s.breakevens[0]
      pnl = s.netPremium >= 0
        ? (price > be ? -(s.maxLoss ?? 0) : (s.maxProfit ?? 0))
        : (price > be ? (s.maxProfit ?? 0) : -(s.maxLoss ?? 0))
    }
    data.push({ price: Math.round(price), pnl: Math.round(pnl) })
  }

  const maxAbs = Math.max(...data.map(d => Math.abs(d.pnl)), 1)
  const h = 60
  const w = 280

  return (
    <svg width={w} height={h + 20} className={styles.payoffSvg} aria-label="Payoff diagram">
      <line x1={0} y1={h/2} x2={w} y2={h/2} stroke="var(--color-border)" strokeWidth={1} />
      <polyline
        points={data.map((d, i) => `${(i / points) * w},${h/2 - (d.pnl / maxAbs) * (h/2 - 4)}`).join(' ')}
        fill="none" stroke="var(--color-accent)" strokeWidth={1.5}
      />
      <text x={w/2} y={h+16} textAnchor="middle" fontSize={9} fill="var(--color-text-muted)">
        ₹{Math.round(basePrice - range).toLocaleString('en-IN')} — ₹{Math.round(basePrice + range).toLocaleString('en-IN')}
      </text>
    </svg>
  )
}

// ── Documents Tab ─────────────────────────────────────────────────────────────

function DocsTab({ symbol, exchange, token }) {
  const [file,       setFile]       = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [result,     setResult]     = useState(null)
  const [scenarios,  setScenarios]  = useState([])
  const [error,      setError]      = useState('')
  const [page,       setPage]       = useState(1)
  const [total,      setTotal]      = useState(0)

  async function handleUpload(e) {
    e.preventDefault()
    if (!file) { setError('Select a file first'); return }
    const clean = cleanSymbol(symbol)
    if (!clean) { setError('Invalid symbol'); return }

    setLoading(true); setError(''); setResult(null)
    const form = new FormData()
    form.append('file', file)
    form.append('symbol', clean)
    form.append('exchange', exchange)

    try {
      const res  = await apiFetch('/api/ami/upload-statement', {
        method:  'POST',
        headers: { 'x-session-token': token },
        body:    form,
        timeoutMs: 65_000,
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error ?? 'Upload failed'); return }
      setResult(data)
      setFile(null)
      loadScenarios(clean, 1)
    } catch (e) { setError(e?.message ?? 'Upload failed') }
    finally { setLoading(false) }
  }

  async function loadScenarios(sym, pg) {
    const clean = cleanSymbol(sym ?? symbol)
    if (!clean) return
    try {
      const res  = await apiFetch(`/api/ami/scenarios/${clean}?page=${pg}`, {
        headers: { 'x-session-token': token },
      })
      const data = await res.json()
      setScenarios(data.scenarios ?? [])
      setTotal(data.total ?? 0)
      setPage(pg)
    } catch { /* non-fatal */ }
  }

  return (
    <div className={styles.tabContent}>
      <div className={styles.uploadSection}>
        <h3 className={styles.sectionTitle}>📄 Upload Financial Statement</h3>
        <p className={styles.sectionNote}>
          Upload a PDF or Excel annual report. The system extracts key metrics, correlates with news,
          generates 4 scenario predictions, stores the analysis with a reference, and discards the original file.
        </p>
        <form className={styles.uploadForm} onSubmit={handleUpload}>
          <input type="file" accept=".pdf,.xlsx,.xls"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
            className={styles.fileInput} id="stmt-file" />
          <label htmlFor="stmt-file" className={styles.fileLabel}>
            {file ? `📎 ${file.name}` : '📎 Choose PDF or Excel (max 25 MB)'}
          </label>
          <button className={styles.runBtn} type="submit" disabled={loading || !file}>
            {loading ? '⏳ Processing…' : '⬆ Upload & Analyse'}
          </button>
        </form>
        {error && <div className={styles.error}>{error}</div>}
      </div>

      {result && (
        <div className={styles.uploadResult}>
          <div className={styles.docRef}>📋 Reference: <code>{result.docRef}</code></div>
          <div className={styles.metricsExtracted}>
            <h4>Extracted Metrics</h4>
            <div className={styles.metricsGrid2}>
              {Object.entries(result.metrics ?? {}).map(([k, v]) => (
                <div key={k} className={styles.metricItem2}>
                  <span className={styles.metricKey}>{k.replace(/([A-Z])/g, ' $1').trim()}</span>
                  <span className={styles.metricVal}>{v != null ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : 'Not found'}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.scenarioCards}>
            {result.scenarios?.map(sc => (
              <div key={sc.scenarioName} className={styles.scenarioCard}>
                <div className={styles.scenarioName}>{sc.scenarioName}</div>
                <div className={styles.scenarioProb}>{sc.probability}% probability</div>
                <div className={styles.scenarioMetrics}>
                  {sc.adjustedRevenue != null && <span>Rev: {sc.adjustedRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>}
                  {sc.adjustedProfit  != null && <span>Profit: {sc.adjustedProfit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.scenarioHistory}>
        <div className={styles.scenarioHistoryHeader}>
          <h3 className={styles.sectionTitle}>Stored Scenarios for {symbol}</h3>
          <button className={styles.loadBtn} type="button" onClick={() => loadScenarios(symbol, 1)}>Load</button>
        </div>
        {scenarios.length === 0 && <div className={styles.empty}>No stored scenarios. Upload a financial statement to create one.</div>}
        {scenarios.map(sc => (
          <div key={sc.id} className={styles.historyItem}>
            <span className={styles.historyRef}>Ref: {sc.docRef}</span>
            <span className={styles.historyDate}>{new Date(sc.createdAt).toLocaleDateString('en-IN')}</span>
            <span className={styles.historyCount}>{sc.scenarios?.length ?? 0} scenarios</span>
          </div>
        ))}
        {total > 10 && (
          <div className={styles.pagination}>
            <button disabled={page <= 1} onClick={() => loadScenarios(symbol, page - 1)} type="button">◀</button>
            <span>Page {page} of {Math.ceil(total / 10)}</span>
            <button disabled={page >= Math.ceil(total / 10)} onClick={() => loadScenarios(symbol, page + 1)} type="button">▶</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Image Analysis Tab ────────────────────────────────────────────────────────

function ImageTab({ symbol }) {
  const [lastResult, setLastResult] = useState(null)

  return (
    <div className={styles.tabContent}>
      <div className={styles.imageTabHeader}>
        <h3 className={styles.sectionTitle}>📸 Image Analysis</h3>
        <p className={styles.sectionNote}>
          Drop any chart screenshot, broker terminal, option chain, news headline, or financial data image.
          The AI extracts prices, patterns, support/resistance, indicators, and generates a trading summary.
          Works with Zerodha, Kite, TradingView, NSE, BSE, and any other platform screenshots.
        </p>
      </div>

      <ImageAnalyser
        symbol={symbol}
        onResult={setLastResult}
      />

      {lastResult && (
        <div className={styles.imageActionRow}>
          <p className={styles.sectionNote}>
            ✓ Analysis complete. Use the extracted data to run predictions on the{' '}
            <a href="/predictions" className={styles.inlineLink}>Predictions page</a> or{' '}
            <a href="/ami?tab=mtf" className={styles.inlineLink}>Multi-Timeframe analysis</a>.
          </p>
        </div>
      )}
    </div>
  )
}




function DangerTab({ symbol, token }) {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function load() {
    const clean = cleanSymbol(symbol)
    if (!clean) { setError('Invalid symbol'); return }
    setLoading(true); setError('')
    try {
      const res  = await apiFetch(`/api/ami/danger-log?symbol=${clean}&limit=50`, {
        headers: { 'x-session-token': token },
      })
      const data = await res.json()
      setRecords(data.records ?? [])
    } catch (e) { setError(e?.message ?? 'Failed') }
    finally { setLoading(false) }
  }

  return (
    <div className={styles.tabContent}>
      <div className={styles.dangerHeader}>
        <h3 className={styles.sectionTitle}>⚠ Danger Signal Log — {symbol}</h3>
        <button className={styles.loadBtn} onClick={load} disabled={loading} type="button">
          {loading ? 'Loading…' : 'Load Log'}
        </button>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {records.length === 0 && !loading && <div className={styles.empty}>No danger signals recorded for {symbol}.</div>}
      {records.map((r, i) => (
        <div key={i} className={styles.dangerRecord}>
          <span className={styles.dangerIcon}>⚠</span>
          <div className={styles.dangerInfo}>
            <span className={styles.dangerSymbol}>{r.symbol}</span>
            <span className={styles.dangerDev} style={{ color: 'var(--color-bear)' }}>
              {r.deviationPct?.toFixed(1)}% deviation
            </span>
            <span className={styles.dangerPrice}>Live ₹{r.livePrice?.toLocaleString('en-IN',{maximumFractionDigits:0})} vs SL ₹{r.stopLoss?.toLocaleString('en-IN',{maximumFractionDigits:0})}</span>
          </div>
          <span className={styles.dangerTime}>{new Date(r.timestamp).toLocaleString('en-IN',{dateStyle:'short',timeStyle:'short'})}</span>
        </div>
      ))}
    </div>
  )
}

