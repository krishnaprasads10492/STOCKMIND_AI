/**
 * ChartsPage — JARVIS Trading Terminal
 *
 * Maximum chart area. Watchlist lives in a collapsible slim symbol strip
 * at the top instead of a wide sidebar. Drawing tools and all controls
 * are in the toolbar rows above the chart.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useMarketStore, MARKET_MODULES } from '@store/marketStore.js'
import { useThemeStore } from '@store/themeStore.js'
import { useAuthStore } from '@store/authStore.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import { StockChart } from '@components/StockChart.jsx'
import { Disclaimer } from '@components/Disclaimer.jsx'
import { apiFetch } from '@services/apiClient.js'
import { usePageVisibility } from '@hooks/usePageVisibility.js'
import styles from './ChartsPage.module.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const INTERVALS = [
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1h', label: '1h' },
  { value: '1d', label: '1D' },
  { value: '1wk', label: '1W' },
  { value: '1mo', label: '1M' },
]

const CHART_TYPES = [
  { id: 'candle', label: '🕯 Candle' },
  { id: 'ha',     label: '⬡ HA' },
  { id: 'bar',    label: '▮ Bar' },
  { id: 'line',   label: '╱ Line' },
  { id: 'area',   label: '◭ Area' },
]

const LAYOUTS = [
  { id: 'single', label: '⬜' , title: 'Single' },
  { id: 'split',  label: '⬛⬛', title: 'Split 2' },
  { id: 'triple', label: '⊟⊠', title: 'Triple' },
  { id: 'quad',   label: '⊞',  title: 'Quad 4' },
]

const OVERLAYS = [
  { id: 'ema20',      label: 'EMA20' },
  { id: 'ema50',      label: 'EMA50' },
  { id: 'ema200',     label: 'EMA200' },
  { id: 'bb',         label: 'BB' },
  { id: 'vwap',       label: 'VWAP' },
  { id: 'supertrend', label: 'SuperTrend' },
  { id: 'volume',     label: 'Volume' },
]

const SUB_PANES = [
  { id: 'rsi',   label: 'RSI' },
  { id: 'macd',  label: 'MACD' },
  { id: 'stoch', label: 'Stoch' },
  { id: 'atr',   label: 'ATR' },
]

// JARVIS contextual hints — cycle based on what's active
const JARVIS_HINTS = {
  rsi:        hint => `RSI insight: ${hint?.rsi > 70 ? 'Overbought — consider reducing exposure.' : hint?.rsi < 30 ? 'Oversold — potential reversal zone.' : `RSI at ${hint?.rsi?.toFixed(1) ?? '—'} — neutral momentum.`}`,
  macd:       () => 'MACD active — watch for histogram divergence from price. Crossover above zero line is bullish.',
  supertrend: () => 'Supertrend active — green line = uptrend, red = downtrend. Flip signals trend change.',
  bb:         () => 'Bollinger Bands active — price at upper band = overbought. Squeeze = incoming breakout.',
  vwap:       () => 'VWAP active — institutional fair value. Sustained above = bullish intraday bias.',
  default:    sym => `Analyzing ${sym} — add indicators from the toolbar to get JARVIS insights.`,
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ChartsPage() {
  const location = useLocation()
  const { activeSymbol, activeModuleId, getActiveModule } = useMarketStore()
  const { activeTheme } = useThemeStore()
  const token = useAuthStore(s => s.token)

  // Tell AppShell .main to not add padding/scroll so Charts fills the screen
  useEffect(() => {
    const mainEl = document.getElementById('main-content')
    if (!mainEl) return
    const prev = mainEl.style.cssText
    mainEl.style.padding  = '0'
    mainEl.style.overflow = 'hidden'
    return () => {
      // Restore when leaving Charts page
      mainEl.style.cssText = prev
    }
  }, [])

  // Chart slots — each independently controlled
  const [slots, setSlots] = useState([
    { id: 1, symbol: activeSymbol || 'NIFTY50', exchange: 'NSE', interval: '1d', chartType: 'candle' },
    { id: 2, symbol: 'BANKNIFTY',  exchange: 'NSE',     interval: '1d', chartType: 'candle' },
    { id: 3, symbol: 'SENSEX',     exchange: 'BSE',     interval: '1d', chartType: 'candle' },
    { id: 4, symbol: 'BTCUSDT',    exchange: 'BINANCE', interval: '1d', chartType: 'candle' },
  ])

  const [layout,      setLayout]     = useState('single')
  const [activeSlot,  setActiveSlot] = useState(1)
  const [indicators,  setIndicators] = useState(['ema20', 'volume'])
  const [scaleMode,   setScaleMode]  = useState('normal')
  const [symbolStripOpen, setSymbolStripOpen] = useState(false)
  const [stripSearch, setStripSearch]  = useState('')
  const [liveChanges, setLiveChanges]  = useState({})
  const [jarvisHint,  setJarvisHint]   = useState('')
  const isVisible = usePageVisibility()

  const slotCount = layout === 'single' ? 1 : layout === 'split' ? 2 : layout === 'triple' ? 3 : 4
  const visibleSlots = slots.slice(0, slotCount)
  const currentSlot  = slots.find(s => s.id === activeSlot) ?? slots[0]

  // Sync active symbol from market store when navigating to charts
  useEffect(() => {
    if (activeSymbol && activeSymbol !== slots[0].symbol) {
      setSlots(prev => prev.map((s, i) => i === 0 ? { ...s, symbol: activeSymbol } : s))
    }
  }, [activeSymbol]) // eslint-disable-line react-hooks/exhaustive-deps

  // JARVIS contextual hint
  useEffect(() => {
    const activeInds = indicators
    let hint = JARVIS_HINTS.default(currentSlot.symbol)
    for (const key of Object.keys(JARVIS_HINTS)) {
      if (key !== 'default' && activeInds.includes(key)) {
        hint = JARVIS_HINTS[key]({})
        break
      }
    }
    setJarvisHint(hint)
  }, [indicators, currentSlot.symbol])

  // Fetch live price changes — only when tab is visible
  useEffect(() => {
    if (!token || !isVisible) return
    let mounted = true
    async function fetchChanges() {
      try {
        const res = await apiFetch('/api/market/ohlcv/NIFTY50?exchange=NSE&bars=2')
        if (!mounted) return
        const json = await res.json()
        if (json.data?.length >= 2) {
          const [prev, cur] = json.data.slice(-2)
          const changePct = ((cur.close - prev.close) / prev.close) * 100
          setLiveChanges(lc => ({ ...lc, NIFTY50: { change: cur.close - prev.close, changePct } }))
        }
      } catch {}
    }
    fetchChanges()
    const t = setInterval(fetchChanges, 60_000)
    return () => { mounted = false; clearInterval(t) }
  }, [token, isVisible])

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      const INTERVAL_IDX = INTERVALS.findIndex(i => i.value === currentSlot.interval)
      if (e.key === ']' && INTERVAL_IDX < INTERVALS.length - 1) {
        updateSlot(activeSlot, { interval: INTERVALS[INTERVAL_IDX + 1].value })
      }
      if (e.key === '[' && INTERVAL_IDX > 0) {
        updateSlot(activeSlot, { interval: INTERVALS[INTERVAL_IDX - 1].value })
      }
      if (e.key === 'w' || e.key === 'W') setSymbolStripOpen(o => !o)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [activeSlot, currentSlot.interval]) // eslint-disable-line react-hooks/exhaustive-deps

  function updateSlot(id, updates) {
    setSlots(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
  }

  function toggleIndicator(id) {
    setIndicators(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
  }

  return (
    <div className={styles.page}>

      {/* ── Command toolbar ── */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <span className={styles.toolbarTitle}>CHARTS</span>

          <div className={styles.segmented} role="group" aria-label="Layout">
            {LAYOUTS.map(l => (
              <button key={l.id} title={l.title}
                className={`${styles.segBtn} ${layout === l.id ? styles.segBtnActive : ''}`}
                onClick={() => setLayout(l.id)} aria-pressed={layout === l.id}>
                {l.label}
              </button>
            ))}
          </div>

          <div className={styles.segmented} role="group" aria-label="Chart type">
            {CHART_TYPES.map(ct => (
              <button key={ct.id} title={ct.label}
                className={`${styles.segBtn} ${currentSlot.chartType === ct.id ? styles.segBtnActive : ''}`}
                onClick={() => updateSlot(activeSlot, { chartType: ct.id })}
                aria-pressed={currentSlot.chartType === ct.id}>
                {ct.label}
              </button>
            ))}
          </div>

          <div className={styles.segmented} role="group" aria-label="Interval">
            {INTERVALS.map(iv => (
              <button key={iv.value}
                className={`${styles.segBtn} ${currentSlot.interval === iv.value ? styles.segBtnActive : ''}`}
                onClick={() => updateSlot(activeSlot, { interval: iv.value })}>
                {iv.label}
              </button>
            ))}
          </div>

          <div className={styles.segmented} role="group" aria-label="Scale mode">
            {['NORMAL','LOG','%'].map((m, i) => {
              const val = ['normal','log','percent'][i]
              return (
                <button key={val}
                  className={`${styles.segBtn} ${scaleMode === val ? styles.segBtnActive : ''}`}
                  onClick={() => setScaleMode(val)}>
                  {m}
                </button>
              )
            })}
          </div>
        </div>

        <div className={styles.toolbarRight}>
          <button
            className={`${styles.toolbarBtn} ${symbolStripOpen ? styles.toolbarBtnActive : ''}`}
            onClick={() => setSymbolStripOpen(o => !o)}>
            ☰
          </button>
        </div>
      </div>

      {/* ── Compact symbol strip — replaces wide sidebar ── */}
      {symbolStripOpen && (
        <div className={styles.symbolStrip}>
          <input
            className={styles.stripSearch}
            placeholder="Search symbol…"
            value={stripSearch}
            onChange={e => setStripSearch(e.target.value)}
            autoFocus
          />
          <div className={styles.stripScroll}>
            {MARKET_MODULES.flatMap(mod =>
              mod.symbols
                .filter(s => !stripSearch ||
                  s.symbol.toLowerCase().includes(stripSearch.toLowerCase()) ||
                  s.label.toLowerCase().includes(stripSearch.toLowerCase())
                )
                .slice(0, stripSearch ? 40 : 6)
                .map(sym => {
                  const ch = liveChanges[sym.symbol]
                  return (
                    <button key={`${mod.id}:${sym.symbol}`}
                      className={`${styles.stripChip} ${currentSlot.symbol === sym.symbol ? styles.stripChipActive : ''}`}
                      onClick={() => { updateSlot(activeSlot, { symbol: sym.symbol, exchange: mod.exchange }); setSymbolStripOpen(false) }}>
                      <span className={styles.stripMod}>{mod.icon}</span>
                      <span className={styles.stripSym}>{sym.symbol}</span>
                      {ch && (
                        <span className={ch.changePct >= 0 ? styles.changePos : styles.changeNeg}>
                          {ch.changePct >= 0 ? '+' : ''}{ch.changePct.toFixed(2)}%
                        </span>
                      )}
                    </button>
                  )
                })
            )}
          </div>
        </div>
      )}

      {/* ── Indicator bar ── */}
      <div className={styles.indicatorBar}>
        <span className={styles.indicatorLabel}>OVL</span>
        {OVERLAYS.map(ind => (
          <button key={ind.id}
            className={`${styles.indicatorChip} ${indicators.includes(ind.id) ? styles.indicatorChipActive : ''}`}
            onClick={() => toggleIndicator(ind.id)} aria-pressed={indicators.includes(ind.id)}>
            {ind.label}
          </button>
        ))}
        <span className={styles.indicatorSep}>│</span>
        <span className={styles.indicatorLabel}>SUB</span>
        {SUB_PANES.map(ind => (
          <button key={ind.id}
            className={`${styles.indicatorChip} ${indicators.includes(ind.id) ? styles.indicatorChipActive : ''}`}
            onClick={() => toggleIndicator(ind.id)} aria-pressed={indicators.includes(ind.id)}>
            {ind.label}
          </button>
        ))}
      </div>

      {/* ── Full-width chart grid — no sidebar ── */}
      <div className={styles.main}>
        <div className={`${styles.chartGrid} ${styles[`grid_${layout}`]}`}>
          {visibleSlots.map((slot, idx) => (
            <div key={slot.id}
              className={`${styles.chartSlot} ${activeSlot === slot.id ? styles.chartSlotActive : ''}`}
              onClick={() => setActiveSlot(slot.id)}>
              <div className={styles.slotHeader} onClick={e => e.stopPropagation()}>
                <SymbolSelector
                  symbol={slot.symbol}
                  exchange={slot.exchange}
                  onSelect={(sym, exch) => updateSlot(slot.id, { symbol: sym, exchange: exch })}
                />
                {slotCount > 1 && <span className={styles.slotNum}>#{idx + 1}</span>}
              </div>
              <ErrorBoundary fallbackMessage="Chart unavailable">
                <StockChart
                  symbol={slot.symbol}
                  exchange={slot.exchange}
                  interval={slot.interval}
                  activeIndicators={indicators}
                  chartType={slot.chartType}
                  scaleMode={scaleMode}
                  className={styles.tvChart}
                />
              </ErrorBoundary>
            </div>
          ))}
        </div>
      </div>

      <Disclaimer compact />
    </div>
  )
}

// ── Symbol selector ───────────────────────────────────────────────────────────

function SymbolSelector({ symbol, exchange, onSelect }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)

  const allSymbols = MARKET_MODULES.flatMap(m =>
    m.symbols.map(s => ({ ...s, exchange: m.exchange, moduleIcon: m.icon }))
  )
  const filtered = search
    ? allSymbols.filter(s =>
        s.symbol.toLowerCase().includes(search.toLowerCase()) ||
        s.label.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 30)
    : allSymbols.slice(0, 30)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function h(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div className={styles.symbolSelector} ref={ref}>
      <button className={styles.symbolBtn} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className={styles.symbolBtnText}>{symbol}</span>
        <span className={styles.symbolBtnArrow}>▼</span>
      </button>
      {open && (
        <div className={styles.symbolDropdown}>
          <input className={styles.symbolSearch} placeholder="Search…"
            value={search} onChange={e => setSearch(e.target.value)} autoFocus />
          <div className={styles.symbolList}>
            {filtered.map(s => (
              <button key={`${s.exchange}:${s.symbol}`}
                className={`${styles.symbolOption} ${s.symbol === symbol ? styles.symbolOptionActive : ''}`}
                onClick={() => { onSelect(s.symbol, s.exchange); setOpen(false); setSearch('') }}>
                <span className={styles.symbolOptionSym}>{s.symbol}</span>
                <span className={styles.symbolOptionLabel}>{s.label}</span>
                <span className={styles.symbolOptionExch}>{s.moduleIcon}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
