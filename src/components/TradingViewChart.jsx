/**
 * TradingViewChart.jsx — TradingView Advanced Chart Widget
 *
 * Uses the TradingView widget.js constructor (not embed-widget) which:
 *   - Does NOT show the "symbol only available on TradingView" popup
 *   - Supports full symbol change, drawing tools, indicators
 *   - Syncs with StockMind theme and active symbol
 */

import { useEffect, useRef, memo, useCallback } from 'react'
import { useThemeStore } from '@store/themeStore.js'
import styles from './TradingViewChart.module.css'

// ── Symbol mapping: StockMind → TradingView ───────────────────────────────────

const TV_SYMBOL_MAP = {
  // Indian Indices
  NIFTY50:     'NSE:NIFTY',
  NIFTY:       'NSE:NIFTY',
  BANKNIFTY:   'NSE:BANKNIFTY',
  SENSEX:      'BSE:SENSEX',
  NIFTYIT:     'NSE:CNXIT',
  FINNIFTY:    'NSE:FINNIFTY',
  MIDCPNIFTY:  'NSE:MIDCPNIFTY',
  NIFTYMID:    'NSE:NIFTYMIDCAP100',
  NIFTYNXT50:  'NSE:NIFTYNXT50',

  // Indian Equities (NSE)
  RELIANCE:    'NSE:RELIANCE',
  TCS:         'NSE:TCS',
  HDFCBANK:    'NSE:HDFCBANK',
  INFY:        'NSE:INFY',
  ICICIBANK:   'NSE:ICICIBANK',
  HINDUNILVR:  'NSE:HINDUNILVR',
  ITC:         'NSE:ITC',
  SBIN:        'NSE:SBIN',
  BAJFINANCE:  'NSE:BAJFINANCE',
  WIPRO:       'NSE:WIPRO',
  AXISBANK:    'NSE:AXISBANK',
  MARUTI:      'NSE:MARUTI',
  TATAMOTORS:  'NSE:TATAMOTORS',
  SUNPHARMA:   'NSE:SUNPHARMA',
  ADANIENT:    'NSE:ADANIENT',
  KOTAKBANK:   'NSE:KOTAKBANK',
  HCLTECH:     'NSE:HCLTECH',
  TECHM:       'NSE:TECHM',
  DRREDDY:     'NSE:DRREDDY',
  CIPLA:       'NSE:CIPLA',
  DIVISLAB:    'NSE:DIVISLAB',
  APOLLOHOSP:  'NSE:APOLLOHOSP',
  TATASTEEL:   'NSE:TATASTEEL',
  JSWSTEEL:    'NSE:JSWSTEEL',
  HINDALCO:    'NSE:HINDALCO',
  VEDL:        'NSE:VEDL',
  COALINDIA:   'NSE:COALINDIA',
  ONGC:        'NSE:ONGC',
  NTPC:        'NSE:NTPC',
  POWERGRID:   'NSE:POWERGRID',
  BPCL:        'NSE:BPCL',

  // Crypto
  BTCUSDT:     'BINANCE:BTCUSDT',
  ETHUSDT:     'BINANCE:ETHUSDT',
  BNBUSDT:     'BINANCE:BNBUSDT',
  SOLUSDT:     'BINANCE:SOLUSDT',
  XRPUSDT:     'BINANCE:XRPUSDT',
  ADAUSDT:     'BINANCE:ADAUSDT',
  DOGEUSDT:    'BINANCE:DOGEUSDT',
  AVAXUSDT:    'BINANCE:AVAXUSDT',
  DOTUSDT:     'BINANCE:DOTUSDT',
  MATICUSDT:   'BINANCE:MATICUSDT',

  // Forex
  USDINR:      'FX_IDC:USDINR',
  EURUSD:      'FX:EURUSD',
  GBPUSD:      'FX:GBPUSD',
  USDJPY:      'FX:USDJPY',
  AUDUSD:      'FX:AUDUSD',
  USDCHF:      'FX:USDCHF',
  EURINR:      'FX_IDC:EURINR',

  // Commodities
  GOLD:        'MCX:GOLD1!',
  SILVER:      'MCX:SILVER1!',
  CRUDEOIL:    'MCX:CRUDEOIL1!',
  NATURALGAS:  'MCX:NATURALGAS1!',
  COPPER:      'MCX:COPPER1!',
  ALUMINIUM:   'MCX:ALUMINIUM1!',

  // Global Indices
  SPX:         'SP:SPX',
  NDX:         'NASDAQ:NDX',
  DJI:         'DJ:DJI',
  FTSE:        'SPREADEX:FTSE',
  DAX:         'XETR:DAX',
  N225:        'TVC:NI225',
  HSI:         'TVC:HSI',
}

export function toTVSymbol(symbol, exchange = 'NSE') {
  if (!symbol) return 'NSE:NIFTY'
  const upper = symbol.toUpperCase()
  if (TV_SYMBOL_MAP[upper]) return TV_SYMBOL_MAP[upper]
  if (exchange === 'BSE')     return `BSE:${upper}`
  if (exchange === 'BINANCE') return `BINANCE:${upper}`
  if (exchange === 'FOREX')   return `FX:${upper}`
  if (exchange === 'MCX')     return `MCX:${upper}`
  if (exchange === 'NYSE' || exchange === 'NASDAQ') return `NASDAQ:${upper}`
  return `NSE:${upper}`
}

// ── Theme config ──────────────────────────────────────────────────────────────

function getTVTheme(activeTheme) {
  const isLight = activeTheme === 'light-clean'
  const configs = {
    'cyber-dark':      { theme: 'dark',  bg: '#060b14', grid: 'rgba(0,212,255,0.06)',   up: '#00ff88', down: '#ff3366' },
    'iron-man':        { theme: 'dark',  bg: '#0a0500', grid: 'rgba(255,102,0,0.06)',   up: '#ffcc00', down: '#ff2200' },
    'matrix':          { theme: 'dark',  bg: '#000300', grid: 'rgba(0,255,65,0.05)',    up: '#00ff88', down: '#ff0033' },
    'tron':            { theme: 'dark',  bg: '#000510', grid: 'rgba(0,200,255,0.06)',   up: '#00ffcc', down: '#ff3399' },
    'blade-runner':    { theme: 'dark',  bg: '#080408', grid: 'rgba(255,68,204,0.04)',  up: '#ff9900', down: '#ff2266' },
    'ghost-in-shell':  { theme: 'dark',  bg: '#020c10', grid: 'rgba(0,220,200,0.05)',  up: '#00ffaa', down: '#ff4466' },
    'interstellar':    { theme: 'dark',  bg: '#050305', grid: 'rgba(255,176,64,0.04)', up: '#88ff88', down: '#ff6644' },
    'dune':            { theme: 'dark',  bg: '#0a0700', grid: 'rgba(220,160,0,0.05)',  up: '#88cc44', down: '#cc4422' },
    'avatar':          { theme: 'dark',  bg: '#010a08', grid: 'rgba(0,255,159,0.05)',  up: '#44ffaa', down: '#ff4488' },
    'midnight-blue':   { theme: 'dark',  bg: '#050a18', grid: 'rgba(100,136,255,0.05)',up: '#44ddaa', down: '#ff5577' },
    'neon-tokyo':      { theme: 'dark',  bg: '#06000a', grid: 'rgba(255,0,204,0.04)',  up: '#00ffcc', down: '#ff0066' },
    'gotham-tactical': { theme: 'dark',  bg: '#080d0a', grid: 'rgba(0,255,65,0.04)',   up: '#00ff88', down: '#ff3333' },
    'stark-jarvis':    { theme: 'dark',  bg: '#07080f', grid: 'rgba(0,180,220,0.04)',  up: '#d4a017', down: '#cc2200' },
    'cerebro-neural':  { theme: 'dark',  bg: '#080822', grid: 'rgba(120,90,255,0.04)', up: '#44ddaa', down: '#ff5577' },
    'void-sentinel':   { theme: 'dark',  bg: '#030308', grid: 'rgba(80,60,160,0.04)',  up: '#00ffcc', down: '#ff4466' },
    'light-clean':     { theme: 'light', bg: '#f0f4f8', grid: 'rgba(0,0,0,0.06)',      up: '#16a34a', down: '#dc2626' },
  }
  return configs[activeTheme] ?? configs['cyber-dark']
}

// ── Widget ID counter (unique per mount) ──────────────────────────────────────
let _widgetCounter = 0

function TradingViewChart({
  symbol = 'NIFTY50',
  exchange = 'NSE',
  interval = 'D',
  height = '100%',
  width = '100%',
  showToolbar = true,
  showSideToolbar = true,
  showDetails = false,
  showHotlist = false,
  showCalendar = false,
  allowSymbolChange = true,
  studies = [],
  compareSymbols = [],
  className = '',
}) {
  const containerRef = useRef(null)
  const widgetRef    = useRef(null)
  const containerId  = useRef(`tv_chart_${++_widgetCounter}`)
  const { activeTheme } = useThemeStore()

  const tvSymbol = toTVSymbol(symbol, exchange)
  const tc       = getTVTheme(activeTheme)

  const initWidget = useCallback(() => {
    const el = document.getElementById(containerId.current)
    if (!el || !window.TradingView) return

    // Destroy previous widget
    if (widgetRef.current) {
      try { widgetRef.current.remove() } catch {}
      widgetRef.current = null
    }

    widgetRef.current = new window.TradingView.widget({
      container_id:        containerId.current,
      symbol:              tvSymbol,
      interval,
      autosize:            true,
      theme:               tc.theme,
      style:               '1',
      locale:              'en',
      timezone:            'Asia/Kolkata',
      toolbar_bg:          tc.bg,
      backgroundColor:     tc.bg,
      gridColor:           tc.grid,
      hide_top_toolbar:    !showToolbar,
      hide_side_toolbar:   !showSideToolbar,
      hide_legend:         false,
      withdateranges:      true,
      allow_symbol_change: allowSymbolChange,
      save_image:          true,
      details:             showDetails,
      hotlist:             showHotlist,
      calendar:            showCalendar,
      studies,
      compareSymbols,
      overrides: {
        'mainSeriesProperties.candleStyle.upColor':         tc.up,
        'mainSeriesProperties.candleStyle.downColor':       tc.down,
        'mainSeriesProperties.candleStyle.borderUpColor':   tc.up,
        'mainSeriesProperties.candleStyle.borderDownColor': tc.down,
        'mainSeriesProperties.candleStyle.wickUpColor':     tc.up,
        'mainSeriesProperties.candleStyle.wickDownColor':   tc.down,
      },
      // Suppress the "symbol only available on TradingView" notification
      disabled_features: [
        'header_symbol_search',
        'symbol_search_hot_key',
        'display_market_status',
        'go_to_date',
      ],
      enabled_features: [
        'hide_left_toolbar_by_default',
        'move_logo_to_main_pane',
      ],
    })
  }, [tvSymbol, interval, tc.theme, tc.bg, tc.grid, tc.up, tc.down,
      showToolbar, showSideToolbar, showDetails, showHotlist, showCalendar,
      allowSymbolChange, studies, compareSymbols])

  // Load widget.js once, then init
  useEffect(() => {
    if (window.TradingView) {
      initWidget()
      return
    }

    // Check if script already loading
    if (document.getElementById('tv-widget-script')) {
      const check = setInterval(() => {
        if (window.TradingView) { clearInterval(check); initWidget() }
      }, 100)
      return () => clearInterval(check)
    }

    const script = document.createElement('script')
    script.id    = 'tv-widget-script'
    script.src   = 'https://s3.tradingview.com/tv.js'
    script.async = true
    script.onload = () => initWidget()
    document.head.appendChild(script)

    return () => {
      if (widgetRef.current) {
        try { widgetRef.current.remove() } catch {}
        widgetRef.current = null
      }
    }
  }, [initWidget])

  return (
    <div
      className={`${styles.container} ${className}`}
      style={{ height, width }}
    >
      <div
        id={containerId.current}
        style={{ height: '100%', width: '100%' }}
      />
    </div>
  )
}

export default memo(TradingViewChart)
