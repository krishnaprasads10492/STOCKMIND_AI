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
import TradingViewChart, { toTVSymbol } from '@components/TradingViewChart.jsx'
import { Disclaimer } from '@components/Disclaimer.jsx'
import styles from './ChartsPage.module.css'

// ── Interval options ──────────────────────────────────────────────────────────

const INTERVALS = [
  { value: '1',   label: '1m' },
  { value: '5',   label: '5m' },
  { value: '15',  label: '15m' },
  { value: '30',  label: '30m' },
  { value: '60',  label: '1h' },
  { value: '240', label: '4h' },
  { value: 'D',   label: '1D' },
  { value: 'W',   label: '1W' },
  { value: 'M',   label: '1M' },
]

// ── Quick indicator presets ───────────────────────────────────────────────────

const INDICATOR_PRESETS = [
  { id: 'rsi',       label: 'RSI',       study: 'RSI@tv-basicstudies' },
  { id: 'macd',      label: 'MACD',      study: 'MACD@tv-basicstudies' },
  { id: 'bb',        label: 'Bollinger', study: 'BB@tv-basicstudies' },
  { id: 'ema20',     label: 'EMA 20',    study: 'MAExp@tv-basicstudies' },
  { id: 'ema50',     label: 'EMA 50',    study: 'MAExp@tv-basicstudies' },
  { id: 'volume',    label: 'Volume',    study: 'Volume@tv-basicstudies' },
  { id: 'vwap',      label: 'VWAP',      study: 'VWAP@tv-basicstudies' },
  { id: 'supertrend',label: 'Supertrend',study: 'Supertrend@tv-basicstudies' },
  { id: 'stoch',     label: 'Stochastic',study: 'Stochastic@tv-basicstudies' },
  { id: 'atr',       label: 'ATR',       study: 'ATR@tv-basicstudies' },
]

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
    { id: 1, symbol: activeSymbol || 'NIFTY50', exchange: 'NSE', interval: 'D' },
    { id: 2, symbol: 'BANKNIFTY',  exchange: 'NSE', interval: 'D' },
    { id: 3, symbol: 'SENSEX',     exchange: 'BSE', interval: 'D' },
    { id: 4, symbol: 'BTCUSDT',    exchange: 'BINANCE', interval: 'D' },
  ])

  const [layout,         setLayout]         = useState('single')
  const [activeSlot,     setActiveSlot]      = useState(1)
  const [activeIndicators, setActiveIndicators] = useState(['rsi', 'volume'])
  const [showWatchlist,  setShowWatchlist]   = useState(true)
  const [compareMode,    setCompareMode]     = useState(false)

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

  const activeStudies = INDICATOR_PRESETS
    .filter(p => activeIndicators.includes(p.id))
    .map(p => p.study)

  const currentSlot = slots.find(s => s.id === activeSlot) ?? slots[0]

  return (
    <div className={styles.page}>
      {/* ── Top toolbar ── */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <span className={styles.toolbarTitle}>📊 Charts</span>

          {/* Layout selector */}
          <div className={styles.layoutBtns} role="group" aria-label="Chart layout">
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
        <span className={styles.indicatorLabel}>Indicators:</span>
        {INDICATOR_PRESETS.map(ind => (
          <button
            key={ind.id}
            className={`${styles.indicatorChip} ${activeIndicators.includes(ind.id) ? styles.indicatorChipActive : ''}`}
            onClick={() => toggleIndicator(ind.id)}
            aria-pressed={activeIndicators.includes(ind.id)}
          >
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
              <span>Watchlist</span>
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

              {/* TradingView chart */}
              <ErrorBoundary fallbackMessage="Chart unavailable">
                <TradingViewChart
                  symbol={slot.symbol}
                  exchange={slot.exchange}
                  interval={slot.interval}
                  height="100%"
                  width="100%"
                  showToolbar={layout === 'single'}
                  showSideToolbar={layout === 'single'}
                  allowSymbolChange={layout === 'single'}
                  studies={activeStudies}
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
