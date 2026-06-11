/**
 * ChartsPage — Full TradingView-powered charting page.
 *
 * Features:
 *   - Full-screen TradingView Advanced Chart
 *   - Symbol picker synced with StockMind market modules
 *   - Interval selector (1m, 5m, 15m, 30m, 1h, 4h, 1D, 1W, 1M)
 *   - Quick-add popular indicators (RSI, MACD, Bollinger, Volume, EMA)
 *   - Compare mode — overlay multiple symbols
 *   - Layout presets: Single, Split (2 charts), Quad (4 charts)
 *   - Watchlist sidebar — quick switch between favourites
 *   - Theme synced with app theme
 */

import { useState, useCallback } from 'react'
import { useMarketStore, MARKET_MODULES } from '@store/marketStore.js'
import { useThemeStore } from '@store/themeStore.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import { InfoTooltip } from '@components/InfoTooltip.jsx'
import { StockChart } from '@components/StockChart.jsx'
import { Disclaimer } from '@components/Disclaimer.jsx'
import styles from './ChartsPage.module.css'

const PAGE = 'charts'

// ── Interval options ──────────────────────────────────────────────────────────

const INTERVALS = [
  { value: '5m',  label: '5m' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1h',  label: '1h' },
  { value: '1d',  label: '1D' },
  { value: '1wk', label: '1W' },
  { value: '1mo', label: '1M' },
]

// ── Quick indicator presets ───────────────────────────────────────────────────

const INDICATOR_PRESETS = [
  // Overlays (on main chart)
  { id: 'ema20',      label: 'EMA 20',     group: 'overlay' },
  { id: 'ema50',      label: 'EMA 50',     group: 'overlay' },
  { id: 'ema200',     label: 'EMA 200',    group: 'overlay' },
  { id: 'bb',         label: 'Bollinger',  group: 'overlay' },
  { id: 'vwap',       label: 'VWAP',       group: 'overlay' },
  { id: 'supertrend', label: 'Supertrend', group: 'overlay' },
  // Sub-panes (separate charts below)
  { id: 'rsi',        label: 'RSI',        group: 'pane' },
  { id: 'macd',       label: 'MACD',       group: 'pane' },
  { id: 'stoch',      label: 'Stoch',      group: 'pane' },
  { id: 'atr',        label: 'ATR',        group: 'pane' },
  { id: 'volume',     label: 'Volume',     group: 'overlay' },
]

// ── Indicator info ────────────────────────────────────────────────────────────

const INDICATOR_INFO = {
  ema20:      'EMA 20: Short-term trend. Price above = bullish. Crossover with EMA50 = signal.',
  ema50:      'EMA 50: Medium-term trend. Golden cross (EMA20 > EMA50) = bullish. Death cross = bearish.',
  ema200:     'EMA 200: Long-term benchmark. Price above = bull market. Below = bear market.',
  bb:         'Bollinger Bands: Volatility channel. Upper band = overbought. Lower = oversold. Squeeze = breakout.',
  vwap:       'VWAP: Institutional benchmark. Price above = bullish intraday. Below = bearish.',
  supertrend: 'Supertrend: ATR-based trend. Green line = uptrend. Red line = downtrend. Flip = trend change.',
  rsi:        'RSI(14): Momentum. Below 30 = oversold (buy). Above 70 = overbought (sell). Sub-pane.',
  macd:       'MACD(12,26,9): Trend + momentum. MACD > Signal = bullish. Histogram shows divergence. Sub-pane.',
  stoch:      'Stochastic(14,3): Momentum. %K below 20 = oversold. Above 80 = overbought. Sub-pane.',
  atr:        'ATR(14): Volatility. High ATR = volatile. Use for stop-loss sizing: SL = 1.5–2× ATR. Sub-pane.',
  volume:     'Volume: Green = buying pressure. Red = selling pressure. High volume confirms moves.',
}

// ── Layout options ────────────────────────────────────────────────────────────

const LAYOUTS = [
  { id: 'single', label: '⬜ Single',  icon: '⬜' },
  { id: 'split',  label: '⬛⬛ Split', icon: '⬛⬛' },
  { id: 'quad',   label: '⊞ Quad',    icon: '⊞' },
]

export default function ChartsPage() {
  const { activeSymbol, activeModuleId, getActiveModule, favourites } = useMarketStore()
  const { activeTheme } = useThemeStore()

  // Chart slots — each has its own symbol + interval
  const [slots, setSlots] = useState([
    { id: 1, symbol: activeSymbol || 'NIFTY50', exchange: 'NSE', interval: '1d' },
    { id: 2, symbol: 'BANKNIFTY',  exchange: 'NSE', interval: '1d' },
    { id: 3, symbol: 'SENSEX',     exchange: 'BSE', interval: '1d' },
    { id: 4, symbol: 'BTCUSDT',    exchange: 'BINANCE', interval: '1d' },
  ])

  const [layout,         setLayout]         = useState('single')
  const [activeSlot,     setActiveSlot]      = useState(1)
  const [activeIndicators, setActiveIndicators] = useState(['ema20', 'volume'])
  const [showWatchlist,  setShowWatchlist]   = useState(true)

  const activeMod = getActiveModule()

  // Get visible slot count
  const slotCount = layout === 'single' ? 1 : layout === 'split' ? 2 : 4
  const visibleSlots = slots.slice(0, slotCount)

  function updateSlot(id, updates) {
    setSlots(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
  }

  function setSlotSymbol(id, symbol, exchange) {
    updateSlot(id, { symbol, exchange })
  }

  function setSlotInterval(id, interval) {
    updateSlot(id, { interval })
  }

  function toggleIndicator(indicatorId) {
    setActiveIndicators(prev =>
      prev.includes(indicatorId)
        ? prev.filter(i => i !== indicatorId)
        : [...prev, indicatorId]
    )
  }

  const currentSlot = slots.find(s => s.id === activeSlot) ?? slots[0]

  return (
    <div className={styles.page}>
      {/* ── Top toolbar ── */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <span className={styles.toolbarTitle}>
            📊 Charts
            <InfoTooltip
              page={PAGE}
              title="StockMind Native Charts"
              content="Professional candlestick charts powered by Lightweight Charts (open source). Data sourced directly from Yahoo Finance via our backend — no third-party popups or restrictions. Supports all NSE/BSE stocks, indices, crypto, forex, and commodities."
              example={{ text: 'Select any symbol from the watchlist. Toggle EMA, Bollinger Bands, VWAP overlays. Switch between Candle, Bar, Line, and Area chart types.' }}
            />
          </span>

          {/* Layout selector */}
          <div className={styles.layoutBtns} role="group" aria-label="Chart layout">
            <span className={styles.layoutLabel}>
              Layout
              <InfoTooltip
                page={PAGE}
                title="Chart Layout"
                content="Single: one full-screen chart. Split: two charts side by side. Quad: four charts in a 2×2 grid. Each chart has its own symbol and interval."
                example={{ text: 'Use Quad to compare NIFTY50, BANKNIFTY, RELIANCE, and BTCUSDT simultaneously.' }}
              />
            </span>
            {LAYOUTS.map(l => (
              <button
                key={l.id}
                className={`${styles.layoutBtn} ${layout === l.id ? styles.layoutBtnActive : ''}`}
                onClick={() => setLayout(l.id)}
                title={l.label}
                aria-pressed={layout === l.id}
              >
                {l.icon}
              </button>
            ))}
          </div>

          {/* Interval selector for active slot */}
          <div className={styles.intervalBtns} role="group" aria-label="Chart interval">
            <span className={styles.intervalLabel}>
              Interval
              <InfoTooltip
                page={PAGE}
                title="Chart Interval (Timeframe)"
                content="The time period each candle represents. 1m = 1 minute per candle. 1D = 1 day per candle. Shorter intervals show intraday moves; longer intervals show trends."
                example={{ text: 'For intraday trading use 5m or 15m. For swing trades use 1D. For long-term investing use 1W or 1M.' }}
              />
            </span>
            {INTERVALS.map(iv => (
              <button
                key={iv.value}
                className={`${styles.intervalBtn} ${currentSlot.interval === iv.value ? styles.intervalBtnActive : ''}`}
                onClick={() => setSlotInterval(activeSlot, iv.value)}
              >
                {iv.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.toolbarRight}>
          {/* Watchlist toggle */}
          <button
            className={`${styles.toolbarBtn} ${showWatchlist ? styles.toolbarBtnActive : ''}`}
            onClick={() => setShowWatchlist(s => !s)}
            title="Toggle watchlist"
          >
            ☰ Watchlist
          </button>
        </div>
      </div>

      {/* ── Indicator bar ── */}
      <div className={styles.indicatorBar}>
        <span className={styles.indicatorLabel}>
          Overlays
          <InfoTooltip page={PAGE} title="Overlay Indicators" content="Drawn directly on the price chart." />
        </span>
        {INDICATOR_PRESETS.filter(i => i.group === 'overlay').map(ind => (
          <button key={ind.id}
            className={`${styles.indicatorChip} ${activeIndicators.includes(ind.id) ? styles.indicatorChipActive : ''}`}
            onClick={() => toggleIndicator(ind.id)} aria-pressed={activeIndicators.includes(ind.id)}
            title={INDICATOR_INFO[ind.id]}>
            {ind.label}
          </button>
        ))}
        <span className={styles.indicatorSep}>│</span>
        <span className={styles.indicatorLabel}>
          Sub-panes
          <InfoTooltip page={PAGE} title="Sub-pane Indicators" content="Rendered in separate panels below the main chart. RSI, MACD, Stochastic, ATR." />
        </span>
        {INDICATOR_PRESETS.filter(i => i.group === 'pane').map(ind => (
          <button key={ind.id}
            className={`${styles.indicatorChip} ${activeIndicators.includes(ind.id) ? styles.indicatorChipActive : ''}`}
            onClick={() => toggleIndicator(ind.id)} aria-pressed={activeIndicators.includes(ind.id)}
            title={INDICATOR_INFO[ind.id]}>
            {ind.label}
          </button>
        ))}
      </div>

      {/* ── Main area ── */}
      <div className={styles.main}>
        {/* Watchlist sidebar */}
        {showWatchlist && (
          <aside className={styles.watchlist}>
            <div className={styles.watchlistHeader}>
              <span>
                Watchlist
                <InfoTooltip
                  page={PAGE}
                  title="Watchlist"
                  content="All symbols grouped by market module. Click any symbol to load it in the active chart slot. The active slot is highlighted with a colored border."
                  example={{ text: 'In Split or Quad layout, click a chart first to make it active, then click a symbol to load it there.' }}
                />
              </span>
            </div>

            {/* Module symbols */}
            {MARKET_MODULES.map(mod => (
              <div key={mod.id} className={styles.watchlistGroup}>
                <div className={styles.watchlistGroupTitle}>
                  {mod.icon} {mod.label}
                </div>
                {mod.symbols.slice(0, 8).map(sym => (
                  <button
                    key={sym.symbol}
                    className={`${styles.watchlistItem} ${currentSlot.symbol === sym.symbol ? styles.watchlistItemActive : ''}`}
                    onClick={() => setSlotSymbol(activeSlot, sym.symbol, mod.exchange)}
                  >
                    <span className={styles.watchlistSymbol}>{sym.symbol}</span>
                    <span className={styles.watchlistLabel}>{sym.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </aside>
        )}

        {/* Chart grid */}
        <div className={`${styles.chartGrid} ${styles[`grid_${layout}`]}`}>
          {visibleSlots.map((slot, idx) => (
            <div
              key={slot.id}
              className={`${styles.chartSlot} ${activeSlot === slot.id ? styles.chartSlotActive : ''}`}
              onClick={() => setActiveSlot(slot.id)}
            >
              {/* Slot header */}
              <div className={styles.slotHeader}>
                <SymbolSelector
                  symbol={slot.symbol}
                  exchange={slot.exchange}
                  onSelect={(sym, exch) => setSlotSymbol(slot.id, sym, exch)}
                />
                <span className={styles.slotInterval}>{slot.interval}</span>
                {slotCount > 1 && (
                  <span className={styles.slotNum}>Chart {idx + 1}</span>
                )}
              </div>

              {/* StockChart — our own native chart, no popups */}
              <ErrorBoundary fallbackMessage="Chart unavailable">
                <StockChart
                  symbol={slot.symbol}
                  exchange={slot.exchange}
                  interval={slot.interval}
                  activeIndicators={activeIndicators}
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

// ── Symbol selector dropdown ──────────────────────────────────────────────────

function SymbolSelector({ symbol, exchange, onSelect }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const allSymbols = MARKET_MODULES.flatMap(m =>
    m.symbols.map(s => ({ ...s, exchange: m.exchange, moduleLabel: m.label, moduleIcon: m.icon }))
  )

  const filtered = search
    ? allSymbols.filter(s =>
        s.symbol.toLowerCase().includes(search.toLowerCase()) ||
        s.label.toLowerCase().includes(search.toLowerCase())
      )
    : allSymbols

  return (
    <div className={styles.symbolSelector}>
      <button
        className={styles.symbolBtn}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className={styles.symbolBtnText}>{symbol}</span>
        <span className={styles.symbolBtnArrow}>▼</span>
      </button>

      {open && (
        <div className={styles.symbolDropdown}>
          <input
            className={styles.symbolSearch}
            placeholder="Search symbol…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          <div className={styles.symbolList}>
            {filtered.slice(0, 30).map(s => (
              <button
                key={`${s.exchange}:${s.symbol}`}
                className={`${styles.symbolOption} ${s.symbol === symbol ? styles.symbolOptionActive : ''}`}
                onClick={() => { onSelect(s.symbol, s.exchange); setOpen(false); setSearch('') }}
              >
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
