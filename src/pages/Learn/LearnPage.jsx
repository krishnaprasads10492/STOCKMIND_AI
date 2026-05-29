/**
 * LearnPage — Interactive Learning Center
 *
 * Walkthrough of all pages, features, and financial terms.
 * Designed for users who are new to trading or to this app.
 *
 * Sections:
 *   1. App Tour — what each page does
 *   2. Trading Glossary — terms with definitions + mini charts
 *   3. Signal Guide — how to read prediction cards
 *   4. Risk Management — position sizing, stop-loss, R:R
 *   5. Market Sessions — pre/regular/post market explained
 *   6. Indicators — RSI, MACD, ATR, Bollinger, etc.
 *   7. Options Basics — CE/PE, Greeks, IV
 *   8. FAQ — common questions
 */

import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Disclaimer } from '@components/Disclaimer.jsx'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart } from 'recharts'
import styles from './LearnPage.module.css'

// ── Section definitions ───────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'tour',       icon: '🗺',  label: 'App Tour' },
  { id: 'signals',    icon: '🎯',  label: 'Reading Signals' },
  { id: 'glossary',   icon: '📖',  label: 'Glossary' },
  { id: 'risk',       icon: '🛡',  label: 'Risk Management' },
  { id: 'indicators', icon: '📊',  label: 'Indicators' },
  { id: 'options',    icon: '⚙',   label: 'Options Basics' },
  { id: 'sessions',   icon: '🕐',  label: 'Market Sessions' },
  { id: 'faq',        icon: '❓',  label: 'FAQ' },
]

export default function LearnPage() {
  const [activeSection, setActiveSection] = useState('tour')
  const contentRef = useRef(null)

  function goTo(id) {
    setActiveSection(id)
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>📚 Learning Center</h1>
          <p className={styles.subtitle}>
            Everything you need to understand StockMind AI — from reading signals to options Greeks.
          </p>
        </div>
      </div>

      <div className={styles.layout}>
        {/* Sidebar nav */}
        <nav className={styles.sidebar} aria-label="Learning sections">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              className={`${styles.sideItem} ${activeSection === s.id ? styles.sideItemActive : ''}`}
              onClick={() => goTo(s.id)}
            >
              <span className={styles.sideIcon}>{s.icon}</span>
              <span className={styles.sideLabel}>{s.label}</span>
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className={styles.content} ref={contentRef}>
          {activeSection === 'tour'       && <AppTourSection onNavigate={goTo} />}
          {activeSection === 'signals'    && <SignalsSection />}
          {activeSection === 'glossary'   && <GlossarySection />}
          {activeSection === 'risk'       && <RiskSection />}
          {activeSection === 'indicators' && <IndicatorsSection />}
          {activeSection === 'options'    && <OptionsSection />}
          {activeSection === 'sessions'   && <SessionsSection />}
          {activeSection === 'faq'        && <FAQSection />}
        </div>
      </div>

      <Disclaimer compact />
    </div>
  )
}

// ── Shared components ─────────────────────────────────────────────────────────

function SectionTitle({ icon, title, subtitle }) {
  return (
    <div className={styles.sectionTitle}>
      <h2>{icon} {title}</h2>
      {subtitle && <p className={styles.sectionSubtitle}>{subtitle}</p>}
    </div>
  )
}

function Card({ title, children, accent }) {
  return (
    <div className={styles.card} style={accent ? { borderLeftColor: accent } : {}}>
      {title && <h3 className={styles.cardTitle}>{title}</h3>}
      {children}
    </div>
  )
}

function TermBadge({ label, color = 'accent' }) {
  const colors = {
    accent: 'var(--color-accent)',
    bull:   'var(--color-bull)',
    bear:   'var(--color-bear)',
    warn:   'var(--color-warn)',
    ai:     'var(--color-ai)',
  }
  return (
    <span className={styles.termBadge} style={{ color: colors[color], borderColor: colors[color] }}>
      {label}
    </span>
  )
}

// ── Mini chart helpers ────────────────────────────────────────────────────────

function MiniLineChart({ data, color = 'var(--color-accent)', height = 80 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} />
        <YAxis hide domain={['auto', 'auto']} />
        <XAxis hide />
      </LineChart>
    </ResponsiveContainer>
  )
}

function MiniAreaChart({ data, color = 'var(--color-accent)', height = 80 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <defs>
          <linearGradient id={`grad-${color.replace(/[^a-z]/gi,'')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0.0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false}
          fill={`url(#grad-${color.replace(/[^a-z]/gi,'')})`} />
        <YAxis hide domain={['auto', 'auto']} />
        <XAxis hide />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// Generate sample data
function genTrend(n, start, slope, noise = 2) {
  return Array.from({ length: n }, (_, i) => ({
    i, v: start + slope * i + (Math.random() - 0.5) * noise
  }))
}
function genRSI(n) {
  return Array.from({ length: n }, (_, i) => ({
    i, v: 30 + Math.sin(i / 5) * 30 + Math.random() * 10
  }))
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: APP TOUR
// ═══════════════════════════════════════════════════════════════════════════════

const APP_PAGES = [
  { icon: '⊞', name: 'Dashboard',       path: '/dashboard',             desc: 'Live market overview — indices ticker, portfolio summary, recent signals, system health.' },
  { icon: '🎯', name: 'Predictions',     path: '/predictions',           desc: 'Generate AI trading signals. Select symbol, capital, risk %, and get ranked signals with entry/SL/targets.' },
  { icon: '🧬', name: 'AMI',             path: '/ami',                   desc: 'Advanced Market Intelligence — multi-timeframe analysis, derivatives matrix, document upload, danger signals.' },
  { icon: '🚀', name: 'Multibagger',     path: '/multibagger',           desc: 'Scan for high-growth potential stocks using fundamental + technical scoring.' },
  { icon: '🧠', name: 'AI Intelligence', path: '/strategy-intelligence', desc: 'Run 10 elite algorithms on any symbol — composite score, regime detection, breakout probability.' },
  { icon: '🤖', name: 'JARVIS',          path: '/jarvis',                desc: 'AI assistant — chat, theme studio, system health, dependency scanner, algorithm upgrades.' },
  { icon: '📈', name: 'Backtest',        path: '/backtest',              desc: 'Test strategies on historical data. Select date range (1M to 5Y), see accuracy, equity curve, monthly P&L.' },
  { icon: '🧩', name: 'Strategies',      path: '/strategies',            desc: 'Build and save trading strategies in plain English. AI converts them to prediction filters.' },
  { icon: '★',  name: 'Favourites',      path: '/favourites',            desc: 'Bookmark symbols for quick access. See their latest signals and performance.' },
  { icon: '📊', name: 'History',         path: '/history',               desc: 'All past predictions with outcomes — T1/T2/T3 hit rates, P&L, accuracy by symbol.' },
  { icon: '⚙',  name: 'Settings',        path: '/settings',              desc: 'Theme, capital defaults, risk %, AI background worker, tooltip preferences.' },
  { icon: '📚', name: 'Learn',           path: '/learn',                 desc: 'You are here! Walkthrough of all features, glossary, and trading education.' },
]

function AppTourSection({ onNavigate }) {
  const navigate = useNavigate()
  return (
    <div className={styles.section}>
      <SectionTitle icon="🗺" title="App Tour"
        subtitle="A quick guide to every page in StockMind AI" />

      <div className={styles.tourGrid}>
        {APP_PAGES.map(p => (
          <div key={p.path} className={styles.tourCard}
            onClick={() => navigate(p.path)} role="button" tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && navigate(p.path)}>
            <div className={styles.tourCardHead}>
              <span className={styles.tourIcon}>{p.icon}</span>
              <span className={styles.tourName}>{p.name}</span>
            </div>
            <p className={styles.tourDesc}>{p.desc}</p>
            <span className={styles.tourLink}>Open →</span>
          </div>
        ))}
      </div>

      <Card title="💡 Recommended flow for new users" accent="var(--color-accent)">
        <ol className={styles.flowList}>
          <li><strong>Settings</strong> — Set your default capital and risk % first</li>
          <li><strong>Predictions</strong> — Generate your first signals on NIFTY50</li>
          <li><strong>Learn → Reading Signals</strong> — Understand what each field means</li>
          <li><strong>Backtest</strong> — Test a strategy on 1Y of historical data</li>
          <li><strong>AMI</strong> — Get multi-timeframe confirmation before trading</li>
          <li><strong>History</strong> — Track your prediction accuracy over time</li>
        </ol>
      </Card>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: READING SIGNALS
// ═══════════════════════════════════════════════════════════════════════════════

function SignalsSection() {
  const sampleSignal = {
    rank: 1, type: 'LONG', grade: 'A+', probability: 82,
    entryPrice: 22450, entryZoneLow: 22420, entryZoneHigh: 22480,
    stopLoss: 22280, immediateOptimalSL: 22340,
    t1Price: 22620, t2Price: 22780, t3Price: 22950,
    t1Probability: 82, t2Probability: 64, t3Probability: 44,
    riskRewardRatio: 2.1, maxRisk: 3500, lotCount: 1, lotSize: 25,
    iv: 14.2, delta: 0.52, theta: -18.4, vega: 0.34,
  }

  return (
    <div className={styles.section}>
      <SectionTitle icon="🎯" title="Reading Prediction Signals"
        subtitle="Every field on a signal card explained" />

      {/* Signal anatomy */}
      <Card title="Signal Card Anatomy">
        <div className={styles.signalDemo}>
          <div className={styles.signalDemoHead}>
            <div className={styles.signalDemoLeft}>
              <span className={styles.signalRank}>#1</span>
              <span className={styles.signalDir} style={{ color: 'var(--color-bull)' }}>▲ LONG</span>
              <span className={styles.signalInstr}>SPOT</span>
            </div>
            <div className={styles.signalDemoRight}>
              <span className={styles.signalGrade} style={{ color: 'var(--color-bull)' }}>A+</span>
              <span className={styles.signalProb}>82%</span>
            </div>
          </div>
          <div className={styles.signalDemoBar}>
            <div style={{ width: '82%', height: '100%', background: 'var(--color-bull)', borderRadius: 2 }} />
          </div>
          <p className={styles.signalComplement}>~18% chance of being wrong</p>
        </div>
      </Card>

      <div className={styles.termGrid}>
        <TermCard term="Rank" badge={<TermBadge label="#1" />}
          def="Signals are sorted by probability — #1 is the highest confidence signal."
          tip="Always check rank #1 first, but don't ignore lower-ranked signals with good R:R." />

        <TermCard term="Direction" badge={<><TermBadge label="▲ LONG" color="bull" /><TermBadge label="▼ SHORT" color="bear" /></>}
          def="LONG = buy/bullish (expect price to rise). SHORT = sell/bearish (expect price to fall)."
          tip="In options: LONG usually means buying CE (Call), SHORT means buying PE (Put)." />

        <TermCard term="Grade" badge={<><TermBadge label="A+" color="bull" /><TermBadge label="A" color="bull" /><TermBadge label="B" color="warn" /><TermBadge label="C" color="warn" /><TermBadge label="D" color="bear" /></>}
          def="A+ = 80%+ probability. A = 70-80%. B = 60-70%. C = 50-60%. D = below 50%."
          tip="Only trade A and A+ signals unless you have a specific reason for lower grades." />

        <TermCard term="Probability %" badge={<TermBadge label="82%" color="bull" />}
          def="The AI's estimated probability that this signal will reach at least Target 1. Always shown with its complement: '~18% chance of being wrong'."
          tip="82% means 82 out of 100 similar historical setups reached T1. Not a guarantee." />

        <TermCard term="Entry Zone" badge={<TermBadge label="22420 – 22480" />}
          def="The price range where you should enter the trade. The entry price is the midpoint."
          tip="Wait for price to come into this zone before entering. Don't chase if price has moved far." />

        <TermCard term="Stop Loss (SL)" badge={<TermBadge label="22280" color="bear" />}
          def="The price at which you exit to limit your loss. If price reaches SL, the trade is wrong."
          tip="Never move your SL further away from entry. You can tighten it (move toward entry) as price moves in your favor." />

        <TermCard term="Optimal SL" badge={<TermBadge label="22340" color="warn" />}
          def="A tighter stop-loss set at 35% of the distance between entry and SL. Use this once the trade moves in your favor."
          tip="Move to Optimal SL after price moves 50% toward T1. This locks in partial profit protection." />

        <TermCard term="Targets T1/T2/T3" badge={<><TermBadge label="T1: 22620" color="bull" /><TermBadge label="T2: 22780" color="bull" /></>}
          def="T1 = first target (highest probability). T2 = second target. T3 = extended target (lowest probability)."
          tip="Book partial profits at T1 (50%), move SL to entry, let rest run to T2/T3." />

        <TermCard term="Risk:Reward (R:R)" badge={<TermBadge label="1:2.1" color="accent" />}
          def="For every ₹1 you risk (entry to SL), you can potentially gain ₹2.1 (entry to T1)."
          tip="Only take trades with R:R ≥ 1.5. Ideally 1:2 or better. This ensures profitability even with 50% win rate." />

        <TermCard term="Max Risk" badge={<TermBadge label="₹3,500" color="bear" />}
          def="The maximum amount you can lose on this trade based on your capital and risk % settings."
          tip="This is calculated as: Capital × Risk% / 100. Never risk more than 2% of capital on a single trade." />
      </div>
    </div>
  )
}

function TermCard({ term, badge, def, tip }) {
  const [showTip, setShowTip] = useState(false)
  return (
    <div className={styles.termCard}>
      <div className={styles.termCardHead}>
        <span className={styles.termName}>{term}</span>
        <div className={styles.termBadges}>{badge}</div>
      </div>
      <p className={styles.termDef}>{def}</p>
      <button className={styles.tipToggle} onClick={() => setShowTip(s => !s)}>
        {showTip ? '▲ Hide tip' : '💡 Pro tip'}
      </button>
      {showTip && <div className={styles.tipBox}>{tip}</div>}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: GLOSSARY
// ═══════════════════════════════════════════════════════════════════════════════

const GLOSSARY_TERMS = [
  { term: 'ATR', full: 'Average True Range', category: 'indicator',
    def: 'Measures market volatility — the average range between high and low over N periods. Higher ATR = more volatile market.',
    chart: genTrend(30, 100, 0.5, 5) },
  { term: 'RSI', full: 'Relative Strength Index', category: 'indicator',
    def: 'Oscillator (0-100) measuring momentum. Below 30 = oversold (potential buy). Above 70 = overbought (potential sell).',
    chart: genRSI(40) },
  { term: 'EMA', full: 'Exponential Moving Average', category: 'indicator',
    def: 'A moving average that gives more weight to recent prices. EMA(20) = 20-day EMA. Price above EMA = bullish.',
    chart: genTrend(40, 100, 0.3, 3) },
  { term: 'MACD', full: 'Moving Average Convergence Divergence', category: 'indicator',
    def: 'Shows relationship between two EMAs. When MACD crosses above signal line = bullish. Below = bearish.',
    chart: genTrend(40, 0, 0.1, 1) },
  { term: 'Bollinger Bands', full: 'Bollinger Bands', category: 'indicator',
    def: 'Three lines: middle (SMA20), upper (+2 std dev), lower (-2 std dev). Price near lower band = oversold.',
    chart: genTrend(40, 100, 0.2, 4) },
  { term: 'IV', full: 'Implied Volatility', category: 'options',
    def: 'Market\'s expectation of future price movement. High IV = expensive options. Low IV = cheap options.',
    chart: genTrend(30, 15, 0.3, 2) },
  { term: 'Delta', full: 'Delta (Options Greek)', category: 'options',
    def: 'How much the option price changes for ₹1 move in the underlying. ATM call ≈ 0.5. Deep ITM ≈ 1.0.',
    chart: genTrend(30, 0.3, 0.02, 0.05) },
  { term: 'Theta', full: 'Theta (Time Decay)', category: 'options',
    def: 'How much option value is lost per day due to time passing. Always negative for option buyers.',
    chart: genTrend(30, -5, -0.3, 0.5) },
  { term: 'Vega', full: 'Vega (Volatility Sensitivity)', category: 'options',
    def: 'How much option price changes for 1% change in IV. Long options benefit from rising IV.',
    chart: genTrend(30, 0.2, 0.01, 0.03) },
  { term: 'OI', full: 'Open Interest', category: 'market',
    def: 'Total number of outstanding contracts. Rising OI with rising price = strong bullish trend.',
    chart: genTrend(30, 50000, 1000, 5000) },
  { term: 'PCR', full: 'Put-Call Ratio', category: 'market',
    def: 'Ratio of put OI to call OI. PCR > 1 = more puts = bearish sentiment. PCR < 0.7 = bullish.',
    chart: genTrend(30, 1.0, 0.01, 0.1) },
  { term: 'VIX', full: 'Volatility Index', category: 'market',
    def: 'India VIX measures expected market volatility. VIX > 20 = high fear. VIX < 15 = complacency.',
    chart: genTrend(30, 14, 0.2, 2) },
  { term: 'Sharpe Ratio', full: 'Sharpe Ratio', category: 'performance',
    def: 'Risk-adjusted return. Sharpe > 1 = good. > 2 = excellent. Measures return per unit of risk.',
    chart: genTrend(30, 0.5, 0.05, 0.2) },
  { term: 'Max Drawdown', full: 'Maximum Drawdown', category: 'performance',
    def: 'Largest peak-to-trough loss in a period. Lower is better. Critical for risk management.',
    chart: genTrend(30, 100, -0.5, 3) },
  { term: 'Hurst Exponent', full: 'Hurst Exponent', category: 'advanced',
    def: 'Measures market memory. > 0.5 = trending (momentum works). < 0.5 = mean-reverting (oscillators work).',
    chart: genTrend(30, 0.5, 0.005, 0.05) },
]

const CATEGORIES = ['all', 'indicator', 'options', 'market', 'performance', 'advanced']

function GlossarySection() {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  const filtered = GLOSSARY_TERMS.filter(t => {
    const matchCat = filter === 'all' || t.category === filter
    const matchSearch = !search || t.term.toLowerCase().includes(search.toLowerCase()) ||
      t.def.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })

  return (
    <div className={styles.section}>
      <SectionTitle icon="📖" title="Trading Glossary"
        subtitle="Key terms with definitions and mini charts" />

      <div className={styles.glossaryControls}>
        <input className={styles.searchInput} placeholder="Search terms…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <div className={styles.filterChips}>
          {CATEGORIES.map(c => (
            <button key={c} className={`${styles.filterChip} ${filter === c ? styles.filterChipActive : ''}`}
              onClick={() => setFilter(c)}>
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.glossaryGrid}>
        {filtered.map(t => (
          <div key={t.term} className={styles.glossaryCard}>
            <div className={styles.glossaryHead}>
              <span className={styles.glossaryTerm}>{t.term}</span>
              <span className={styles.glossaryFull}>{t.full}</span>
              <span className={`${styles.glossaryCat} ${styles[`cat_${t.category}`]}`}>{t.category}</span>
            </div>
            <p className={styles.glossaryDef}>{t.def}</p>
            {t.chart && (
              <div className={styles.glossaryChart}>
                <MiniAreaChart data={t.chart} color="var(--color-accent)" height={60} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: RISK MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

function RiskSection() {
  const [capital, setCapital] = useState(100000)
  const [riskPct, setRiskPct] = useState(1.5)
  const [entry,   setEntry]   = useState(22450)
  const [sl,      setSl]      = useState(22280)

  const maxRisk   = capital * riskPct / 100
  const slDist    = Math.abs(entry - sl)
  const lotSize   = 25
  const lots      = slDist > 0 ? Math.max(1, Math.floor(maxRisk / (slDist * lotSize))) : 0
  const actualRisk = lots * slDist * lotSize
  const t1        = entry + slDist * 1.8
  const rr        = slDist > 0 ? (t1 - entry) / slDist : 0

  return (
    <div className={styles.section}>
      <SectionTitle icon="🛡" title="Risk Management"
        subtitle="The most important skill in trading — protecting your capital" />

      <div className={styles.riskCalc}>
        <h3 className={styles.calcTitle}>Position Size Calculator</h3>
        <div className={styles.calcGrid}>
          <div className={styles.calcField}>
            <label>Capital (₹)</label>
            <input type="number" value={capital} onChange={e => setCapital(Number(e.target.value))} className={styles.calcInput} />
          </div>
          <div className={styles.calcField}>
            <label>Risk per trade (%)</label>
            <input type="range" min={0.5} max={5} step={0.5} value={riskPct}
              onChange={e => setRiskPct(Number(e.target.value))} className={styles.calcSlider} />
            <span className={styles.calcVal}>{riskPct}%</span>
          </div>
          <div className={styles.calcField}>
            <label>Entry Price (₹)</label>
            <input type="number" value={entry} onChange={e => setEntry(Number(e.target.value))} className={styles.calcInput} />
          </div>
          <div className={styles.calcField}>
            <label>Stop Loss (₹)</label>
            <input type="number" value={sl} onChange={e => setSl(Number(e.target.value))} className={styles.calcInput} />
          </div>
        </div>
        <div className={styles.calcResults}>
          <div className={styles.calcResult}>
            <span>Max Risk</span>
            <span style={{ color: 'var(--color-bear)' }}>₹{maxRisk.toLocaleString('en-IN')}</span>
          </div>
          <div className={styles.calcResult}>
            <span>SL Distance</span>
            <span>{slDist.toFixed(0)} pts</span>
          </div>
          <div className={styles.calcResult}>
            <span>Lots (NIFTY)</span>
            <span style={{ color: 'var(--color-accent)' }}>{lots}</span>
          </div>
          <div className={styles.calcResult}>
            <span>Actual Risk</span>
            <span style={{ color: 'var(--color-bear)' }}>₹{actualRisk.toLocaleString('en-IN')}</span>
          </div>
          <div className={styles.calcResult}>
            <span>T1 Target</span>
            <span style={{ color: 'var(--color-bull)' }}>₹{t1.toFixed(0)}</span>
          </div>
          <div className={styles.calcResult}>
            <span>R:R Ratio</span>
            <span style={{ color: rr >= 1.5 ? 'var(--color-bull)' : 'var(--color-warn)' }}>1:{rr.toFixed(1)}</span>
          </div>
        </div>
      </div>

      <div className={styles.ruleGrid}>
        <Card title="🔑 The 2% Rule" accent="var(--color-bear)">
          <p>Never risk more than 2% of your total capital on a single trade. If you have ₹1,00,000, max risk per trade = ₹2,000.</p>
          <p className={styles.ruleNote}>This ensures you can survive 50 consecutive losses before losing all capital.</p>
        </Card>
        <Card title="📐 The 1:2 R:R Rule" accent="var(--color-bull)">
          <p>Only take trades where potential gain is at least 2× the potential loss. R:R of 1:2 means you profit even with a 40% win rate.</p>
          <p className={styles.ruleNote}>Math: 40 wins × ₹2 - 60 losses × ₹1 = +₹20 net profit.</p>
        </Card>
        <Card title="🎯 Position Sizing" accent="var(--color-accent)">
          <p>Lots = Max Risk ÷ (SL Distance × Lot Size). This ensures every trade risks the same ₹ amount regardless of SL distance.</p>
          <p className={styles.ruleNote}>Wider SL = fewer lots. Tighter SL = more lots. Risk stays constant.</p>
        </Card>
        <Card title="🚫 Never Average Down" accent="var(--color-warn)">
          <p>If a trade goes against you, do NOT add more positions. Exit at your SL. Averaging down turns small losses into catastrophic ones.</p>
          <p className={styles.ruleNote}>The market can stay irrational longer than you can stay solvent.</p>
        </Card>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: INDICATORS
// ═══════════════════════════════════════════════════════════════════════════════

function IndicatorsSection() {
  return (
    <div className={styles.section}>
      <SectionTitle icon="📊" title="Technical Indicators"
        subtitle="How the AI uses each indicator to generate signals" />

      <div className={styles.indicatorList}>
        {[
          { name: 'RSI (14)', color: 'var(--color-accent)', data: genRSI(50),
            how: 'RSI < 35 → oversold → potential LONG. RSI > 65 → overbought → potential SHORT.',
            weight: 'High — one of the most reliable momentum indicators.',
            zones: [{ y: 30, label: 'Oversold', color: 'var(--color-bull)' }, { y: 70, label: 'Overbought', color: 'var(--color-bear)' }] },
          { name: 'EMA 20/50 Cross', color: 'var(--color-bull)', data: genTrend(50, 100, 0.4, 3),
            how: 'EMA20 crosses above EMA50 → Golden Cross → LONG signal. Below → Death Cross → SHORT.',
            weight: 'High — trend confirmation indicator.' },
          { name: 'ATR (14)', color: 'var(--color-warn)', data: genTrend(50, 80, 0.3, 8),
            how: 'Used to set stop-loss distance. SL = Entry ± ATR × 1.3. Wider ATR = wider SL.',
            weight: 'Critical — determines position sizing and SL placement.' },
          { name: 'Volume Ratio', color: 'var(--color-ai)', data: genTrend(50, 1.0, 0.02, 0.3),
            how: 'Volume > 1.5× 20-day average confirms breakouts. Low volume = weak signal.',
            weight: 'Medium — confirms price moves.' },
          { name: 'Hurst Exponent', color: 'var(--color-accent)', data: genTrend(50, 0.5, 0.003, 0.05),
            how: 'H > 0.6 → trending market → use momentum strategies. H < 0.4 → mean-reverting → use oscillators.',
            weight: 'High — determines which strategy type to use.' },
          { name: 'Bollinger Band Width', color: 'var(--color-warn)', data: genTrend(50, 0.02, 0.0005, 0.003),
            how: 'Narrow bands (squeeze) → breakout imminent. Wide bands → high volatility, be cautious.',
            weight: 'Medium — breakout timing.' },
        ].map(ind => (
          <div key={ind.name} className={styles.indicatorCard}>
            <div className={styles.indicatorHead}>
              <span className={styles.indicatorName}>{ind.name}</span>
              <span className={styles.indicatorWeight}>{ind.weight}</span>
            </div>
            <div className={styles.indicatorChart}>
              <MiniLineChart data={ind.data} color={ind.color} height={70} />
            </div>
            <p className={styles.indicatorHow}><strong>How AI uses it:</strong> {ind.how}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: OPTIONS BASICS
// ═══════════════════════════════════════════════════════════════════════════════

function OptionsSection() {
  return (
    <div className={styles.section}>
      <SectionTitle icon="⚙" title="Options Basics"
        subtitle="CE, PE, Greeks, and how to read options signals" />

      <div className={styles.optionsGrid}>
        <Card title="📞 Call Option (CE)" accent="var(--color-bull)">
          <p>Right to <strong>buy</strong> the underlying at the strike price. Profits when price goes UP.</p>
          <p className={styles.optNote}>Buy CE when you expect the market to rise. Max loss = premium paid.</p>
        </Card>
        <Card title="📉 Put Option (PE)" accent="var(--color-bear)">
          <p>Right to <strong>sell</strong> the underlying at the strike price. Profits when price goes DOWN.</p>
          <p className={styles.optNote}>Buy PE when you expect the market to fall. Max loss = premium paid.</p>
        </Card>
        <Card title="💰 ATM / ITM / OTM" accent="var(--color-accent)">
          <p><strong>ATM</strong> (At The Money): Strike ≈ current price. Highest time value.</p>
          <p><strong>ITM</strong> (In The Money): CE with strike below price. PE with strike above price.</p>
          <p><strong>OTM</strong> (Out of The Money): CE with strike above price. Cheaper but lower probability.</p>
        </Card>
        <Card title="⏰ Time Decay (Theta)" accent="var(--color-warn)">
          <p>Options lose value every day due to time decay. Theta = daily loss in ₹.</p>
          <p className={styles.optNote}>Theta accelerates in the last 7 days before expiry. Avoid buying options with &lt;7 days left.</p>
        </Card>
      </div>

      <Card title="Greeks Quick Reference">
        <div className={styles.greeksTable}>
          {[
            { greek: 'Δ Delta', range: '0 to 1 (CE), -1 to 0 (PE)', meaning: 'Price sensitivity. Delta 0.5 = option moves ₹0.50 per ₹1 move in underlying.' },
            { greek: 'Γ Gamma', range: '0 to 0.1', meaning: 'Rate of change of Delta. High Gamma = Delta changes quickly. ATM options have highest Gamma.' },
            { greek: 'Θ Theta', range: 'Negative', meaning: 'Daily time decay in ₹. Theta -18 = option loses ₹18 per day. Accelerates near expiry.' },
            { greek: 'ν Vega',  range: 'Positive', meaning: 'IV sensitivity. Vega 0.3 = option gains ₹0.30 for every 1% rise in IV.' },
          ].map(g => (
            <div key={g.greek} className={styles.greekRow}>
              <span className={styles.greekSymbol}>{g.greek}</span>
              <span className={styles.greekRange}>{g.range}</span>
              <span className={styles.greekMeaning}>{g.meaning}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: MARKET SESSIONS
// ═══════════════════════════════════════════════════════════════════════════════

function SessionsSection() {
  return (
    <div className={styles.section}>
      <SectionTitle icon="🕐" title="Market Sessions"
        subtitle="Pre-market, regular, and post-market explained" />

      <div className={styles.sessionTimeline}>
        {[
          { time: '9:00 – 9:15 AM', name: 'Pre-Market', color: 'var(--color-warn)', icon: '🌅',
            desc: 'Price discovery session. Orders are collected but not executed. Pre-market price indicates opening direction.',
            tip: 'Large pre-market gap (>0.5%) is a strong signal for opening direction.' },
          { time: '9:15 AM – 3:30 PM', name: 'Regular Session', color: 'var(--color-bull)', icon: '☀',
            desc: 'Main trading hours. All signals are generated for this session. Highest liquidity and tightest spreads.',
            tip: 'Best time to trade: 9:15-11:00 AM (high momentum) and 2:00-3:30 PM (closing moves).' },
          { time: '3:30 – 3:45 PM', name: 'Post-Market', color: 'var(--color-ai)', icon: '🌆',
            desc: 'Closing price discovery. Post-market price often predicts next day\'s opening.',
            tip: 'Post-market moves > 0.3% often continue into next day\'s opening.' },
          { time: 'After 3:45 PM', name: 'After Hours', color: 'var(--color-text-muted)', icon: '🌙',
            desc: 'No trading. Use this time to analyze signals, plan next day\'s trades, and review outcomes.',
            tip: 'Review your trades: what worked, what didn\'t, and why.' },
        ].map(s => (
          <div key={s.name} className={styles.sessionCard}>
            <div className={styles.sessionLeft}>
              <span className={styles.sessionIcon}>{s.icon}</span>
              <div className={styles.sessionLine} style={{ background: s.color }} />
            </div>
            <div className={styles.sessionRight}>
              <div className={styles.sessionHead}>
                <span className={styles.sessionName} style={{ color: s.color }}>{s.name}</span>
                <span className={styles.sessionTime}>{s.time} IST</span>
              </div>
              <p className={styles.sessionDesc}>{s.desc}</p>
              <div className={styles.sessionTip}>💡 {s.tip}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: FAQ
// ═══════════════════════════════════════════════════════════════════════════════

const FAQS = [
  { q: 'Are these predictions guaranteed?', a: 'No. Predictions are probability estimates based on historical patterns. An 80% probability means 80 out of 100 similar historical setups worked — not that this specific trade will work. Always use stop-losses.' },
  { q: 'What does "mock data" mean?', a: 'When the backend cannot fetch real market data, it uses simulated OHLCV data. Predictions on mock data are for demonstration only. Start the backend server for real predictions.' },
  { q: 'How is the probability calculated?', a: 'An 8-model ensemble (LightGBM, XGBoost, LSTM, Random Forest, MLP, Online SGD, Regime-Aware, FinBERT) votes on each signal. The stacking meta-learner combines their outputs with adaptive weights learned from past outcomes.' },
  { q: 'What is the accuracy gate (75-97%)?', a: 'The backtest accuracy must be between 75% and 97% for a strategy to be considered stable. Below 75% = needs retraining. Above 97% = likely overfitting (memorizing data, not learning patterns).' },
  { q: 'How do I improve prediction accuracy?', a: 'Use the Backtest page to test different strategies. Apply filters (RSI < 35, volume > 1.5×) to improve signal quality. The AI Growth Worker continuously proposes algorithm upgrades.' },
  { q: 'What is the LPM circuit breaker?', a: 'The Loss Prevention Module (LPM) monitors portfolio safety. If the confidence score (Ps) drops below 92%, it automatically scales down signal probabilities toward neutral to protect capital.' },
  { q: 'Can I use this for live trading?', a: 'StockMind AI is a prediction and analysis tool only. It does not execute trades. All signals are for informational purposes. Always do your own research and consult a financial advisor.' },
  { q: 'What is the Hurst Exponent?', a: 'A statistical measure of market memory. H > 0.5 means the market is trending (momentum strategies work). H < 0.5 means mean-reverting (oscillator strategies work). The AI uses this to select the right strategy type.' },
  { q: 'How do I set up MongoDB Atlas?', a: 'Go to cloud.mongodb.com, create a free cluster, get the connection string, and add it as MONGODB_ATLAS_URI in your .env file. Then run: npm run migrate:mongo to move all data to Atlas.' },
  { q: 'What is JARVIS-X?', a: 'JARVIS-X is the Super-AGI core — a multi-layer intelligence system with Loss Prevention Module, Unified Data Hub, Dynamic Infrastructure Orchestrator, and ASI Consciousness Monitor. It enhances every prediction with multi-horizon analysis and anomaly detection.' },
]

function FAQSection() {
  const [open, setOpen] = useState(null)
  return (
    <div className={styles.section}>
      <SectionTitle icon="❓" title="Frequently Asked Questions" />
      <div className={styles.faqList}>
        {FAQS.map((f, i) => (
          <div key={i} className={`${styles.faqItem} ${open === i ? styles.faqOpen : ''}`}>
            <button className={styles.faqQ} onClick={() => setOpen(open === i ? null : i)}>
              <span>{f.q}</span>
              <span className={styles.faqArrow}>{open === i ? '▲' : '▼'}</span>
            </button>
            {open === i && <div className={styles.faqA}>{f.a}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
