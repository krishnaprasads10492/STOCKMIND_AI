/**
 * BacktestPage — Walk-forward backtest + AI strategy builder.
 *
 * Three panels:
 *   1. Run Backtest — pick symbol, run walk-forward, see accuracy + metrics
 *   2. Strategy Builder — type a plain-English strategy, AI converts it to
 *      prediction parameters, shows accuracy impact vs baseline
 *   3. My Strategies — saved strategies with their backtest results
 */

import { useState, useCallback } from 'react'
import { useAuthStore } from '@store/authStore.js'
import { useUiPrefsStore } from '@store/uiPrefsStore.js'
import { useMarketStore, MARKET_MODULES } from '@store/marketStore.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import { Disclaimer } from '@components/Disclaimer.jsx'
import { InfoTooltip } from '@components/InfoTooltip.jsx'
import {
  runBacktest, parseStrategy, saveStrategy,
  fetchStrategies, deleteStrategy,
} from '@services/backtestClient.js'
import { sanitizeTicker } from '@utils/sanitize.js'
import styles from './BacktestPage.module.css'

const PAGE = 'backtest'

// ── Accuracy colour helper ────────────────────────────────────────────────────
function accColor(pct) {
  if (pct == null) return 'var(--color-text-muted)'
  if (pct >= 75)   return 'var(--color-bull)'
  if (pct >= 60)   return 'var(--color-warn)'
  return 'var(--color-bear)'
}

export default function BacktestPage() {
  const { isTooltipVisible, infoTooltips, setInfoTooltips,
          showExamples, setShowExamples, pageTooltips, setPageTooltips } = useUiPrefsStore()
  const pageEnabled = isTooltipVisible(PAGE)

  return (
    <div className={styles.page}>
      {/* ── Page header ── */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>
            Backtest & Strategy Builder
            <InfoTooltip
              page={PAGE}
              title="What is Backtesting?"
              content="Walk-forward backtesting simulates your strategy on 3 years of historical data to measure accuracy before using it in live predictions."
              example={{ text: 'A strategy with 82% backtest accuracy on NIFTY50 means it correctly predicted direction 82 out of 100 times historically.' }}
            />
          </h1>
          <p className={styles.subtitle}>
            Test strategies on historical data · Convert ideas to prediction parameters · See accuracy impact
          </p>
        </div>

        {/* Tooltip controls */}
        <div className={styles.tooltipControls}>
          <label className={styles.tooltipToggle}>
            <input type="checkbox" checked={pageEnabled}
              onChange={e => setPageTooltips(PAGE, e.target.checked)} />
            <span>ⓘ Tips on this page</span>
          </label>
          {pageEnabled && (
            <label className={styles.tooltipToggle}>
              <input type="checkbox" checked={showExamples}
                onChange={e => setShowExamples(e.target.checked)} />
              <span>Show examples</span>
            </label>
          )}
        </div>
      </div>

      {/* ── Three panels ── */}
      <div className={styles.panels}>
        <ErrorBoundary>
          <BacktestPanel page={PAGE} />
        </ErrorBoundary>

        <ErrorBoundary>
          <StrategyBuilderPanel page={PAGE} />
        </ErrorBoundary>

        <ErrorBoundary>
          <MySavedStrategies page={PAGE} />
        </ErrorBoundary>
      </div>

      <Disclaimer />
    </div>
  )
}

// ── Panel 1: Run Backtest ─────────────────────────────────────────────────────

function BacktestPanel({ page }) {
  const { activeModuleId } = useMarketStore()
  const token = useAuthStore(s => s.token)

  const [symbol,   setSymbol]   = useState('NIFTY50')
  const [exchange, setExchange] = useState('NSE')
  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState(null)
  const [error,    setError]    = useState('')

  async function handleRun(e) {
    e.preventDefault()
    const r = sanitizeTicker(symbol)
    if (!r.ok) { setError('Invalid symbol'); return }

    setLoading(true)
    setError('')
    setResult(null)

    try {
      const data = await runBacktest(r.value, exchange, token)
      if (data.error) { setError(data.error); return }
      setResult(data)
    } catch (err) {
      setError(err?.message ?? 'Backtest failed — is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>
          📊 Run Backtest
          <InfoTooltip
            page={page}
            title="Walk-Forward Backtest"
            content="Trains on 2 years of data, tests on 1 year, rolls forward monthly. Accuracy must be 75–97% for the strategy to be considered stable."
            example={{ text: 'NIFTY50 spot: 81% accuracy over 3 years → stable. BANKNIFTY options: 62% → needs retraining.' }}
          />
        </h2>
        <span className={styles.panelBadge}>3-year walk-forward</span>
      </div>

      <form className={styles.form} onSubmit={handleRun} noValidate>
        <div className={styles.formRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="bt-symbol">
              Symbol
              <InfoTooltip page={page} title="Symbol" content="Enter the ticker symbol to backtest. Use NSE symbols for Indian instruments." example={{ text: 'NIFTY50, BANKNIFTY, RELIANCE, TCS' }} />
            </label>
            <input
              id="bt-symbol"
              className={styles.input}
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              placeholder="e.g. NIFTY50"
              maxLength={20}
              disabled={loading}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="bt-exchange">Exchange</label>
            <select id="bt-exchange" className={styles.select}
              value={exchange} onChange={e => setExchange(e.target.value)} disabled={loading}>
              <option value="NSE">NSE</option>
              <option value="BSE">BSE</option>
              <option value="CRYPTO">Crypto</option>
              <option value="FOREX">Forex</option>
            </select>
          </div>

          <button className={styles.runBtn} type="submit" disabled={loading}>
            {loading ? <><span className={styles.spinner} />Running…</> : '▶ Run Backtest'}
          </button>
        </div>
      </form>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {loading && (
        <div className={styles.loadingState}>
          <div className={styles.loadingBar} />
          <p>Fetching 3 years of data and running walk-forward simulation…</p>
        </div>
      )}

      {result && <BacktestResult result={result} page={page} />}
    </section>
  )
}

// ── Backtest result display ───────────────────────────────────────────────────

function BacktestResult({ result: r, page }) {
  const stable = r.stable
  const acc    = r.accuracyPct

  return (
    <div className={`${styles.result} ${stable ? styles.resultStable : styles.resultUnstable}`}>
      {/* Status banner */}
      <div className={`${styles.statusBanner} ${stable ? styles.statusGood : styles.statusBad}`}>
        <span className={styles.statusIcon}>{stable ? '✓' : '⚠'}</span>
        <div>
          <strong>{stable ? 'Strategy Stable' : 'Strategy Unstable'}</strong>
          <p>{r.message}</p>
        </div>
        <span className={styles.accuracyBig} style={{ color: accColor(acc) }}>
          {acc != null ? `${acc}%` : '—'}
        </span>
      </div>

      {/* Metrics grid */}
      {r.metrics && Object.keys(r.metrics).length > 0 && (
        <div className={styles.metricsGrid}>
          <Metric label="T1 Hit Rate"   value={`${r.metrics.t1HitRate}%`}    color="bull" page={page}
            info="Percentage of signals that reached Target 1" />
          <Metric label="T2 Hit Rate"   value={`${r.metrics.t2HitRate}%`}    color="bull" page={page}
            info="Percentage of signals that reached Target 2" />
          <Metric label="SL Hit Rate"   value={`${r.metrics.slHitRate}%`}    color="bear" page={page}
            info="Percentage of signals that hit the stop-loss" />
          <Metric label="Avg R:R"       value={`1:${r.metrics.avgRR}`}       color="neutral" page={page}
            info="Average risk-to-reward ratio across all signals" />
          <Metric label="Avg P&L"       value={`${r.metrics.avgPnlPct > 0 ? '+' : ''}${r.metrics.avgPnlPct}%`}
            color={r.metrics.avgPnlPct >= 0 ? 'bull' : 'bear'} page={page}
            info="Average profit/loss per signal as % of entry price" />
          <Metric label="Sharpe"        value={r.metrics.sharpe?.toFixed(2)} color="neutral" page={page}
            info="Simplified Sharpe ratio — higher is better. >1 is good, >2 is excellent." />
          <Metric label="Max Drawdown"  value={`${r.metrics.maxDrawdownPct}%`} color="bear" page={page}
            info="Largest peak-to-trough loss during the backtest period" />
          <Metric label="Signals Tested" value={r.signalsTested}             color="neutral" page={page}
            info="Total number of signals simulated in the backtest" />
        </div>
      )}

      {/* Data source warning */}
      {r.dataSource === 'mock' && (
        <div className={styles.mockWarning}>
          ⚠ Backtest used estimated data — start the backend for real historical data
        </div>
      )}

      {/* Accuracy gate */}
      <div className={styles.accuracyGate}>
        <div className={styles.gateBar}>
          <div className={styles.gateFloor} style={{ left: '75%' }}>
            <span>75%</span>
          </div>
          <div className={styles.gateCeiling} style={{ left: '97%' }}>
            <span>97%</span>
          </div>
          {acc != null && (
            <div
              className={`${styles.gateMarker} ${stable ? styles.gateMarkerGood : styles.gateMarkerBad}`}
              style={{ left: `${Math.min(99, acc)}%` }}
              title={`${acc}% accuracy`}
            />
          )}
          <div className={styles.gateRange} />
        </div>
        <div className={styles.gateLabels}>
          <span>0%</span>
          <span className={styles.gateStableLabel}>Stable zone (75–97%)</span>
          <span>100%</span>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, color, info, page }) {
  const colorMap = { bull: 'var(--color-bull)', bear: 'var(--color-bear)', neutral: 'var(--color-text-secondary)' }
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>
        {label}
        {info && <InfoTooltip page={page} title={label} content={info} />}
      </span>
      <span className={styles.metricValue} style={{ color: colorMap[color] ?? colorMap.neutral }}>
        {value ?? '—'}
      </span>
    </div>
  )
}

// ── Panel 2: Strategy Builder ─────────────────────────────────────────────────

function StrategyBuilderPanel({ page }) {
  const token = useAuthStore(s => s.token)

  const [input,    setInput]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [parsed,   setParsed]   = useState(null)
  const [impact,   setImpact]   = useState(null)
  const [error,    setError]    = useState('')
  const [saved,    setSaved]    = useState(false)

  const EXAMPLES = [
    'Buy NIFTY50 calls when RSI is below 35 and price is above EMA 20',
    'Short BANKNIFTY futures when price breaks below 20-day low with high volume',
    'Buy ATM NIFTY CE when VIX is below 15 and market is in uptrend',
    'Sell OTM puts on NIFTY when IV rank is above 70%',
  ]

  async function handleParse(e) {
    e.preventDefault()
    if (!input.trim()) return

    setLoading(true)
    setError('')
    setParsed(null)
    setImpact(null)
    setSaved(false)

    try {
      const data = await parseStrategy(input.trim(), token)
      if (data.error) { setError(data.error); return }
      setParsed(data.strategy)
      setImpact(data.impact)
    } catch (err) {
      setError(err?.message ?? 'Failed to parse strategy')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!parsed) return
    try {
      await saveStrategy({ ...parsed, sourceText: input.trim(), impact }, token)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Failed to save strategy')
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>
          🧠 Strategy Builder
          <InfoTooltip
            page={page}
            title="AI Strategy Builder"
            content="Describe your trading idea in plain English. The AI converts it into prediction parameters (instrument, direction, indicators, filters) and estimates the accuracy impact."
            example={{ text: '"Buy NIFTY calls when RSI < 35" → instrType: options, direction: long, filter: rsi14 < 35, estimated +4% accuracy vs baseline.' }}
          />
        </h2>
        <span className={styles.panelBadge}>AI-powered</span>
      </div>

      <form className={styles.form} onSubmit={handleParse} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="strat-input">
            Describe your strategy
            <InfoTooltip
              page={page}
              title="Strategy Description"
              content="Use plain English. Mention: instrument (NIFTY, BANKNIFTY), direction (buy/sell/long/short), indicators (RSI, EMA, volume), and conditions."
              example={{ text: '"Short BANKNIFTY futures when price breaks below 20-day low with 2x average volume"' }}
            />
          </label>
          <textarea
            id="strat-input"
            className={styles.textarea}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="e.g. Buy NIFTY50 calls when RSI is below 35 and price is above EMA 20"
            rows={3}
            maxLength={500}
            disabled={loading}
          />
          <div className={styles.charCount}>{input.length}/500</div>
        </div>

        {/* Quick examples */}
        <div className={styles.examples}>
          <span className={styles.examplesLabel}>Try:</span>
          {EXAMPLES.map((ex, i) => (
            <button
              key={i}
              type="button"
              className={styles.exampleChip}
              onClick={() => setInput(ex)}
              disabled={loading}
            >
              {ex.slice(0, 40)}…
            </button>
          ))}
        </div>

        <button className={styles.runBtn} type="submit" disabled={loading || !input.trim()}>
          {loading ? <><span className={styles.spinner} />Analysing…</> : '⚡ Convert to Strategy'}
        </button>
      </form>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {parsed && (
        <ParsedStrategy
          strategy={parsed}
          impact={impact}
          page={page}
          onSave={handleSave}
          saved={saved}
        />
      )}
    </section>
  )
}

// ── Parsed strategy display ───────────────────────────────────────────────────

function ParsedStrategy({ strategy: s, impact, page, onSave, saved }) {
  const impactColor = impact?.accuracyDelta > 0
    ? 'var(--color-bull)'
    : impact?.accuracyDelta < 0
      ? 'var(--color-bear)'
      : 'var(--color-text-muted)'

  return (
    <div className={styles.parsedResult}>
      <div className={styles.parsedHeader}>
        <span className={styles.parsedTitle}>{s.name}</span>
        <div className={styles.parsedActions}>
          {impact?.accuracyDelta != null && (
            <span className={styles.impactBadge} style={{ color: impactColor }}>
              {impact.accuracyDelta > 0 ? '▲' : impact.accuracyDelta < 0 ? '▼' : '='} {Math.abs(impact.accuracyDelta)}% accuracy
              <InfoTooltip
                page={page}
                title="Accuracy Impact"
                content="Estimated change in prediction accuracy when this strategy filter is applied vs the baseline (no filter)."
                example={{ text: '+4% means applying this strategy historically improved accuracy from 78% to 82%.' }}
              />
            </span>
          )}
          <button
            type="button"
            className={`${styles.saveStratBtn} ${saved ? styles.saveStratSaved : ''}`}
            onClick={onSave}
          >
            {saved ? '✓ Saved' : '+ Save Strategy'}
          </button>
        </div>
      </div>

      {/* Parsed parameters */}
      <div className={styles.parsedParams}>
        <ParamRow label="Instrument"  value={s.instrType}   page={page}
          info="The type of instrument this strategy applies to" />
        <ParamRow label="Direction"   value={s.direction}   page={page}
          info="Long (buy) or Short (sell) or Both" />
        <ParamRow label="Symbol"      value={s.symbol ?? 'Any'} page={page}
          info="Specific symbol or any symbol in the module" />
        <ParamRow label="Module"      value={s.moduleId ?? 'Any'} page={page}
          info="Market module this strategy is designed for" />
        {s.minGrade && <ParamRow label="Min Grade" value={s.minGrade} page={page}
          info="Minimum signal grade to include" />}
        {s.filters?.length > 0 && (
          <div className={styles.paramRow}>
            <span className={styles.paramLabel}>
              Filters
              <InfoTooltip page={page} title="Strategy Filters"
                content="Technical indicator conditions that must be met before a signal is included."
                example={{ text: 'rsi14 < 35 means only include signals when RSI(14) is below 35 (oversold).' }} />
            </span>
            <div className={styles.filterList}>
              {s.filters.map((f, i) => (
                <span key={i} className={styles.filterChip}>{f}</span>
              ))}
            </div>
          </div>
        )}
        {s.confidence != null && (
          <ParamRow label="AI Confidence" value={`${s.confidence}%`} page={page}
            info="How confident the AI is in this strategy interpretation (0–100%)" />
        )}
      </div>

      {/* Impact breakdown */}
      {impact && (
        <div className={styles.impactBreakdown}>
          <div className={styles.impactRow}>
            <span>Baseline accuracy</span>
            <span style={{ color: accColor(impact.baseline) }}>{impact.baseline ?? '—'}%</span>
          </div>
          <div className={styles.impactRow}>
            <span>With this strategy</span>
            <span style={{ color: accColor(impact.withStrategy) }}>{impact.withStrategy ?? '—'}%</span>
          </div>
          <div className={`${styles.impactRow} ${styles.impactTotal}`}>
            <span>Net impact</span>
            <span style={{ color: impactColor }}>
              {impact.accuracyDelta > 0 ? '+' : ''}{impact.accuracyDelta ?? 0}%
            </span>
          </div>
          {impact.note && <p className={styles.impactNote}>{impact.note}</p>}
        </div>
      )}
    </div>
  )
}

function ParamRow({ label, value, info, page }) {
  return (
    <div className={styles.paramRow}>
      <span className={styles.paramLabel}>
        {label}
        {info && <InfoTooltip page={page} title={label} content={info} />}
      </span>
      <span className={styles.paramValue}>{value}</span>
    </div>
  )
}

// ── Panel 3: My Saved Strategies ──────────────────────────────────────────────

function MySavedStrategies({ page }) {
  const token = useAuthStore(s => s.token)
  const [strategies, setStrategies] = useState([])
  const [loading,    setLoading]    = useState(false)
  const [loaded,     setLoaded]     = useState(false)
  const [error,      setError]      = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const data = await fetchStrategies(token)
      setStrategies(Array.isArray(data) ? data : [])
      setLoaded(true)
    } catch {
      setError('Failed to load strategies')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id) {
    try {
      await deleteStrategy(id, token)
      setStrategies(s => s.filter(x => x.id !== id))
    } catch {
      setError('Failed to delete strategy')
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>
          💾 My Strategies
          <InfoTooltip
            page={page}
            title="Saved Strategies"
            content="Strategies you've built and saved. Apply them to prediction generation to filter signals by your criteria."
          />
        </h2>
        <button
          type="button"
          className={styles.loadBtn}
          onClick={load}
          disabled={loading}
        >
          {loading ? 'Loading…' : loaded ? '↺ Refresh' : 'Load Strategies'}
        </button>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {loaded && strategies.length === 0 && (
        <div className={styles.empty}>
          No saved strategies yet. Use the Strategy Builder above to create one.
        </div>
      )}

      {strategies.length > 0 && (
        <div className={styles.strategyList}>
          {strategies.map(s => (
            <StrategyCard key={s.id} strategy={s} onDelete={handleDelete} page={page} />
          ))}
        </div>
      )}
    </section>
  )
}

function StrategyCard({ strategy: s, onDelete, page }) {
  const [expanded, setExpanded] = useState(false)
  const impactColor = (s.impact?.accuracyDelta ?? 0) >= 0 ? 'var(--color-bull)' : 'var(--color-bear)'

  return (
    <div className={styles.strategyCard}>
      <div className={styles.strategyCardHead}>
        <div className={styles.strategyCardLeft}>
          <span className={styles.strategyName}>{s.name}</span>
          <span className={`${styles.instrBadge} ${styles[`instr_${s.instrType}`]}`}>
            {s.instrType}
          </span>
          <span className={`${styles.dirBadge} ${s.direction === 'long' ? styles.dirLong : s.direction === 'short' ? styles.dirShort : ''}`}>
            {s.direction}
          </span>
        </div>
        <div className={styles.strategyCardRight}>
          {s.impact?.accuracyDelta != null && (
            <span className={styles.stratImpact} style={{ color: impactColor }}>
              {s.impact.accuracyDelta > 0 ? '▲' : '▼'} {Math.abs(s.impact.accuracyDelta)}%
            </span>
          )}
          <button type="button" className={styles.expandBtn}
            onClick={() => setExpanded(x => !x)} aria-expanded={expanded}>
            {expanded ? '▲' : '▼'}
          </button>
          <button type="button" className={styles.deleteBtn}
            onClick={() => onDelete(s.id)} aria-label={`Delete ${s.name}`}>
            ✕
          </button>
        </div>
      </div>

      {s.sourceText && (
        <p className={styles.strategySource}>"{s.sourceText}"</p>
      )}

      {expanded && (
        <div className={styles.strategyDetails}>
          {s.filters?.length > 0 && (
            <div className={styles.filterList}>
              {s.filters.map((f, i) => <span key={i} className={styles.filterChip}>{f}</span>)}
            </div>
          )}
          {s.backtestResult && (
            <div className={styles.miniBacktest}>
              <span>Backtest: </span>
              <span style={{ color: accColor(s.backtestResult.accuracyPct) }}>
                {s.backtestResult.accuracyPct}% accuracy
              </span>
              <span className={styles.miniMeta}> · {s.backtestResult.signalsTested} signals</span>
            </div>
          )}
          <span className={styles.strategyDate}>
            Saved {new Date(s.createdAt).toLocaleDateString('en-IN')}
          </span>
        </div>
      )}
    </div>
  )
}
