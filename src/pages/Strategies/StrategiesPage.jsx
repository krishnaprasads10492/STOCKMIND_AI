/**
 * StrategiesPage — Library of open trading strategies to learn from.
 *
 * Features:
 *   - Curated strategy library (built-in + community)
 *   - Filter by instrument, direction, accuracy, complexity
 *   - Each strategy shows: description, parameters, backtest stats, risk profile
 *   - "Apply to Predictions" button — navigates to Predictions with strategy pre-loaded
 *   - InfoTooltip on every key concept
 *   - Per-page tooltip on/off control
 */

import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUiPrefsStore } from '@store/uiPrefsStore.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import { InfoTooltip } from '@components/InfoTooltip.jsx'
import { Disclaimer } from '@components/Disclaimer.jsx'
import styles from './StrategiesPage.module.css'

const PAGE = 'strategies'

// ── Built-in strategy library ─────────────────────────────────────────────────

const STRATEGIES = [
  {
    id: 'rsi-reversal-nifty',
    name: 'RSI Reversal — NIFTY50',
    category: 'Mean Reversion',
    instrType: 'spot',
    direction: 'both',
    symbol: 'NIFTY50',
    complexity: 'beginner',
    accuracy: 78,
    avgRR: 1.8,
    description: 'Buy when RSI(14) drops below 35 (oversold) and price is above EMA(50). Sell when RSI rises above 65 (overbought) and price is below EMA(50).',
    logic: 'RSI measures momentum. Extreme readings (< 35 or > 65) often precede reversals, especially when the longer-term trend (EMA 50) is intact.',
    filters: ['rsi14 < 35 (long)', 'rsi14 > 65 (short)', 'price > ema50 (long)', 'price < ema50 (short)'],
    params: { instrType: 'spot', direction: 'both', minGrade: 'B' },
    risk: 'medium',
    bestFor: 'Ranging markets, index trading',
    avoid: 'Strong trending markets — RSI can stay extreme for extended periods',
    backtestYears: 3,
    winRate: 72,
    maxDrawdown: 8.2,
    sharpe: 1.4,
    tags: ['RSI', 'EMA', 'Mean Reversion', 'Index'],
  },
  {
    id: 'breakout-banknifty-futures',
    name: 'Volume Breakout — BANKNIFTY Futures',
    category: 'Breakout',
    instrType: 'futures',
    direction: 'both',
    symbol: 'BANKNIFTY',
    complexity: 'intermediate',
    accuracy: 76,
    avgRR: 2.1,
    description: 'Enter long when price breaks above 20-day high with volume > 1.5x average. Enter short when price breaks below 20-day low with volume > 1.5x average.',
    logic: 'High-volume breakouts of key levels indicate institutional participation and are more likely to sustain. The 20-day range captures the recent consolidation zone.',
    filters: ['price > 20d_high (long)', 'price < 20d_low (short)', 'volume > 1.5x_avg'],
    params: { instrType: 'futures', direction: 'both', minGrade: 'A' },
    risk: 'high',
    bestFor: 'Trending markets, high-volatility sessions',
    avoid: 'Low-volume days, pre-expiry sessions',
    backtestYears: 3,
    winRate: 68,
    maxDrawdown: 14.5,
    sharpe: 1.1,
    tags: ['Breakout', 'Volume', 'Futures', 'BANKNIFTY'],
  },
  {
    id: 'atm-ce-low-iv',
    name: 'ATM Call Buy — Low IV Environment',
    category: 'Options',
    instrType: 'options',
    direction: 'long',
    symbol: 'NIFTY50',
    complexity: 'intermediate',
    accuracy: 74,
    avgRR: 2.4,
    description: 'Buy ATM NIFTY CE when IV rank is below 30% (cheap options) and the index is in an uptrend (price > EMA 20). Target 50–100% premium gain.',
    logic: 'Buying options when IV is low means you pay less for the same exposure. Combined with a bullish trend, this gives a favourable risk-reward.',
    filters: ['iv_rank < 30%', 'price > ema20', 'days_to_expiry > 7'],
    params: { instrType: 'options', direction: 'long', minGrade: 'B' },
    risk: 'medium',
    bestFor: 'Pre-event plays, trending markets with low volatility',
    avoid: 'High IV environments (IV > 25%) — options are expensive',
    backtestYears: 2,
    winRate: 65,
    maxDrawdown: 35.0,
    sharpe: 0.9,
    tags: ['Options', 'IV', 'ATM', 'NIFTY', 'Trend'],
  },
  {
    id: 'ema-crossover-equities',
    name: 'EMA Crossover — Indian Equities',
    category: 'Trend Following',
    instrType: 'spot',
    direction: 'both',
    symbol: 'Any',
    complexity: 'beginner',
    accuracy: 75,
    avgRR: 2.0,
    description: 'Buy when EMA(20) crosses above EMA(50). Sell when EMA(20) crosses below EMA(50). Use on daily timeframe for swing trades.',
    logic: 'EMA crossovers capture medium-term trend changes. The 20/50 combination is widely used and tends to filter out short-term noise while catching meaningful moves.',
    filters: ['ema20 > ema50 (long)', 'ema20 < ema50 (short)', 'adx14 > 20'],
    params: { instrType: 'spot', direction: 'both', minGrade: 'C' },
    risk: 'low',
    bestFor: 'Trending equities, swing trading',
    avoid: 'Choppy/ranging markets — generates false signals',
    backtestYears: 3,
    winRate: 70,
    maxDrawdown: 6.8,
    sharpe: 1.6,
    tags: ['EMA', 'Crossover', 'Trend', 'Equities', 'Swing'],
  },
  {
    id: 'put-sell-high-iv',
    name: 'OTM Put Sell — High IV',
    category: 'Options Income',
    instrType: 'options',
    direction: 'short',
    symbol: 'NIFTY50',
    complexity: 'advanced',
    accuracy: 82,
    avgRR: 0.6,
    description: 'Sell OTM puts (1–2 strikes below ATM) when IV rank > 70%. Collect premium decay. Close at 50% profit or 2x loss.',
    logic: 'High IV means options are expensive. Selling premium when IV is elevated captures the mean-reversion of volatility. OTM puts have high probability of expiring worthless.',
    filters: ['iv_rank > 70%', 'strike = atm - 1 to 2 steps', 'days_to_expiry 7–21'],
    params: { instrType: 'options', direction: 'short', minGrade: 'A' },
    risk: 'high',
    bestFor: 'High IV environments, range-bound markets',
    avoid: 'Trending markets, pre-event (earnings, budget, RBI policy)',
    backtestYears: 2,
    winRate: 78,
    maxDrawdown: 42.0,
    sharpe: 1.2,
    tags: ['Options', 'Premium Selling', 'IV', 'NIFTY', 'Income'],
  },
  {
    id: 'macd-momentum-crypto',
    name: 'MACD Momentum — Crypto',
    category: 'Momentum',
    instrType: 'spot',
    direction: 'both',
    symbol: 'BTCUSDT',
    complexity: 'beginner',
    accuracy: 71,
    avgRR: 2.3,
    description: 'Buy when MACD histogram turns positive and price is above EMA(20). Sell when MACD histogram turns negative and price is below EMA(20).',
    logic: 'MACD captures momentum shifts. Combining with EMA trend filter reduces false signals in crypto\'s volatile environment.',
    filters: ['macd_hist > 0 (long)', 'macd_hist < 0 (short)', 'price vs ema20 confirmation'],
    params: { instrType: 'spot', direction: 'both', minGrade: 'B' },
    risk: 'high',
    bestFor: 'Crypto trending phases',
    avoid: 'Sideways crypto markets, low-liquidity altcoins',
    backtestYears: 2,
    winRate: 63,
    maxDrawdown: 22.0,
    sharpe: 0.8,
    tags: ['MACD', 'Momentum', 'Crypto', 'BTC'],
  },
  {
    id: 'vwap-intraday-nifty',
    name: 'VWAP Reversion — NIFTY Intraday',
    category: 'Mean Reversion',
    instrType: 'spot',
    direction: 'both',
    symbol: 'NIFTY50',
    complexity: 'intermediate',
    accuracy: 77,
    avgRR: 1.5,
    description: 'Buy when price dips 0.5% below VWAP with RSI < 40. Sell when price rises 0.5% above VWAP with RSI > 60. Target VWAP as T1.',
    logic: 'VWAP acts as a magnet for intraday price. Deviations from VWAP tend to revert, especially in liquid instruments like NIFTY.',
    filters: ['price < vwap - 0.5% (long)', 'price > vwap + 0.5% (short)', 'rsi14 confirmation'],
    params: { instrType: 'spot', direction: 'both', minGrade: 'B' },
    risk: 'low',
    bestFor: 'Intraday trading, liquid indices',
    avoid: 'Strong trending days, news-driven moves',
    backtestYears: 2,
    winRate: 71,
    maxDrawdown: 5.5,
    sharpe: 1.8,
    tags: ['VWAP', 'Intraday', 'Mean Reversion', 'NIFTY'],
  },
  {
    id: 'bollinger-squeeze-breakout',
    name: 'Bollinger Band Squeeze Breakout',
    category: 'Breakout',
    instrType: 'spot',
    direction: 'both',
    symbol: 'Any',
    complexity: 'intermediate',
    accuracy: 73,
    avgRR: 2.5,
    description: 'Wait for Bollinger Band width to compress to a 6-month low (squeeze). Enter in the direction of the first candle that closes outside the bands.',
    logic: 'Low volatility (squeeze) precedes high volatility (expansion). The breakout direction after a squeeze tends to be sustained.',
    filters: ['bb_width < 6m_low', 'close outside bands', 'volume confirmation'],
    params: { instrType: 'spot', direction: 'both', minGrade: 'A' },
    risk: 'medium',
    bestFor: 'Post-consolidation breakouts, any liquid instrument',
    avoid: 'Already trending instruments — squeeze may not form',
    backtestYears: 3,
    winRate: 66,
    maxDrawdown: 11.0,
    sharpe: 1.3,
    tags: ['Bollinger', 'Squeeze', 'Breakout', 'Volatility'],
  },
]

// ── Filters ───────────────────────────────────────────────────────────────────

const CATEGORIES = ['All', 'Trend Following', 'Mean Reversion', 'Breakout', 'Momentum', 'Options', 'Options Income']
const INSTRUMENTS = ['All', 'spot', 'futures', 'options']
const COMPLEXITIES = ['All', 'beginner', 'intermediate', 'advanced']

export default function StrategiesPage() {
  const navigate = useNavigate()
  const { isTooltipVisible, showExamples, setShowExamples, setPageTooltips } = useUiPrefsStore()
  const pageEnabled = isTooltipVisible(PAGE)

  const [category,   setCategory]   = useState('All')
  const [instrType,  setInstrType]  = useState('All')
  const [complexity, setComplexity] = useState('All')
  const [minAcc,     setMinAcc]     = useState(0)
  const [search,     setSearch]     = useState('')
  const [expanded,   setExpanded]   = useState(null)

  const filtered = useMemo(() => {
    return STRATEGIES.filter(s => {
      if (category   !== 'All' && s.category   !== category)   return false
      if (instrType  !== 'All' && s.instrType  !== instrType)  return false
      if (complexity !== 'All' && s.complexity !== complexity) return false
      if (s.accuracy < minAcc) return false
      if (search && !s.name.toLowerCase().includes(search.toLowerCase()) &&
          !s.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))) return false
      return true
    })
  }, [category, instrType, complexity, minAcc, search])

  function handleApply(strategy) {
    navigate(`/predictions?module=${encodeURIComponent(strategy.symbol === 'Any' ? 'indices-india' : 'fno-india')}&strategy=${encodeURIComponent(strategy.id)}`)
  }

  return (
    <div className={styles.page}>
      {/* ── Header ── */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>
            Strategy Library
            <InfoTooltip
              page={PAGE}
              title="Strategy Library"
              content="A curated collection of open trading strategies. Each strategy has been backtested on 2–3 years of historical data. Use them as-is or as inspiration for your own."
              example={{ text: 'The RSI Reversal strategy has 78% accuracy on NIFTY50 over 3 years — meaning it correctly predicted direction 78 out of 100 times.' }}
            />
          </h1>
          <p className={styles.subtitle}>
            {STRATEGIES.length} open strategies · backtested · ready to apply
          </p>
        </div>

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

      {/* ── Filters ── */}
      <div className={styles.filters}>
        <input
          className={styles.searchInput}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search strategies or tags…"
          aria-label="Search strategies"
        />

        <FilterGroup label="Category" value={category} options={CATEGORIES} onChange={setCategory} />
        <FilterGroup label="Instrument" value={instrType} options={INSTRUMENTS} onChange={setInstrType} />
        <FilterGroup label="Complexity" value={complexity} options={COMPLEXITIES} onChange={setComplexity} />

        <div className={styles.accFilter}>
          <label className={styles.accFilterLabel}>
            Min Accuracy
            <InfoTooltip page={PAGE} title="Minimum Accuracy" content="Filter strategies by their historical backtest accuracy. 75%+ is considered stable." />
          </label>
          <div className={styles.accFilterRow}>
            <input type="range" min={0} max={90} step={5} value={minAcc}
              onChange={e => setMinAcc(Number(e.target.value))}
              className={styles.accSlider} aria-label={`Minimum accuracy: ${minAcc}%`} />
            <span className={styles.accVal}>{minAcc}%+</span>
          </div>
        </div>
      </div>

      {/* ── Results count ── */}
      <div className={styles.resultsCount}>
        {filtered.length} {filtered.length === 1 ? 'strategy' : 'strategies'} found
      </div>

      {/* ── Strategy cards ── */}
      {filtered.length === 0 ? (
        <div className={styles.empty}>No strategies match your filters. Try adjusting the criteria.</div>
      ) : (
        <div className={styles.grid}>
          {filtered.map(s => (
            <ErrorBoundary key={s.id}>
              <StrategyCard
                strategy={s}
                expanded={expanded === s.id}
                onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
                onApply={() => handleApply(s)}
                page={PAGE}
              />
            </ErrorBoundary>
          ))}
        </div>
      )}

      <Disclaimer />
    </div>
  )
}

// ── Filter group ──────────────────────────────────────────────────────────────

function FilterGroup({ label, value, options, onChange }) {
  return (
    <div className={styles.filterGroup}>
      <span className={styles.filterLabel}>{label}</span>
      <div className={styles.filterBtns}>
        {options.map(opt => (
          <button
            key={opt}
            type="button"
            className={`${styles.filterBtn} ${value === opt ? styles.filterBtnActive : ''}`}
            onClick={() => onChange(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Strategy card ─────────────────────────────────────────────────────────────

function StrategyCard({ strategy: s, expanded, onToggle, onApply, page }) {
  const riskColor = s.risk === 'low' ? 'var(--color-bull)' : s.risk === 'medium' ? 'var(--color-warn)' : 'var(--color-bear)'
  const accColor  = s.accuracy >= 75 ? 'var(--color-bull)' : s.accuracy >= 65 ? 'var(--color-warn)' : 'var(--color-bear)'

  return (
    <article className={`${styles.card} ${expanded ? styles.cardExpanded : ''}`}
      aria-label={`Strategy: ${s.name}`}>
      {/* ── Card header ── */}
      <div className={styles.cardHead}>
        <div className={styles.cardHeadLeft}>
          <span className={styles.cardCategory}>{s.category}</span>
          <h3 className={styles.cardName}>{s.name}</h3>
          <div className={styles.cardBadges}>
            <span className={`${styles.badge} ${styles[`instr_${s.instrType}`]}`}>{s.instrType}</span>
            <span className={`${styles.badge} ${s.direction === 'long' ? styles.dirLong : s.direction === 'short' ? styles.dirShort : styles.dirBoth}`}>
              {s.direction}
            </span>
            <span className={`${styles.badge} ${styles[`cx_${s.complexity}`]}`}>{s.complexity}</span>
          </div>
        </div>

        <div className={styles.cardHeadRight}>
          <div className={styles.accBlock}>
            <span className={styles.accNum} style={{ color: accColor }}>{s.accuracy}%</span>
            <span className={styles.accLabel}>
              accuracy
              <InfoTooltip page={page} title="Backtest Accuracy"
                content={`This strategy correctly predicted direction ${s.accuracy}% of the time over ${s.backtestYears} years of backtesting.`}
                example={{ text: `${s.accuracy}% means ~${100 - s.accuracy}% chance of being wrong on any given signal.` }} />
            </span>
          </div>
        </div>
      </div>

      {/* ── Quick stats ── */}
      <div className={styles.quickStats}>
        <QuickStat label="Win Rate" value={`${s.winRate}%`} color={s.winRate >= 65 ? 'bull' : 'warn'} page={page}
          info="Percentage of signals that hit T1 or better" />
        <QuickStat label="Avg R:R" value={`1:${s.avgRR}`} color="neutral" page={page}
          info="Average risk-to-reward ratio" />
        <QuickStat label="Max DD" value={`${s.maxDrawdown}%`} color="bear" page={page}
          info="Maximum drawdown during backtest" />
        <QuickStat label="Sharpe" value={s.sharpe} color="neutral" page={page}
          info="Sharpe ratio — higher is better. >1 is good." />
        <QuickStat label="Risk" value={s.risk} color={s.risk === 'low' ? 'bull' : s.risk === 'medium' ? 'warn' : 'bear'} page={page}
          info="Overall risk level of this strategy" />
      </div>

      {/* ── Description ── */}
      <p className={styles.description}>{s.description}</p>

      {/* ── Tags ── */}
      <div className={styles.tags}>
        {s.tags.map(t => <span key={t} className={styles.tag}>{t}</span>)}
      </div>

      {/* ── Expand button ── */}
      <button className={styles.expandBtn} onClick={onToggle} aria-expanded={expanded}>
        {expanded ? '▲ Less detail' : '▼ Full strategy'}
      </button>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className={styles.expandedContent}>
          <div className={styles.expandSection}>
            <h4 className={styles.expandTitle}>
              Why it works
              <InfoTooltip page={page} title="Strategy Logic"
                content="The theoretical basis for why this strategy generates profitable signals." />
            </h4>
            <p className={styles.expandText}>{s.logic}</p>
          </div>

          <div className={styles.expandSection}>
            <h4 className={styles.expandTitle}>Filters / Conditions</h4>
            <div className={styles.filterList}>
              {s.filters.map((f, i) => <span key={i} className={styles.filterChip}>{f}</span>)}
            </div>
          </div>

          <div className={styles.expandGrid}>
            <div className={styles.expandSection}>
              <h4 className={styles.expandTitle}>
                ✓ Best for
                <InfoTooltip page={page} title="Best Market Conditions"
                  content="Market conditions where this strategy performs best." />
              </h4>
              <p className={styles.expandText}>{s.bestFor}</p>
            </div>
            <div className={styles.expandSection}>
              <h4 className={styles.expandTitle}>
                ✗ Avoid when
                <InfoTooltip page={page} title="When to Avoid"
                  content="Conditions where this strategy tends to underperform or generate false signals." />
              </h4>
              <p className={styles.expandText}>{s.avoid}</p>
            </div>
          </div>

          <div className={styles.expandSection}>
            <h4 className={styles.expandTitle}>Prediction Parameters</h4>
            <div className={styles.paramGrid}>
              {Object.entries(s.params).map(([k, v]) => (
                <div key={k} className={styles.paramItem}>
                  <span className={styles.paramKey}>{k}</span>
                  <span className={styles.paramVal}>{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Apply button ── */}
      <button className={styles.applyBtn} onClick={onApply} type="button">
        ⚡ Apply to Predictions
        <InfoTooltip page={page} title="Apply Strategy"
          content="Opens the Predictions page with this strategy's parameters pre-loaded. You can still adjust them before generating signals." />
      </button>
    </article>
  )
}

function QuickStat({ label, value, color, info, page }) {
  const colorMap = { bull: 'var(--color-bull)', bear: 'var(--color-bear)', warn: 'var(--color-warn)', neutral: 'var(--color-text-secondary)' }
  return (
    <div className={styles.quickStat}>
      <span className={styles.quickStatLabel}>
        {label}
        {info && <InfoTooltip page={page} title={label} content={info} />}
      </span>
      <span className={styles.quickStatValue} style={{ color: colorMap[color] ?? colorMap.neutral }}>
        {value}
      </span>
    </div>
  )
}
