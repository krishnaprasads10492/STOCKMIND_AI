/**
 * integrations.js — Central External Resource Configuration Registry
 *
 * All third-party API integrations in ONE place.
 * Each integration has:
 *   - enabled:      boolean — controlled by env var
 *   - baseUrl:      the API base URL
 *   - authType:     'header' | 'query' | 'bearer' | 'none'
 *   - envKey:       env var name for the API key
 *   - rateLimits:   req/hour and req/minute (for our own rate limiter)
 *   - timeout:      request timeout in ms
 *   - retries:      how many times to retry on failure
 *   - fallback:     which integration to fall back to on failure
 *   - cost:         estimated cost model
 *   - docs:         documentation URL
 *
 * Usage:
 *   import { INTEGRATIONS, getActive, buildAuthHeader } from '../config/integrations.js'
 *   const cfg = getActive('market_data')  // returns first enabled integration in category
 */

function env(key, fallback = '') { return process.env[key] ?? fallback }
function envBool(key, fb = false) {
  const v = process.env[key]
  return v === undefined ? fb : ['true','1','yes'].includes(v.toLowerCase())
}
function envInt(key, fb) { const v = parseInt(process.env[key], 10); return isNaN(v) ? fb : v }

// ═══════════════════════════════════════════════════════════════════════════════
// MARKET DATA — Indian + Global
// ═══════════════════════════════════════════════════════════════════════════════

export const MARKET_DATA = {

  // ── Yahoo Finance (free, no key, default for all OHLCV) ──────────────────
  yahoo_finance: {
    id:          'yahoo_finance',
    name:        'Yahoo Finance',
    category:    'market_data',
    enabled:     true,   // always on — no key needed
    baseUrl:     'https://query1.finance.yahoo.com',
    altBaseUrl:  'https://query2.finance.yahoo.com',
    authType:    'none',
    envKey:      null,
    rateLimits:  { perHour: 2000, perMinute: 60 },
    timeout:     10_000,
    retries:     2,
    fallback:    'stooq',
    supports:    ['OHLCV', 'realtime_quote', 'fundamentals', 'options_chain', 'crypto', 'forex'],
    exchanges:   ['NSE', 'BSE', 'NYSE', 'NASDAQ', 'CRYPTO'],
    cost:        'free',
    docs:        'https://finance.yahoo.com',
    notes:       'Unofficial API — no SLA. Use yfinance suffix: RELIANCE.NS, TCS.NS',
  },

  // ── Stooq (free EOD, no key) ──────────────────────────────────────────────
  stooq: {
    id:          'stooq',
    name:        'Stooq',
    category:    'market_data',
    enabled:     true,
    baseUrl:     'https://stooq.com',
    authType:    'none',
    envKey:      null,
    rateLimits:  { perHour: 600, perMinute: 20 },
    timeout:     12_000,
    retries:     1,
    fallback:    'alpha_vantage',
    supports:    ['OHLCV', 'historical'],
    exchanges:   ['NSE', 'BSE', 'NYSE', 'NASDAQ'],
    cost:        'free',
    docs:        'https://stooq.com/db/h/',
  },

  // ── Alpha Vantage (free 25 req/day, paid for more) ──────────────────────
  alpha_vantage: {
    id:          'alpha_vantage',
    name:        'Alpha Vantage',
    category:    'market_data',
    enabled:     envBool('ALPHA_VANTAGE_ENABLED', false),
    baseUrl:     'https://www.alphavantage.co',
    authType:    'query',
    authParam:   'apikey',
    envKey:      'ALPHA_VANTAGE_KEY',
    get apiKey() { return env('ALPHA_VANTAGE_KEY', env('VITE_ALPHA_VANTAGE_KEY')) },
    rateLimits:  { perDay: 25, perMinute: 5 },  // free tier
    timeout:     15_000,
    retries:     1,
    fallback:    'twelve_data',
    supports:    ['OHLCV', 'intraday', 'fundamentals', 'forex', 'crypto', 'macro'],
    exchanges:   ['NSE', 'BSE', 'NYSE', 'NASDAQ', 'FOREX', 'CRYPTO'],
    cost:        'free_25_per_day',
    docs:        'https://www.alphavantage.co/documentation/',
    signup:      'https://www.alphavantage.co/support/#api-key',
  },

  // ── Twelve Data (free 800 req/day) ────────────────────────────────────────
  twelve_data: {
    id:          'twelve_data',
    name:        'Twelve Data',
    category:    'market_data',
    enabled:     envBool('TWELVE_DATA_ENABLED', false),
    baseUrl:     'https://api.twelvedata.com',
    authType:    'query',
    authParam:   'apikey',
    envKey:      'TWELVE_DATA_KEY',
    get apiKey() { return env('TWELVE_DATA_KEY', env('VITE_TWELVE_DATA_KEY')) },
    rateLimits:  { perDay: 800, perMinute: 8 },
    timeout:     10_000,
    retries:     1,
    fallback:    'yahoo_finance',
    supports:    ['OHLCV', 'intraday', 'realtime_quote', 'options'],
    exchanges:   ['NSE', 'BSE', 'NYSE', 'NASDAQ', 'FOREX', 'CRYPTO'],
    cost:        'free_800_per_day',
    docs:        'https://twelvedata.com/docs',
  },

  // ── Finnhub (free 60 req/min) ─────────────────────────────────────────────
  finnhub: {
    id:          'finnhub',
    name:        'Finnhub',
    category:    'market_data',
    enabled:     envBool('FINNHUB_ENABLED', !!env('FINNHUB_KEY')),
    baseUrl:     'https://finnhub.io/api/v1',
    authType:    'query',
    authParam:   'token',
    envKey:      'FINNHUB_KEY',
    get apiKey() { return env('FINNHUB_KEY', env('VITE_FINNHUB_KEY')) },
    rateLimits:  { perMinute: 60, perDay: Infinity },
    timeout:     5_000,
    retries:     2,
    fallback:    'yahoo_finance',
    supports:    ['realtime_quote', 'OHLCV', 'news', 'sentiment', 'fundamentals'],
    exchanges:   ['NSE', 'BSE', 'NYSE', 'NASDAQ', 'CRYPTO'],
    cost:        'free_60_per_min',
    docs:        'https://finnhub.io/docs/api',
    signup:      'https://finnhub.io',
  },

  // ── Zerodha Kite Connect (real-time NSE/BSE WebSocket) ────────────────────
  zerodha: {
    id:          'zerodha',
    name:        'Zerodha Kite Connect',
    category:    'market_data',
    enabled:     envBool('ZERODHA_ENABLED', !!(env('ZERODHA_API_KEY') || env('VITE_ZERODHA_API_KEY'))),
    baseUrl:     'https://api.kite.trade',
    wsUrl:       'wss://ws.kite.trade',
    authType:    'header',
    authHeader:  'Authorization',
    envKey:      'ZERODHA_ACCESS_TOKEN',
    get apiKey() { return env('ZERODHA_ACCESS_TOKEN') },
    get loginUrl() {
      const k = env('ZERODHA_API_KEY', env('VITE_ZERODHA_API_KEY'))
      return `https://kite.zerodha.com/connect/login?api_key=${k}`
    },
    rateLimits:  { perMinute: 600, perDay: Infinity },
    timeout:     5_000,
    retries:     3,
    fallback:    'yahoo_finance',
    supports:    ['realtime_ws', 'OHLCV', 'options_chain', 'margin'],
    exchanges:   ['NSE', 'BSE', 'NFO', 'CDS', 'MCX'],
    cost:        '₹2000/month developer subscription',
    docs:        'https://kite.trade/docs/connect/v3/',
    signup:      'https://developers.kite.trade',
    notes:       'Access token expires at 6:00 AM IST daily. Requires OAuth login flow.',
  },

  // ── Binance WebSocket (crypto — always free) ──────────────────────────────
  binance: {
    id:          'binance',
    name:        'Binance WebSocket',
    category:    'market_data',
    enabled:     envBool('VITE_BINANCE_WS_ENABLED', true),
    baseUrl:     'https://api.binance.com',
    wsUrl:       'wss://stream.binance.com:9443',
    authType:    'none',  // public streams need no auth
    envKey:      null,
    rateLimits:  { perMinute: 1200, wsStreams: 1024 },
    timeout:     5_000,
    retries:     3,
    fallback:    'yahoo_finance',
    supports:    ['realtime_ws', 'OHLCV', 'orderbook', 'trades'],
    exchanges:   ['BINANCE', 'CRYPTO'],
    cost:        'free',
    docs:        'https://binance-docs.github.io/apidocs/spot/en/',
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// MACRO / ECONOMIC DATA
// ═══════════════════════════════════════════════════════════════════════════════

export const MACRO_DATA = {

  // ── FRED — Federal Reserve Economic Data ─────────────────────────────────
  fred: {
    id:          'fred',
    name:        'FRED (Federal Reserve)',
    category:    'macro',
    enabled:     envBool('FRED_ENABLED', !!env('FRED_API_KEY')),
    baseUrl:     'https://api.stlouisfed.org/fred',
    authType:    'query',
    authParam:   'api_key',
    envKey:      'FRED_API_KEY',
    get apiKey() { return env('FRED_API_KEY') },
    rateLimits:  { perDay: Infinity, perMinute: 120 },
    timeout:     10_000,
    retries:     2,
    supports:    ['GDP', 'inflation', 'interest_rates', 'employment', 'economic_calendar'],
    cost:        'free',
    docs:        'https://fred.stlouisfed.org/docs/api/',
    signup:      'https://fred.stlouisfed.org/docs/api/api_key.html',
    series: {
      fed_rate:    'FEDFUNDS',
      cpi:         'CPIAUCSL',
      gdp:         'GDP',
      unemployment:'UNRATE',
      vix:         'VIXCLS',
    },
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEWS & SENTIMENT
// ═══════════════════════════════════════════════════════════════════════════════

export const NEWS_SOURCES = {

  // ── NewsAPI (free 100 req/day) ────────────────────────────────────────────
  newsapi: {
    id:          'newsapi',
    name:        'NewsAPI',
    category:    'news',
    enabled:     envBool('NEWSAPI_ENABLED', !!env('NEWSAPI_KEY')),
    baseUrl:     'https://newsapi.org/v2',
    authType:    'header',
    authHeader:  'X-Api-Key',
    envKey:      'NEWSAPI_KEY',
    get apiKey() { return env('NEWSAPI_KEY') },
    rateLimits:  { perDay: 100, perHour: Infinity },
    timeout:     8_000,
    retries:     1,
    supports:    ['headlines', 'everything', 'sources'],
    cost:        'free_100_per_day',
    docs:        'https://newsapi.org/docs',
    signup:      'https://newsapi.org/register',
  },

  // ── Polygon.io News (free tier) ───────────────────────────────────────────
  polygon: {
    id:          'polygon',
    name:        'Polygon.io',
    category:    'news',
    enabled:     envBool('POLYGON_ENABLED', !!env('POLYGON_API_KEY')),
    baseUrl:     'https://api.polygon.io',
    authType:    'query',
    authParam:   'apiKey',
    envKey:      'POLYGON_API_KEY',
    get apiKey() { return env('POLYGON_API_KEY') },
    rateLimits:  { perMinute: 5 },  // free tier
    timeout:     8_000,
    retries:     1,
    supports:    ['news', 'OHLCV', 'options', 'fundamentals'],
    cost:        'free_5_per_min',
    docs:        'https://polygon.io/docs',
    signup:      'https://polygon.io/dashboard/signup',
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI / LLM PROVIDERS
// ═══════════════════════════════════════════════════════════════════════════════

export const AI_PROVIDERS = {

  openai: {
    id:          'openai',
    name:        'OpenAI',
    category:    'llm',
    enabled:     envBool('OPENAI_ENABLED', !!env('OPENAI_API_KEY')),
    baseUrl:     'https://api.openai.com/v1',
    authType:    'bearer',
    envKey:      'OPENAI_API_KEY',
    get apiKey() { return env('OPENAI_API_KEY') },
    defaultModel:'gpt-4o-mini',
    visionModel: 'gpt-4o',
    rateLimits:  { perMinute: 500, perDay: Infinity },
    timeout:     30_000,
    retries:     2,
    cost:        '$0.15/1M input, $0.60/1M output tokens',
    docs:        'https://platform.openai.com/docs',
    signup:      'https://platform.openai.com/api-keys',
  },

  anthropic: {
    id:          'anthropic',
    name:        'Anthropic Claude',
    category:    'llm',
    enabled:     envBool('ANTHROPIC_ENABLED', !!env('ANTHROPIC_API_KEY')),
    baseUrl:     'https://api.anthropic.com/v1',
    authType:    'header',
    authHeader:  'x-api-key',
    envKey:      'ANTHROPIC_API_KEY',
    get apiKey() { return env('ANTHROPIC_API_KEY') },
    defaultModel:'claude-3-5-haiku-20241022',
    visionModel: 'claude-3-5-sonnet-20241022',
    rateLimits:  { perMinute: 50, perDay: Infinity },
    timeout:     30_000,
    retries:     2,
    cost:        '$0.25/1M input, $1.25/1M output tokens',
    docs:        'https://docs.anthropic.com',
    signup:      'https://console.anthropic.com',
  },

  gemini: {
    id:          'gemini',
    name:        'Google Gemini',
    category:    'llm',
    enabled:     envBool('GEMINI_ENABLED', !!(env('GEMINI_API_KEY') || env('GOOGLE_API_KEY'))),
    baseUrl:     'https://generativelanguage.googleapis.com/v1beta',
    authType:    'query',
    authParam:   'key',
    envKey:      'GEMINI_API_KEY',
    get apiKey() { return env('GEMINI_API_KEY', env('GOOGLE_API_KEY')) },
    defaultModel:'gemini-1.5-flash',
    visionModel: 'gemini-1.5-flash',
    rateLimits:  { perMinute: 15, perDay: 1500 },  // free tier
    timeout:     30_000,
    retries:     2,
    cost:        'Free tier: 15 RPM / 1500 RPD',
    docs:        'https://ai.google.dev/docs',
    signup:      'https://aistudio.google.com/app/apikey',
  },

  groq: {
    id:          'groq',
    name:        'Groq',
    category:    'llm',
    enabled:     envBool('GROQ_ENABLED', !!env('GROQ_API_KEY')),
    baseUrl:     'https://api.groq.com/openai/v1',
    authType:    'bearer',
    envKey:      'GROQ_API_KEY',
    get apiKey() { return env('GROQ_API_KEY') },
    defaultModel:'llama-3.3-70b-versatile',
    rateLimits:  { perMinute: 30, perDay: 14400 },
    timeout:     15_000,
    retries:     2,
    cost:        'Free tier: 30 RPM / 14400 RPD',
    docs:        'https://console.groq.com/docs',
    signup:      'https://console.groq.com/keys',
  },

  deepseek: {
    id:          'deepseek',
    name:        'DeepSeek',
    category:    'llm',
    enabled:     envBool('DEEPSEEK_ENABLED', !!env('DEEPSEEK_API_KEY')),
    baseUrl:     'https://api.deepseek.com/v1',
    authType:    'bearer',
    envKey:      'DEEPSEEK_API_KEY',
    get apiKey() { return env('DEEPSEEK_API_KEY') },
    defaultModel:'deepseek-chat',
    rateLimits:  { perMinute: 60 },
    timeout:     30_000,
    retries:     2,
    cost:        '~$0.07/1M tokens (very cheap)',
    docs:        'https://platform.deepseek.com/docs',
    signup:      'https://platform.deepseek.com',
  },

  ollama: {
    id:          'ollama',
    name:        'Ollama (Local)',
    category:    'llm',
    enabled:     envBool('OLLAMA_ENABLED', false),
    baseUrl:     env('OLLAMA_BASE_URL', 'http://localhost:11434/v1'),
    authType:    'none',
    envKey:      null,
    get apiKey() { return '' },
    defaultModel: env('OLLAMA_DEFAULT_MODEL', 'llama3.2'),
    rateLimits:  { perMinute: Infinity },
    timeout:     60_000,
    retries:     1,
    cost:        'Free — runs locally',
    docs:        'https://ollama.com',
    notes:       'Requires Ollama installed and running: ollama serve',
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMAGE / WALLPAPER APIs
// ═══════════════════════════════════════════════════════════════════════════════

export const IMAGE_SOURCES = {

  unsplash: {
    id:          'unsplash',
    name:        'Unsplash',
    category:    'images',
    enabled:     envBool('UNSPLASH_ENABLED', !!env('UNSPLASH_API_KEY')),
    baseUrl:     'https://api.unsplash.com',
    authType:    'header',
    authHeader:  'Authorization',
    authPrefix:  'Client-ID ',
    envKey:      'UNSPLASH_API_KEY',
    get apiKey() { return env('UNSPLASH_API_KEY') },
    rateLimits:  { perHour: 50, perDay: Infinity },
    timeout:     10_000,
    retries:     1,
    cost:        'Free 50 req/hour',
    docs:        'https://unsplash.com/documentation',
    signup:      'https://unsplash.com/developers',
  },

  pexels: {
    id:          'pexels',
    name:        'Pexels',
    category:    'images',
    enabled:     envBool('PEXELS_ENABLED', !!env('PEXELS_API_KEY')),
    baseUrl:     'https://api.pexels.com/v1',
    authType:    'header',
    authHeader:  'Authorization',
    authPrefix:  '',
    envKey:      'PEXELS_API_KEY',
    get apiKey() { return env('PEXELS_API_KEY') },
    rateLimits:  { perHour: 200, perDay: Infinity },
    timeout:     10_000,
    retries:     1,
    cost:        'Free 200 req/hour',
    docs:        'https://www.pexels.com/api/documentation/',
    signup:      'https://www.pexels.com/api/',
  },

  pixabay: {
    id:          'pixabay',
    name:        'Pixabay',
    category:    'images',
    enabled:     envBool('PIXABAY_ENABLED', !!env('PIXABAY_API_KEY')),
    baseUrl:     'https://pixabay.com/api',
    authType:    'query',
    authParam:   'key',
    envKey:      'PIXABAY_API_KEY',
    get apiKey() { return env('PIXABAY_API_KEY') },
    rateLimits:  { perMinute: 100, perHour: Infinity },
    timeout:     10_000,
    retries:     1,
    cost:        'Free 100 req/min',
    docs:        'https://pixabay.com/api/docs/',
    signup:      'https://pixabay.com/api/docs/',
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

const ALL_INTEGRATIONS = {
  ...MARKET_DATA, ...MACRO_DATA, ...NEWS_SOURCES, ...AI_PROVIDERS, ...IMAGE_SOURCES,
}

/**
 * Get the first enabled integration for a category.
 * Priority order is defined by the object key order within each category.
 */
export function getActive(category) {
  for (const cfg of Object.values(ALL_INTEGRATIONS)) {
    if (cfg.category === category && cfg.enabled) return cfg
  }
  return null
}

/**
 * Get all enabled integrations for a category.
 */
export function getAll(category) {
  return Object.values(ALL_INTEGRATIONS).filter(c => c.category === category && c.enabled)
}

/**
 * Get a specific integration by ID (enabled or not).
 */
export function get(id) {
  return ALL_INTEGRATIONS[id] ?? null
}

/**
 * Build the auth header/param for an integration.
 * Returns: { headers: {}, params: {} }
 */
export function buildAuth(cfg) {
  if (!cfg || !cfg.apiKey || cfg.authType === 'none') return { headers: {}, params: {} }
  switch (cfg.authType) {
    case 'bearer': return { headers: { 'Authorization': `Bearer ${cfg.apiKey}` }, params: {} }
    case 'header': return { headers: { [cfg.authHeader]: `${cfg.authPrefix ?? ''}${cfg.apiKey}` }, params: {} }
    case 'query':  return { headers: {}, params: { [cfg.authParam]: cfg.apiKey } }
    default:       return { headers: {}, params: {} }
  }
}

/**
 * Build a full URL with auth params appended.
 */
export function buildUrl(cfg, path, extraParams = {}) {
  const url    = new URL(path.startsWith('http') ? path : `${cfg.baseUrl}${path}`)
  const auth   = buildAuth(cfg)
  for (const [k, v] of Object.entries({ ...auth.params, ...extraParams })) {
    url.searchParams.set(k, v)
  }
  return url.toString()
}

/**
 * Status summary of all integrations — used for health endpoint.
 */
export function getIntegrationStatus() {
  return Object.entries(ALL_INTEGRATIONS).map(([id, cfg]) => ({
    id,
    name:      cfg.name,
    category:  cfg.category,
    enabled:   cfg.enabled,
    hasKey:    cfg.envKey ? !!env(cfg.envKey) : true,
    cost:      cfg.cost ?? 'unknown',
    rateLimits: cfg.rateLimits,
  }))
}

export default {
  MARKET_DATA, MACRO_DATA, NEWS_SOURCES, AI_PROVIDERS, IMAGE_SOURCES,
  getActive, getAll, get, buildAuth, buildUrl, getIntegrationStatus,
}
