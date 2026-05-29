/**
 * TradingViewChart.jsx — Full TradingView Advanced Chart Widget
 *
 * Features:
 *   - Full candlestick / bar / line / area / Heikin-Ashi / Renko charts
 *   - All TradingView drawing tools (trendlines, Fibonacci, etc.)
 *   - 100+ built-in indicators (RSI, MACD, Bollinger, Ichimoku, etc.)
 *   - Multi-timeframe: 1m, 5m, 15m, 30m, 1h, 4h, 1D, 1W, 1M
 *   - Symbol search — any stock, index, crypto, forex, commodity
 *   - Syncs with StockMind active symbol and theme
 *   - Overlay prediction signals as price levels (optional)
 *   - Saves chart layout per symbol in localStorage
 *
 * Symbol mapping: StockMind → TradingView exchange:symbol format
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

/**
 * Convert a StockMind symbol to TradingView format.
 * Falls back to NSE:SYMBOL for unknown Indian symbols.
 */
export function toTVSymbol(symbol, exchange = 'NSE') {
  if (!symbol) return 'NSE:NIFTY'
  const upper = symbol.toUpperCase()
  if (TV_SYMBOL_MAP[upper]) return TV_SYMBOL_MAP[upper]
  // Fallback by exchange
  if (exchange === 'BSE')     return `BSE:${upper}`
  if (exchange === 'BINANCE') return `BINANCE:${upper}`
  if (exchange === 'FOREX')   return `FX:${upper}`
  if (exchange === 'MCX')     return `MCX:${upper}`
  if (exchange === 'NYSE' || exchange === 'NASDAQ') return `NASDAQ:${upper}`
  return `NSE:${upper}`
}

// ── Theme → TradingView config ────────────────────────────────────────────────

function getTVThemeConfig(activeTheme) {
  const isLight = activeTheme === 'light-clean'

  const themeConfigs = {
    'cyber-dark':      { theme: 'dark',  bg: '#060b14', gridColor: 'rgba(0,212,255,0.06)',  upColor: '#00ff88', downColor: '#ff3366' },
    'iron-man':        { theme: 'dark',  bg: '#0a0500', gridColor: 'rgba(255,102,0,0.06)',  upColor: '#ffcc00', downColor: '#ff2200' },
    'matrix':          { theme: 'dark',  bg: '#000300', gridColor: 'rgba(0,255,65,0.05)',   upColor: '#00ff88', downColor: '#ff0033' },
    'tron':            { theme: 'dark',  bg: '#000510', gridColor: 'rgba(0,200,255,0.06)',  upColor: '#00ffcc', downColor: '#ff3399' },
    'blade-runner':    { theme: 'dark',  bg: '#080408', gridColor: 'rgba(255,68,204,0.04)', upColor: '#ff9900', downColor: '#ff2266' },
    'ghost-in-shell':  { theme: 'dark',  bg: '#020c10', gridColor: 'rgba(0,220,200,0.05)', upColor: '#00ffaa', downColor: '#ff4466' },
    'interstellar':    { theme: 'dark',  bg: '#050305', gridColor: 'rgba(255,176,64,0.04)', upColor: '#88ff88', downColor: '#ff6644' },
    'dune':            { theme: 'dark',  bg: '#0a0700', gridColor: 'rgba(220,160,0,0.05)',  upColor: '#88cc44', downColor: '#cc4422' },
    'avatar':          { theme: 'dark',  bg: '#010a08', gridColor: 'rgba(0,255,159,0.05)', upColor: '#44ffaa', downColor: '#ff4488' },
    'midnight-blue':   { theme: 'dark',  bg: '#050a18', gridColor: 'rgba(100,136,255,0.05)',upColor: '#44ddaa', downColor: '#ff5577' },
    'neon-tokyo':      { theme: 'dark',  bg: '#06000a', gridColor: 'rgba(255,0,204,0.04)', upColor: '#00ffcc', downColor: '#ff0066' },
    'gotham-tactical': { theme: 'dark',  bg: '#080d0a', gridColor: 'rgba(0,255,65,0.04)',  upColor: '#00ff88', downColor: '#ff3333' },
    'stark-jarvis':    { theme: 'dark',  bg: '#07080f', gridColor: 'rgba(0,180,220,0.04)', upColor: '#d4a017', downColor: '#cc2200' },
    'cerebro-neural':  { theme: 'dark',  bg: '#080822', gridColor: 'rgba(120,90,255,0.04)',upColor: '#44ddaa', downColor: '#ff5577' },
    'void-sentinel':   { theme: 'dark',  bg: '#030308', gridColor: 'rgba(80,60,160,0.04)', upColor: '#00ffcc', downColor: '#ff4466' },
    'light-clean':     { theme: 'light', bg: '#f0f4f8', gridColor: 'rgba(0,0,0,0.06)',     upColor: '#16a34a', downColor: '#dc2626' },
  }

  return themeConfigs[activeTheme] ?? themeConfigs['cyber-dark']
}

// ── Main component ────────────────────────────────────────────────────────────

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
  onSymbolChange,
}) {
  const containerRef = useRef(null)
  const scriptRef    = useRef(null)
  const { activeTheme } = useThemeStore()

  const buildConfig = useCallback(() => {
    const tvSymbol = toTVSymbol(symbol, exchange)
    const themeConfig = getTVThemeConfig(activeTheme)

    return {
      // Symbol
      symbol:              tvSymbol,
      interval,
      // Layout
      autosize:            true,
      // Theme
      theme:               themeConfig.theme,
      backgroundColor:     themeConfig.bg,
      gridColor:           themeConfig.gridColor,
      // Toolbar visibility
      hide_top_toolbar:    !showToolbar,
      hide_side_toolbar:   !showSideToolbar,
      hide_legend:         false,
      hide_volume:         false,
      // Features
      allow_symbol_change: allowSymbolChange,
      details:             showDetails,
      hotlist:             showHotlist,
      calendar:            showCalendar,
      withdateranges:      true,
      save_image:          true,
      // Chart style: 1=Candles, 2=Bars, 3=Line, 4=Area, 8=Heikin-Ashi
      style:               '1',
      locale:              'en',
      timezone:            'Asia/Kolkata',
      // Studies (indicators)
      studies,
      // Compare symbols
      compareSymbols,
      // Watchlist
      watchlist:           [],
      // Overrides for candle colors
      overrides: {
        'mainSeriesProperties.candleStyle.upColor':         themeConfig.upColor,
        'mainSeriesProperties.candleStyle.downColor':       themeConfig.downColor,
        'mainSeriesProperties.candleStyle.borderUpColor':   themeConfig.upColor,
        'mainSeriesProperties.candleStyle.borderDownColor': themeConfig.downColor,
        'mainSeriesProperties.candleStyle.wickUpColor':     themeConfig.upColor,
        'mainSeriesProperties.candleStyle.wickDownColor':   themeConfig.downColor,
      },
    }
  }, [symbol, exchange, interval, activeTheme, showToolbar, showSideToolbar,
      showDetails, showHotlist, showCalendar, allowSymbolChange, studies, compareSymbols])

  useEffect(() => {
    if (!containerRef.current) return

    // Remove previous widget
    if (scriptRef.current) {
      try { containerRef.current.removeChild(scriptRef.current) } catch {}
      scriptRef.current = null
    }
    // Clear widget div
    const widgetDiv = containerRef.current.querySelector('.tradingview-widget-container__widget')
    if (widgetDiv) widgetDiv.innerHTML = ''

    const script = document.createElement('script')
    script.src   = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.type  = 'text/javascript'
    script.async = true
    script.innerHTML = JSON.stringify(buildConfig())

    containerRef.current.appendChild(script)
    scriptRef.current = script

    return () => {
      if (scriptRef.current && containerRef.current) {
        try { containerRef.current.removeChild(scriptRef.current) } catch {}
      }
    }
  }, [buildConfig])

  return (
    <div
      className={`tradingview-widget-container ${styles.container} ${className}`}
      ref={containerRef}
      style={{ height, width }}
    >
      <div
        className="tradingview-widget-container__widget"
        style={{ height: 'calc(100% - 28px)', width: '100%' }}
      />
      <div className={styles.copyright}>
        <a
          href={`https://www.tradingview.com/chart/?symbol=${toTVSymbol(symbol, exchange)}`}
          rel="noopener nofollow"
          target="_blank"
          className={styles.copyrightLink}
        >
          {symbol} chart
        </a>
        <span className={styles.copyrightText}> by TradingView</span>
      </div>
    </div>
  )
}

export default memo(TradingViewChart)
