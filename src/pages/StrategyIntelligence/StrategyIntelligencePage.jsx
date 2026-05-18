/**
 * StrategyIntelligencePage — Elite AI strategy analysis for any instrument.
 *
 * Features:
 *   - Select any stock, index, F&O, crypto, forex, commodity
 *   - Run 10 elite AI algorithms simultaneously
 *   - Composite score with grade, consensus, and per-algorithm breakdown
 *   - Batch scan: score up to 20 symbols at once
 *   - Excel/CSV export of scores and signals
 *   - Historical score tracking
 *   - Self-optimizer health panel (admin)
 *   - Full disclaimer compliance
 */

import { useState, useCallback, useMemo } from 'react'
import { useAuthStore } from '@store/authStore.js'
import { useUiPrefsStore } from '@store/uiPrefsStore.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import { Disclaimer } from '@components/Disclaimer.jsx'
import { InfoTooltip } from '@components/InfoTooltip.jsx'
import { sanitizeTicker } from '@utils/sanitize.js'
import {
  scoreSymbol, scoreSymbolBatch, fetchScoreHistory,
  exportScoresCSV, fetchOptimizerHealth, runOptimizationCycle, approveOptimization,
} from '@services/strategyScoreClient.js'
import styles from './StrategyIntelligencePage.module.css'

const PAGE = 'strategy-intelligence'

// ── Preset watchlists ─────────────────────────────────────────────────────────
const WATCHLISTS = {
  'NSE Indices':    [
    { symbol: 'NIFTY50',    exchange: 'NSE' },
    { symbol: 'BANKNIFTY',  exchange: 'NSE' },
    { symbol: 'FINNIFTY',   exchange: 'NSE' },
    { symbol: 'MIDCPNIFTY', exchange: 'NSE' },
    { symbol: 'NIFTYIT',    exchange: 'NSE' },
  ],
  'Top Equities':   [
    { symbol: 'RELIANCE',  exchange: 'NSE' },
    { symbol: 'TCS',       exchange: 'NSE' },
    { symbol: 'HDFCBANK',  exchange: 'NSE' },
    { symbol: 'INFY',      exchange: 'NSE' },
    { symbol: 'ICICIBANK', exchange: 'NSE' },
    { symbol: 'SBIN',      exchange: 'NSE' },
    { symbol: 'WIPRO',     exchange: 'NSE' },
    { symbol: 'AXISBANK',  exchange: 'NSE' },
  ],
  'Crypto':         [
    { symbol: 'BTCUSDT', exchange: 'CRYPTO' },
    { symbol: 'ETHUSDT', exchange: 'CRYPTO' },
    { symbol: 'BNBUSDT', exchange: 'CRYPTO' },
    { symbol: 'SOLUSDT', exchange: 'CRYPTO' },
  ],
  'Global Indices': [
    { symbol: 'SPX',  exchange: 'NYSE' },
    { symbol: 'NDX',  exchange: 'NASDAQ' },
    { symbol: 'DJI',  exchange: 'NYSE' },
    { symbol: 'FTSE', exchange: 'LSE' },
    { symbol: 'N225', exchange: 'TSE' },
  ],
  'Commodities':    [
    { symbol: 'GOLD',      exchange: 'COMEX' },
    { symbol: 'SILVER',    exchange: 'COMEX' },
    { symbol: 'CRUDEOIL',  exchange: 'NYMEX' },
    { symbol: 'NATURALGAS',exchange: 'NYMEX' },
  ],
  'Forex':          [
    { symbol: 'USDINR', exchange: 'FOREX' },
    { symbol: 'EURUSD', exchange: 'FOREX' },
    { symbol: 'GBPUSD', exchange: 'FOREX' },
    { symbol: 'USDJPY', exchange: 'FOREX' },
  ],
}

const REGIMES = ['trending', 'ranging', 'volatile', 'low_liquidity']

export default function StrategyIntelligencePage() {
  const token   = useAuthStore(s => s.token)
  const user    = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin'
  const { isTooltipVisible, setPageTooltips, showExamples, setShowExamples } = useUiPrefsStore()
  const pageEnabled = isTooltipVisible(PAGE)

  const [activeTab, setActiveTab] = useState('single')

  return (
    <div className={styles.page}>
      {/* ── Header ── */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>
            Strategy Intelligence
            <InfoTooltip page={PAGE} title="Strategy Intelligence"
              content="10 elite AI algorithms analyze any instrument simultaneously — from Ichimoku Cloud to Smart Money Concepts — and produce a composite score with grade and consensus signal."
              example={{ text: 'NIFTY50 scores 84/100 (Grade A+) with 8/10 algorithms bullish — high-confidence long setup.' }} />
          </h1>
          <p className={styles.subtitle}>
            10 elite algorithms · composite scoring · batch scan · Excel export
          </p>
        </div>
        <div className={styles.tooltipControls}>
          <label className={styles.tooltipToggle}>
            <input type="checkbox" checked={pageEnabled}
              onChange={e => setPageTooltips(PAGE, e.target.checked)} />
            <span>ⓘ Tips</span>
          </label>
          {pageEnabled && (
            <label className={styles.tooltipToggle}>
              <input type="checkbox" checked={showExamples}
                onChange={e => setShowExamples(e.target.checked)} />
              <span>Examples</span>
            </label>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className={styles.tabs} role="tablist">
        {[
          ['single',    '🎯 Single Symbol'],
          ['batch',     '📊 Batch Scan'],
          ['history',   '📋 History'],
          ...(isAdmin ? [['optimizer', '🤖 AI Self-Optimizer']] : []),
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
        {activeTab === 'single'    && <SingleSymbolTab token={token} page={PAGE} />}
        {activeTab === 'batch'     && <BatchScanTab    token={token} page={PAGE} />}
        {activeTab === 'history'   && <HistoryTab      token={token} page={PAGE} />}
        {activeTab === 'optimizer' && isAdmin && <OptimizerTab token={token} page={PAGE} />}
      </ErrorBoundary>

      <Disclaimer />
    </div>
  )
}

// ── Single Symbol Tab ─────────────────────────────────────────────────────────

function SingleSymbolTab({ token, page }) {
  const [symbol,   setSymbol]   = useState('NIFTY50')
  const [exchange, setExchange] = useState('NSE')
  const [regime,   setRegime]   = useState('trending')
  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState(null)
  const [error,    setError]    = useState('')

  async function handleScore(e) {
    e.preventDefault()
    const r = sanitizeTicker(symbol)
    if (!r.ok) { setError('Invalid symbol'); return }

    setLoading(true); setError(''); setResult(null)
    try {
      const data = await scoreSymbol(r.value, exchange, regime, token)
      if (data.error) { setError(data.error); return }
      setResult(data)
    } catch (err) {
      setError(err?.message ?? 'Scoring failed — is the AI backend running?')
    } finally {
      setLoading(false)
    }
  }

  function handleExportExcel() {
    if (!result) return
    exportScoreAsExcel(result)
  }

  return (
    <div className={styles.tabContent}>
      <form className={styles.scoreForm} onSubmit={handleScore} noValidate>
        <div className={styles.formRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="si-symbol">
              Symbol
              <InfoTooltip page={page} title="Symbol" content="Enter any NSE/BSE equity, index, crypto, forex, or commodity symbol." example={{ text: 'NIFTY50, RELIANCE, BTCUSDT, GOLD, EURUSD' }} />
            </label>
            <input id="si-symbol" className={styles.input} value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              placeholder="e.g. NIFTY50" maxLength={20} disabled={loading} />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="si-exchange">Exchange</label>
            <select id="si-exchange" className={styles.select} value={exchange}
              onChange={e => setExchange(e.target.value)} disabled={loading}>
              <option value="NSE">NSE</option>
              <option value="BSE">BSE</option>
              <option value="CRYPTO">Crypto</option>
              <option value="FOREX">Forex</option>
              <option value="COMEX">COMEX</option>
              <option value="NYMEX">NYMEX</option>
              <option value="NYSE">NYSE</option>
              <option value="NASDAQ">NASDAQ</option>
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="si-regime">
              Market Regime
              <InfoTooltip page={page} title="Market Regime" content="The current market condition. Affects which algorithms get higher weight in the composite score." />
            </label>
            <select id="si-regime" className={styles.select} value={regime}
              onChange={e => setRegime(e.target.value)} disabled={loading}>
              {REGIMES.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
            </select>
          </div>

          <button className={styles.scoreBtn} type="submit" disabled={loading}>
            {loading ? <><span className={styles.spinner} />Analysing…</> : '⚡ Score Symbol'}
          </button>
        </div>
      </form>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {loading && <ScoringLoader />}
      {result && (
        <ErrorBoundary>
          <ScoreResult result={result} page={page} onExportExcel={handleExportExcel} />
        </ErrorBoundary>
      )}
    </div>
  )
}

function ScoringLoader() {
  const algos = ['Ensemble ML', 'Technical Confluence', 'Volatility-Adjusted', 'Trend Strength',
                 'Mean Reversion', 'Breakout Probability', 'Smart Money (ICT)',
                 'Ichimoku Cloud', 'Market Profile', 'Fibonacci']
  return (
    <div className={styles.loader}>
      <div className={styles.loaderTitle}>Running 10 elite algorithms…</div>
      <div className={styles.loaderGrid}>
        {algos.map((a, i) => (
          <div key={a} className={styles.loaderItem} style={{ animationDelay: `${i * 0.12}s` }}>
            <span className={styles.loaderDot} />
            <span>{a}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Score Result ──────────────────────────────────────────────────────────────

function ScoreResult({ result: r, page, onExportExcel }) {
  const [expanded, setExpanded] = useState(null)

  const gradeColor = {
    'A+': 'var(--color-bull)', 'A': 'var(--color-bull)',
    'B':  'var(--color-warn)', 'C': 'var(--color-warn)', 'D': 'var(--color-bear)',
  }[r.grade] ?? 'var(--color-text-muted)'

  const consensusColor = r.consensus === 'BULL' ? 'var(--color-bull)'
    : r.consensus === 'BEAR' ? 'var(--color-bear)' : 'var(--color-text-muted)'

  return (
    <div className={styles.scoreResult}>
      {/* ── Hero score ── */}
      <div className={styles.scoreHero}>
        <div className={styles.scoreHeroLeft}>
          <div className={styles.scoreSymbol}>{r.symbol}</div>
          <div className={styles.scoreExchange}>{r.exchange} · {r.regime}</div>
          {r.warning && <div className={styles.scoreWarning}>⚠ {r.warning}</div>}
        </div>

        <div className={styles.scoreHeroCenter}>
          <div className={styles.scoreCircle}>
            <svg viewBox="0 0 120 120" className={styles.scoreArc}>
              <circle cx="60" cy="60" r="50" fill="none" stroke="var(--color-border)" strokeWidth="8" />
              <circle cx="60" cy="60" r="50" fill="none"
                stroke={gradeColor} strokeWidth="8"
                strokeDasharray={`${r.compositeScore * 3.14} 314`}
                strokeLinecap="round"
                transform="rotate(-90 60 60)" />
            </svg>
            <div className={styles.scoreNum}>{r.compositeScore}</div>
            <div className={styles.scoreGrade} style={{ color: gradeColor }}>{r.grade}</div>
          </div>
          <div className={styles.scoreLabel}>Composite Score</div>
        </div>

        <div className={styles.scoreHeroRight}>
          <div className={styles.consensusBlock}>
            <span className={styles.consensusLabel}>Consensus</span>
            <span className={styles.consensusValue} style={{ color: consensusColor }}>
              {r.consensus === 'BULL' ? '▲ BULLISH' : r.consensus === 'BEAR' ? '▼ BEARISH' : '◆ NEUTRAL'}
            </span>
          </div>
          <div className={styles.voteRow}>
            <span className={styles.voteBull}>▲ {r.bullCount} Bull</span>
            <span className={styles.voteBear}>▼ {r.bearCount} Bear</span>
          </div>
          <div className={styles.confRow}>
            Avg confidence: <strong>{r.avgConfidence}%</strong>
          </div>
          <div className={styles.complementNote}>
            {r.compositeScore}% means ~{100 - r.compositeScore}% chance of being wrong
            <InfoTooltip page={page} title="Complement Label"
              content="Every probability has a complement. A 78% score means 22% chance the signal is wrong. Never risk more than you can afford to lose." />
          </div>
        </div>
      </div>

      {/* ── Export buttons ── */}
      <div className={styles.exportRow}>
        <button className={styles.exportBtn} onClick={onExportExcel} type="button">
          📥 Export Excel
        </button>
        <button className={styles.exportBtn} onClick={() => exportScoreAsCSV(r)} type="button">
          📄 Export CSV
        </button>
      </div>

      {/* ── Algorithm breakdown ── */}
      <div className={styles.algoSection}>
        <h3 className={styles.algoTitle}>
          Algorithm Breakdown
          <InfoTooltip page={page} title="Algorithm Breakdown"
            content="Each of the 10 algorithms scores the instrument independently. The composite score is a weighted average based on the market regime." />
        </h3>
        <div className={styles.algoGrid}>
          {(r.algorithms ?? []).map(algo => (
            <AlgoCard key={algo.id} algo={algo} page={page}
              expanded={expanded === algo.id}
              onToggle={() => setExpanded(expanded === algo.id ? null : algo.id)} />
          ))}
        </div>
      </div>
    </div>
  )
}

function AlgoCard({ algo, page, expanded, onToggle }) {
  const scoreColor = algo.score >= 70 ? 'var(--color-bull)'
    : algo.score >= 50 ? 'var(--color-warn)' : 'var(--color-bear)'
  const signalColor = algo.signal === 'BULL' ? 'var(--color-bull)'
    : algo.signal === 'BEAR' ? 'var(--color-bear)' : 'var(--color-text-muted)'

  return (
    <div className={`${styles.algoCard} ${expanded ? styles.algoCardExpanded : ''}`}>
      <div className={styles.algoCardHead} onClick={onToggle} role="button"
        tabIndex={0} onKeyDown={e => e.key === 'Enter' && onToggle()}
        aria-expanded={expanded}>
        <div className={styles.algoCardLeft}>
          <span className={styles.algoName}>{algo.name}</span>
          <span className={styles.algoWeight}>weight: {algo.weight}%</span>
        </div>
        <div className={styles.algoCardRight}>
          <span className={styles.algoSignal} style={{ color: signalColor }}>
            {algo.signal === 'BULL' ? '▲' : algo.signal === 'BEAR' ? '▼' : '◆'} {algo.signal}
          </span>
          <span className={styles.algoScore} style={{ color: scoreColor }}>{algo.score}</span>
          <div className={styles.algoBar}>
            <div className={styles.algoBarFill} style={{ width: `${algo.score}%`, background: scoreColor }} />
          </div>
        </div>
      </div>

      {expanded && (
        <div className={styles.algoDetail}>
          <div className={styles.algoConf}>Confidence: {algo.confidence}%</div>
          {(algo.reasons ?? []).map((r, i) => (
            <div key={i} className={styles.algoReason}>• {r}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Batch Scan Tab ────────────────────────────────────────────────────────────

function BatchScanTab({ token, page }) {
  const [selectedList, setSelectedList] = useState('NSE Indices')
  const [customSymbols, setCustomSymbols] = useState('')
  const [regime,   setRegime]   = useState('trending')
  const [loading,  setLoading]  = useState(false)
  const [results,  setResults]  = useState([])
  const [error,    setError]    = useState('')

  const symbolsToScan = useMemo(() => {
    if (customSymbols.trim()) {
      return customSymbols.split(/[\n,]+/).map(s => s.trim().toUpperCase())
        .filter(Boolean).slice(0, 20)
        .map(s => ({ symbol: s, exchange: 'NSE', regime }))
    }
    return (WATCHLISTS[selectedList] ?? []).map(s => ({ ...s, regime }))
  }, [selectedList, customSymbols, regime])

  async function handleScan() {
    if (!symbolsToScan.length) return
    setLoading(true); setError(''); setResults([])
    try {
      const data = await scoreSymbolBatch(symbolsToScan, token)
      setResults(data.results ?? [])
    } catch (err) {
      setError(err?.message ?? 'Batch scan failed')
    } finally {
      setLoading(false)
    }
  }

  function handleExportBatch() {
    if (!results.length) return
    exportBatchAsExcel(results)
  }

  return (
    <div className={styles.tabContent}>
      <div className={styles.batchControls}>
        <div className={styles.field}>
          <label className={styles.label}>Preset Watchlist</label>
          <div className={styles.watchlistBtns}>
            {Object.keys(WATCHLISTS).map(name => (
              <button key={name} type="button"
                className={`${styles.watchlistBtn} ${selectedList === name && !customSymbols ? styles.watchlistBtnActive : ''}`}
                onClick={() => { setSelectedList(name); setCustomSymbols('') }}>
                {name}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>
            Custom Symbols (comma or newline separated, max 20)
            <InfoTooltip page={page} title="Custom Symbols" content="Enter your own list of symbols to scan. Overrides the preset watchlist." />
          </label>
          <textarea className={styles.textarea} value={customSymbols}
            onChange={e => setCustomSymbols(e.target.value)}
            placeholder="RELIANCE, TCS, HDFCBANK, INFY…" rows={3} />
        </div>

        <div className={styles.batchRow}>
          <div className={styles.field}>
            <label className={styles.label}>Regime</label>
            <select className={styles.select} value={regime} onChange={e => setRegime(e.target.value)}>
              {REGIMES.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div className={styles.batchInfo}>
            {symbolsToScan.length} symbol{symbolsToScan.length !== 1 ? 's' : ''} queued
          </div>
          <button className={styles.scoreBtn} onClick={handleScan} disabled={loading || !symbolsToScan.length} type="button">
            {loading ? <><span className={styles.spinner} />Scanning…</> : `⚡ Scan ${symbolsToScan.length} Symbols`}
          </button>
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {results.length > 0 && (
        <div className={styles.batchResults}>
          <div className={styles.batchResultsHeader}>
            <span>{results.length} results · sorted by score</span>
            <button className={styles.exportBtn} onClick={handleExportBatch} type="button">
              📥 Export Excel
            </button>
          </div>
          <div className={styles.batchTable}>
            <div className={styles.batchTableHead}>
              <span>Symbol</span><span>Score</span><span>Grade</span>
              <span>Consensus</span><span>Bull/Bear</span><span>Confidence</span>
            </div>
            {results.map((r, i) => (
              <BatchRow key={r.symbol ?? i} result={r} rank={i + 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function BatchRow({ result: r, rank }) {
  const gradeColor = { 'A+': 'var(--color-bull)', 'A': 'var(--color-bull)',
    'B': 'var(--color-warn)', 'C': 'var(--color-warn)', 'D': 'var(--color-bear)' }[r.grade] ?? 'var(--color-text-muted)'
  const consColor = r.consensus === 'BULL' ? 'var(--color-bull)'
    : r.consensus === 'BEAR' ? 'var(--color-bear)' : 'var(--color-text-muted)'

  if (r.error) {
    return (
      <div className={`${styles.batchRow} ${styles.batchRowError}`}>
        <span>#{rank} {r.symbol}</span>
        <span colSpan={5} className={styles.batchError}>Error: {r.error}</span>
      </div>
    )
  }

  return (
    <div className={styles.batchRow}>
      <span className={styles.batchSymbol}>#{rank} {r.symbol}</span>
      <span>
        <span className={styles.batchScore} style={{ color: gradeColor }}>{r.compositeScore}</span>
        <div className={styles.batchBar}>
          <div className={styles.batchBarFill} style={{ width: `${r.compositeScore}%`, background: gradeColor }} />
        </div>
      </span>
      <span style={{ color: gradeColor, fontWeight: 700 }}>{r.grade}</span>
      <span style={{ color: consColor }}>
        {r.consensus === 'BULL' ? '▲' : r.consensus === 'BEAR' ? '▼' : '◆'} {r.consensus}
      </span>
      <span className={styles.batchVotes}>
        <span className={styles.voteBull}>▲{r.bullCount}</span>
        <span className={styles.voteBear}>▼{r.bearCount}</span>
      </span>
      <span className={styles.batchConf}>{r.avgConfidence}%</span>
    </div>
  )
}

// ── History Tab ───────────────────────────────────────────────────────────────

function HistoryTab({ token, page }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [loaded,  setLoaded]  = useState(false)
  const [error,   setError]   = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      const data = await fetchScoreHistory(token)
      setHistory(Array.isArray(data) ? data : [])
      setLoaded(true)
    } catch { setError('Failed to load history') }
    finally { setLoading(false) }
  }

  function handleExport() {
    exportScoresCSV(token)
  }

  return (
    <div className={styles.tabContent}>
      <div className={styles.historyHeader}>
        <button className={styles.loadBtn} onClick={load} disabled={loading} type="button">
          {loading ? 'Loading…' : loaded ? '↺ Refresh' : 'Load History'}
        </button>
        {loaded && history.length > 0 && (
          <button className={styles.exportBtn} onClick={handleExport} type="button">
            📥 Export CSV
          </button>
        )}
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {loaded && history.length === 0 && (
        <div className={styles.empty}>No scoring history yet. Score a symbol to get started.</div>
      )}

      {history.length > 0 && (
        <div className={styles.historyList}>
          {history.map(h => (
            <div key={h.id} className={styles.historyRow}>
              <span className={styles.histSymbol}>{h.symbol}</span>
              <span className={styles.histExchange}>{h.exchange}</span>
              <span className={styles.histScore}
                style={{ color: h.grade === 'A+' || h.grade === 'A' ? 'var(--color-bull)' : h.grade === 'D' ? 'var(--color-bear)' : 'var(--color-warn)' }}>
                {h.compositeScore} ({h.grade})
              </span>
              <span className={styles.histConsensus}
                style={{ color: h.consensus === 'BULL' ? 'var(--color-bull)' : h.consensus === 'BEAR' ? 'var(--color-bear)' : 'var(--color-text-muted)' }}>
                {h.consensus}
              </span>
              <span className={styles.histDate}>
                {new Date(h.timestamp).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Self-Optimizer Tab (admin only) ───────────────────────────────────────────

function OptimizerTab({ token, page }) {
  const [health,   setHealth]   = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [optResult, setOptResult] = useState(null)
  const [error,    setError]    = useState('')

  async function loadHealth() {
    setLoading(true); setError('')
    try {
      const data = await fetchOptimizerHealth(token)
      setHealth(data)
    } catch { setError('AI backend unavailable') }
    finally { setLoading(false) }
  }

  async function handleOptimize() {
    setLoading(true); setError('')
    try {
      const data = await runOptimizationCycle(token)
      setOptResult(data)
    } catch { setError('Optimization failed') }
    finally { setLoading(false) }
  }

  async function handleApprove(approved) {
    if (!optResult) return
    try {
      await approveOptimization(optResult.cycle, approved, optResult.proposed_params, token)
      setOptResult(null)
      await loadHealth()
    } catch { setError('Approval failed') }
  }

  const statusColor = { HEALTHY: 'var(--color-bull)', DEGRADED: 'var(--color-warn)',
    WARNING: 'var(--color-warn)', CRITICAL: 'var(--color-bear)', UNKNOWN: 'var(--color-text-muted)' }

  return (
    <div className={styles.tabContent}>
      <div className={styles.optimizerHeader}>
        <h3 className={styles.optimizerTitle}>
          🤖 AI Self-Optimizer
          <InfoTooltip page={page} title="AI Self-Optimizer"
            content="Monitors prediction accuracy, detects drift, and proposes parameter improvements. ALL changes require admin approval — nothing is auto-applied without human review." />
        </h3>
        <div className={styles.optimizerBtns}>
          <button className={styles.loadBtn} onClick={loadHealth} disabled={loading} type="button">
            {loading ? 'Loading…' : health ? '↺ Refresh' : 'Load Health Report'}
          </button>
          {health && (
            <button className={styles.scoreBtn} onClick={handleOptimize} disabled={loading} type="button">
              ⚡ Run Optimization Cycle
            </button>
          )}
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {health && (
        <div className={styles.healthReport}>
          <div className={styles.healthStatus} style={{ borderColor: statusColor[health.status] ?? 'var(--color-border)' }}>
            <span className={styles.healthStatusLabel}>System Status</span>
            <span className={styles.healthStatusValue} style={{ color: statusColor[health.status] }}>
              {health.status}
            </span>
          </div>

          <div className={styles.healthMetrics}>
            <HealthMetric label="Rolling Accuracy" value={`${health.performance?.rolling_accuracy_pct ?? '—'}%`}
              color={health.performance?.rolling_accuracy_pct >= 75 ? 'bull' : 'bear'} />
            <HealthMetric label="Calibration Error (ECE)" value={`${health.performance?.ece_pct ?? '—'}%`}
              color={health.performance?.ece_pct <= 5 ? 'bull' : health.performance?.ece_pct <= 8 ? 'warn' : 'bear'} />
            <HealthMetric label="Outcomes Tracked" value={health.performance?.outcomes_tracked ?? 0} color="neutral" />
            <HealthMetric label="Drift Detected" value={health.performance?.drift_detected ? 'YES' : 'NO'}
              color={health.performance?.drift_detected ? 'bear' : 'bull'} />
            <HealthMetric label="Uptime" value={`${health.uptime_hours}h`} color="neutral" />
            <HealthMetric label="Optimization Runs" value={health.optimization_runs ?? 0} color="neutral" />
          </div>

          {health.recommendations?.length > 0 && (
            <div className={styles.recommendations}>
              <h4 className={styles.recTitle}>Recommendations</h4>
              {health.recommendations.map(rec => (
                <div key={rec.id} className={`${styles.recCard} ${styles[`rec_${rec.priority.toLowerCase()}`]}`}>
                  <div className={styles.recHead}>
                    <span className={styles.recPriority}>{rec.priority}</span>
                    <span className={styles.recName}>{rec.title}</span>
                    {rec.approval_required && <span className={styles.recApproval}>Requires approval</span>}
                  </div>
                  <p className={styles.recReason}>{rec.reason}</p>
                  <p className={styles.recAction}>Action: {rec.action}</p>
                  <p className={styles.recImpact}>Expected: {rec.impact}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {optResult && (
        <div className={styles.optResult}>
          <h4>Optimization Cycle #{optResult.cycle}</h4>
          <p>Current accuracy: <strong>{optResult.current_accuracy}%</strong></p>
          <p className={styles.optNote}>{optResult.note}</p>
          <div className={styles.optParams}>
            <pre className={styles.optParamsPre}>{JSON.stringify(optResult.proposed_params, null, 2)}</pre>
          </div>
          <div className={styles.optActions}>
            <button className={styles.approveBtn} onClick={() => handleApprove(true)} type="button">
              ✓ Approve & Apply
            </button>
            <button className={styles.rejectBtn} onClick={() => handleApprove(false)} type="button">
              ✕ Reject
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function HealthMetric({ label, value, color }) {
  const colorMap = { bull: 'var(--color-bull)', bear: 'var(--color-bear)', warn: 'var(--color-warn)', neutral: 'var(--color-text-secondary)' }
  return (
    <div className={styles.healthMetric}>
      <span className={styles.healthMetricLabel}>{label}</span>
      <span className={styles.healthMetricValue} style={{ color: colorMap[color] ?? colorMap.neutral }}>{value}</span>
    </div>
  )
}

// ── Excel/CSV Export helpers ──────────────────────────────────────────────────

function exportScoreAsExcel(result) {
  const rows = [
    ['StockMind AI — Strategy Intelligence Report'],
    ['Generated', new Date().toLocaleString('en-IN')],
    ['Symbol', result.symbol, 'Exchange', result.exchange],
    ['Composite Score', result.compositeScore, 'Grade', result.grade],
    ['Consensus', result.consensus, 'Bull Count', result.bullCount, 'Bear Count', result.bearCount],
    ['Avg Confidence', `${result.avgConfidence}%`],
    [],
    ['Algorithm', 'Score', 'Signal', 'Confidence %', 'Weight %', 'Top Reason'],
    ...(result.algorithms ?? []).map(a => [
      a.name, a.score, a.signal, a.confidence, a.weight, a.reasons?.[0] ?? '',
    ]),
    [],
    ['DISCLAIMER: This is AI-generated analysis for informational purposes only. Not financial advice.'],
  ]
  downloadCSV(rows, `strategy-score-${result.symbol}-${new Date().toISOString().slice(0, 10)}.csv`)
}

function exportBatchAsExcel(results) {
  const rows = [
    ['StockMind AI — Batch Strategy Scan'],
    ['Generated', new Date().toLocaleString('en-IN')],
    [],
    ['Rank', 'Symbol', 'Exchange', 'Score', 'Grade', 'Consensus', 'Bull', 'Bear', 'Confidence %'],
    ...results.map((r, i) => [
      i + 1, r.symbol, r.exchange, r.compositeScore, r.grade,
      r.consensus, r.bullCount, r.bearCount, r.avgConfidence,
    ]),
    [],
    ['DISCLAIMER: This is AI-generated analysis for informational purposes only. Not financial advice.'],
  ]
  downloadCSV(rows, `batch-scan-${new Date().toISOString().slice(0, 10)}.csv`)
}

function exportScoreAsCSV(result) {
  exportScoreAsExcel(result)  // same format, .csv extension
}

function downloadCSV(rows, filename) {
  const csv = rows.map(r =>
    r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
