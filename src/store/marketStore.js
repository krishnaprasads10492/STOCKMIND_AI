/**
 * marketStore — global market selection + favourites.
 * Persisted to localStorage so selection survives page refresh.
 */

import { create } from 'zustand'

const STORAGE_KEY = 'sm_market'
const FAV_KEY     = 'sm_favourites'

// ── Symbol master list per module ─────────────────────────────────────────────
export const MARKET_MODULES = [
  {
    id: 'indices-india', label: 'Indian Indices', icon: '📈', exchange: 'NSE',
    desc: 'NIFTY 50, BANK NIFTY, SENSEX',
    symbols: [
      { symbol: 'NIFTY50',    label: 'NIFTY 50',        basePrice: 24000 },
      { symbol: 'BANKNIFTY',  label: 'BANK NIFTY',      basePrice: 52000 },
      { symbol: 'SENSEX',     label: 'SENSEX',           basePrice: 79000 },
      { symbol: 'NIFTYIT',    label: 'NIFTY IT',         basePrice: 38000 },
      { symbol: 'NIFTYMID',   label: 'NIFTY MIDCAP 100', basePrice: 55000 },
      { symbol: 'FINNIFTY',   label: 'FIN NIFTY',        basePrice: 23000 },
      { symbol: 'NIFTYNXT50', label: 'NIFTY NEXT 50',    basePrice: 68000 },
    ],
  },
  {
    id: 'equities-india', label: 'Indian Equities', icon: '🏢', exchange: 'NSE',
    desc: 'NSE & BSE stocks',
    symbols: [
      { symbol: 'RELIANCE',  label: 'Reliance Industries', basePrice: 2900 },
      { symbol: 'TCS',       label: 'TCS',                 basePrice: 3800 },
      { symbol: 'HDFCBANK',  label: 'HDFC Bank',           basePrice: 1700 },
      { symbol: 'INFY',      label: 'Infosys',             basePrice: 1600 },
      { symbol: 'ICICIBANK', label: 'ICICI Bank',          basePrice: 1300 },
      { symbol: 'HINDUNILVR',label: 'Hindustan Unilever',  basePrice: 2400 },
      { symbol: 'ITC',       label: 'ITC',                 basePrice: 460  },
      { symbol: 'SBIN',      label: 'State Bank of India', basePrice: 820  },
      { symbol: 'BAJFINANCE',label: 'Bajaj Finance',       basePrice: 7200 },
      { symbol: 'WIPRO',     label: 'Wipro',               basePrice: 480  },
      { symbol: 'AXISBANK',  label: 'Axis Bank',           basePrice: 1150 },
      { symbol: 'MARUTI',    label: 'Maruti Suzuki',       basePrice: 12500},
      { symbol: 'TATAMOTORS',label: 'Tata Motors',         basePrice: 950  },
      { symbol: 'SUNPHARMA', label: 'Sun Pharma',          basePrice: 1700 },
      { symbol: 'ADANIENT',  label: 'Adani Enterprises',   basePrice: 2400 },
    ],
  },
  {
    id: 'fno-india', label: 'F&O', icon: '⚡', exchange: 'NSE',
    desc: 'Futures & Options',
    hasOptions: true,
    symbols: [
      { symbol: 'NIFTY',      label: 'NIFTY',          basePrice: 24000, lotSize: 25  },
      { symbol: 'BANKNIFTY',  label: 'BANK NIFTY',     basePrice: 52000, lotSize: 15  },
      { symbol: 'FINNIFTY',   label: 'FIN NIFTY',      basePrice: 23000, lotSize: 40  },
      { symbol: 'MIDCPNIFTY', label: 'MIDCAP NIFTY',   basePrice: 12000, lotSize: 75  },
      { symbol: 'SENSEX',     label: 'SENSEX',         basePrice: 79000, lotSize: 10  },
      { symbol: 'RELIANCE',   label: 'Reliance',       basePrice: 2900,  lotSize: 250 },
      { symbol: 'TCS',        label: 'TCS',            basePrice: 3800,  lotSize: 150 },
      { symbol: 'HDFCBANK',   label: 'HDFC Bank',      basePrice: 1700,  lotSize: 550 },
      { symbol: 'INFY',       label: 'Infosys',        basePrice: 1600,  lotSize: 300 },
      { symbol: 'ICICIBANK',  label: 'ICICI Bank',     basePrice: 1300,  lotSize: 700 },
      { symbol: 'SBIN',       label: 'SBI',            basePrice: 820,   lotSize: 1500},
      { symbol: 'BAJFINANCE', label: 'Bajaj Finance',  basePrice: 7200,  lotSize: 125 },
      { symbol: 'TATAMOTORS', label: 'Tata Motors',    basePrice: 950,   lotSize: 550 },
      { symbol: 'AXISBANK',   label: 'Axis Bank',      basePrice: 1150,  lotSize: 625 },
      { symbol: 'WIPRO',      label: 'Wipro',          basePrice: 480,   lotSize: 1500},
    ],
  },
  {
    id: 'crypto', label: 'Crypto', icon: '₿', exchange: 'BINANCE',
    desc: 'BTC, ETH & top 50',
    symbols: [
      { symbol: 'BTCUSDT',  label: 'Bitcoin (BTC)',    basePrice: 95000 },
      { symbol: 'ETHUSDT',  label: 'Ethereum (ETH)',   basePrice: 3200  },
      { symbol: 'BNBUSDT',  label: 'BNB',              basePrice: 620   },
      { symbol: 'SOLUSDT',  label: 'Solana (SOL)',     basePrice: 180   },
      { symbol: 'XRPUSDT',  label: 'XRP',              basePrice: 0.62  },
      { symbol: 'ADAUSDT',  label: 'Cardano (ADA)',    basePrice: 0.45  },
      { symbol: 'DOGEUSDT', label: 'Dogecoin (DOGE)',  basePrice: 0.18  },
      { symbol: 'AVAXUSDT', label: 'Avalanche (AVAX)', basePrice: 38    },
      { symbol: 'DOTUSDT',  label: 'Polkadot (DOT)',   basePrice: 7.5   },
      { symbol: 'MATICUSDT',label: 'Polygon (MATIC)',  basePrice: 0.85  },
    ],
  },
  {
    id: 'forex', label: 'Forex', icon: '💱', exchange: 'FOREX',
    desc: 'Major currency pairs',
    symbols: [
      { symbol: 'USDINR',  label: 'USD / INR', basePrice: 84   },
      { symbol: 'EURUSD',  label: 'EUR / USD', basePrice: 1.08 },
      { symbol: 'GBPUSD',  label: 'GBP / USD', basePrice: 1.27 },
      { symbol: 'USDJPY',  label: 'USD / JPY', basePrice: 154  },
      { symbol: 'AUDUSD',  label: 'AUD / USD', basePrice: 0.65 },
      { symbol: 'USDCHF',  label: 'USD / CHF', basePrice: 0.90 },
      { symbol: 'EURINR',  label: 'EUR / INR', basePrice: 91   },
    ],
  },
  {
    id: 'commodities', label: 'Commodities', icon: '🥇', exchange: 'MCX',
    desc: 'Gold, Silver, Crude Oil',
    symbols: [
      { symbol: 'GOLD',    label: 'Gold (MCX)',       basePrice: 72000 },
      { symbol: 'SILVER',  label: 'Silver (MCX)',     basePrice: 88000 },
      { symbol: 'CRUDEOIL',label: 'Crude Oil (MCX)',  basePrice: 6800  },
      { symbol: 'NATURALGAS',label:'Natural Gas (MCX)',basePrice: 220   },
      { symbol: 'COPPER',  label: 'Copper (MCX)',     basePrice: 820   },
      { symbol: 'ALUMINIUM',label:'Aluminium (MCX)',  basePrice: 230   },
    ],
  },
  {
    id: 'global-indices', label: 'Global Indices', icon: '🌐', exchange: 'NYSE',
    desc: 'S&P 500, NASDAQ, FTSE',
    symbols: [
      { symbol: 'SPX',    label: 'S&P 500',    basePrice: 5200  },
      { symbol: 'NDX',    label: 'NASDAQ 100', basePrice: 18000 },
      { symbol: 'DJI',    label: 'Dow Jones',  basePrice: 39000 },
      { symbol: 'FTSE',   label: 'FTSE 100',   basePrice: 8200  },
      { symbol: 'DAX',    label: 'DAX 40',     basePrice: 18500 },
      { symbol: 'N225',   label: 'Nikkei 225', basePrice: 38000 },
      { symbol: 'HSI',    label: 'Hang Seng',  basePrice: 17000 },
    ],
  },
]

// ── Key indices shown in the header ticker bar per market ────────────────────
export const HEADER_INDICES = {
  'indices-india':  ['NIFTY50','BANKNIFTY','SENSEX','NIFTYIT','FINNIFTY'],
  'equities-india': ['NIFTY50','BANKNIFTY','SENSEX'],
  'fno-india':      ['NIFTY50','BANKNIFTY','FINNIFTY','MIDCPNIFTY'],
  'crypto':         ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT'],
  'forex':          ['USDINR','EURUSD','GBPUSD','USDJPY'],
  'commodities':    ['GOLD','SILVER','CRUDEOIL','NATURALGAS'],
  'global-indices': ['SPX','NDX','DJI','FTSE','N225'],
}

// Simulated live prices (replace with real API feed)
export function getMockPrice(symbol) {
  const mod = MARKET_MODULES.flatMap(m => m.symbols).find(s => s.symbol === symbol)
  if (!mod) return null
  const base = mod.basePrice
  const change = (Math.random() - 0.48) * base * 0.015
  return {
    symbol,
    label: mod.label,
    price: Math.round((base + change) * 100) / 100,
    change: Math.round(change * 100) / 100,
    changePct: Math.round((change / base) * 10000) / 100,
  }
}

function loadFavourites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') } catch { return [] }
}

function saveFavourites(favs) {
  localStorage.setItem(FAV_KEY, JSON.stringify(favs))
}

function loadActiveModule() {
  return localStorage.getItem(STORAGE_KEY) ?? 'indices-india'
}

export const useMarketStore = create((set, get) => ({
  activeModuleId: loadActiveModule(),
  favourites:     loadFavourites(),   // array of symbol strings

  setActiveModule(moduleId) {
    localStorage.setItem(STORAGE_KEY, moduleId)
    // Reset to default symbol for that module
    const mod = MARKET_MODULES.find(m => m.id === moduleId)
    set({ activeModuleId: moduleId, activeSymbol: mod?.symbols[0]?.symbol ?? '' })
  },

  activeSymbol: (() => {
    const modId = loadActiveModule()
    const mod = MARKET_MODULES.find(m => m.id === modId)
    return mod?.symbols[0]?.symbol ?? ''
  })(),

  setActiveSymbol(symbol) {
    set({ activeSymbol: symbol })
  },

  toggleFavourite(symbol) {
    const favs = get().favourites
    const next = favs.includes(symbol)
      ? favs.filter(s => s !== symbol)
      : [...favs, symbol]
    saveFavourites(next)
    set({ favourites: next })
  },

  isFavourite(symbol) {
    return get().favourites.includes(symbol)
  },

  getActiveModule() {
    return MARKET_MODULES.find(m => m.id === get().activeModuleId) ?? MARKET_MODULES[0]
  },

  getActiveSymbolMeta() {
    const mod = get().getActiveModule()
    return mod.symbols.find(s => s.symbol === get().activeSymbol) ?? mod.symbols[0]
  },
}))
