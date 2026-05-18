/**
 * historicalDataService.js — multi-source historical market data aggregator.
 *
 * Free data sources used:
 *   1. Yahoo Finance v8  — up to 5 years daily OHLCV (already used in app)
 *   2. Alpha Vantage     — intraday + daily (free tier: 25 req/day, requires API key)
 *   3. Stooq            — global indices, US stocks, no key required
 *   4. FRED             — macro data (GDP, inflation, interest rates), free
 *   5. Yahoo Finance    — fundamentals (P/E, EPS, revenue) via summary endpoint
 *
 * All functions return normalised data structures regardless of source.
 * Source selection is automatic with fallback chain.
 */

import { sanitizeTicker } from '../utils/sanitize.js'

const YAHOO_BASE  = 'https://query1.finance.yahoo.com'
const STOOQ_BASE  = 'https://stooq.com/q/d/l'
const FRED_BASE   = 'https://api.stlouisfed.org/fred'
const AV_BASE     = 'https://www.alphavantage.co/query'

const DEFAULT_TIMEOUT_MS = 15_000

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchJSON(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'StockMindAI/1.0' },
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
    return await res.json()
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

async function fetchText(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'StockMindAI/1.0' },
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
    return await res.text()
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function toUnixTimestamp(dateStr) {
  return Math.floor(new Date(dateStr).getTime() / 1000)
}

function formatDate(date) {
  return date.toISOString().split('T')[0]
}

function defaultFromDate(days = 365) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return formatDate(d)
}

// ── Yahoo Finance OHLCV ───────────────────────────────────────────────────────

async function fetchYahooOHLCV(symbol, interval, fromDate, toDate) {
  const period1 = toUnixTimestamp(fromDate)
  const period2 = toUnixTimestamp(toDate)

  // Map interval to Yahoo Finance interval codes
  const intervalMap = {
    '1d': '1d', '1wk': '1wk', '1mo': '1mo',
    '1h': '1h', '30m': '30m', '15m': '15m', '5m': '5m',
    'daily': '1d', 'weekly': '1wk', 'monthly': '1mo',
  }
  const yInterval = intervalMap[interval] ?? '1d'

  const url = `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=${yInterval}&includePrePost=false`
  const data = await fetchJSON(url)

  const result = data?.chart?.result?.[0]
  if (!result) throw new Error('No data from Yahoo Finance')

  const timestamps = result.timestamps ?? result.timestamp ?? []
  const quote      = result.indicators?.quote?.[0] ?? {}
  const adjClose   = result.indicators?.adjclose?.[0]?.adjclose ?? []

  return timestamps.map((ts, i) => ({
    date:   new Date(ts * 1000).toISOString().split('T')[0],
    open:   quote.open?.[i]   ?? null,
    high:   quote.high?.[i]   ?? null,
    low:    quote.low?.[i]    ?? null,
    close:  quote.close?.[i]  ?? null,
    volume: quote.volume?.[i] ?? null,
    adjClose: adjClose[i]     ?? null,
  })).filter(r => r.close !== null)
}

// ── Stooq OHLCV ──────────────────────────────────────────────────────────────

async function fetchStooqOHLCV(symbol, fromDate, toDate) {
  // Stooq uses CSV format
  const url = `${STOOQ_BASE}/?s=${encodeURIComponent(symbol.toLowerCase())}&d1=${fromDate.replace(/-/g, '')}&d2=${toDate.replace(/-/g, '')}&i=d`
  const csv = await fetchText(url)

  const lines = csv.trim().split('\n')
  if (lines.length < 2) throw new Error('No data from Stooq')

  // Header: Date,Open,High,Low,Close,Volume
  return lines.slice(1).map(line => {
    const [date, open, high, low, close, volume] = line.split(',')
    return {
      date:   date?.trim() ?? '',
      open:   parseFloat(open)   || null,
      high:   parseFloat(high)   || null,
      low:    parseFloat(low)    || null,
      close:  parseFloat(close)  || null,
      volume: parseFloat(volume) || null,
      adjClose: parseFloat(close) || null,
    }
  }).filter(r => r.date && r.close !== null)
}

// ── Alpha Vantage OHLCV ───────────────────────────────────────────────────────

async function fetchAlphaVantageOHLCV(symbol, interval, fromDate, toDate, apiKey) {
  if (!apiKey) throw new Error('Alpha Vantage API key not configured')

  const isIntraday = ['1m','5m','15m','30m','60m','1h'].includes(interval)
  const avInterval = isIntraday ? (interval === '1h' ? '60min' : interval.replace('m', 'min')) : null

  let url
  if (isIntraday && avInterval) {
    url = `${AV_BASE}?function=TIME_SERIES_INTRADAY&symbol=${encodeURIComponent(symbol)}&interval=${avInterval}&outputsize=full&apikey=${apiKey}`
  } else {
    url = `${AV_BASE}?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(symbol)}&outputsize=full&apikey=${apiKey}`
  }

  const data = await fetchJSON(url)

  if (data['Note'] || data['Information']) {
    throw new Error('Alpha Vantage rate limit reached')
  }

  const seriesKey = Object.keys(data).find(k => k.includes('Time Series'))
  if (!seriesKey) throw new Error('No time series data from Alpha Vantage')

  const series = data[seriesKey]
  const from   = new Date(fromDate)
  const to     = new Date(toDate)

  return Object.entries(series)
    .filter(([date]) => {
      const d = new Date(date.split(' ')[0])
      return d >= from && d <= to
    })
    .map(([date, vals]) => ({
      date:     date.split(' ')[0],
      open:     parseFloat(vals['1. open'])             || null,
      high:     parseFloat(vals['2. high'])             || null,
      low:      parseFloat(vals['3. low'])              || null,
      close:    parseFloat(vals['4. close'])            || null,
      volume:   parseFloat(vals['5. volume'] ?? vals['6. volume']) || null,
      adjClose: parseFloat(vals['5. adjusted close'])  || null,
    }))
    .filter(r => r.close !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch historical OHLCV data for a symbol.
 * Tries Yahoo Finance first, falls back to Stooq, then Alpha Vantage.
 *
 * @param {string} symbol    — ticker symbol (e.g. 'AAPL', '^NSEI', 'RELIANCE.NS')
 * @param {string} exchange  — exchange hint (e.g. 'NSE', 'NYSE') — used for symbol formatting
 * @param {string} interval  — '1d' | '1wk' | '1mo' | '1h' | '30m' | '15m' | '5m'
 * @param {string} fromDate  — ISO date string (e.g. '2023-01-01')
 * @param {string} toDate    — ISO date string (e.g. '2024-01-01')
 * @returns {Promise<{ symbol, interval, fromDate, toDate, data: Array, source: string }>}
 */
export async function fetchHistoricalOHLCV(symbol, exchange = 'NSE', interval = '1d', fromDate, toDate) {
  const cleanSymbol = sanitizeTicker(symbol)
  if (!cleanSymbol) throw new Error('Invalid symbol')

  const from = fromDate ?? defaultFromDate(365)
  const to   = toDate   ?? formatDate(new Date())

  // Format symbol for Yahoo Finance based on exchange
  let yahooSymbol = cleanSymbol
  if (exchange === 'NSE' && !cleanSymbol.includes('.')) {
    yahooSymbol = `${cleanSymbol}.NS`
  } else if (exchange === 'BSE' && !cleanSymbol.includes('.')) {
    yahooSymbol = `${cleanSymbol}.BO`
  }

  const errors = []

  // 1. Try Yahoo Finance
  try {
    const data = await fetchYahooOHLCV(yahooSymbol, interval, from, to)
    if (data.length > 0) {
      return { symbol: cleanSymbol, interval, fromDate: from, toDate: to, data, source: 'yahoo' }
    }
  } catch (e) {
    errors.push(`Yahoo: ${e.message}`)
  }

  // 2. Try Stooq (daily only)
  if (['1d', 'daily'].includes(interval)) {
    try {
      const stooqSymbol = exchange === 'NSE' ? `${cleanSymbol}.in` : cleanSymbol
      const data = await fetchStooqOHLCV(stooqSymbol, from, to)
      if (data.length > 0) {
        return { symbol: cleanSymbol, interval, fromDate: from, toDate: to, data, source: 'stooq' }
      }
    } catch (e) {
      errors.push(`Stooq: ${e.message}`)
    }
  }

  // 3. Try Alpha Vantage (if key configured)
  const avKey = process.env.ALPHA_VANTAGE_KEY
  if (avKey) {
    try {
      const data = await fetchAlphaVantageOHLCV(cleanSymbol, interval, from, to, avKey)
      if (data.length > 0) {
        return { symbol: cleanSymbol, interval, fromDate: from, toDate: to, data, source: 'alphavantage' }
      }
    } catch (e) {
      errors.push(`AlphaVantage: ${e.message}`)
    }
  }

  throw new Error(`No historical data available. Errors: ${errors.join('; ')}`)
}

/**
 * Fetch macroeconomic data from FRED (Federal Reserve Economic Data).
 *
 * Common indicators:
 *   GDP        — Gross Domestic Product
 *   CPIAUCSL   — Consumer Price Index (inflation)
 *   FEDFUNDS   — Federal Funds Rate
 *   UNRATE     — Unemployment Rate
 *   DGS10      — 10-Year Treasury Yield
 *   M2SL       — M2 Money Supply
 *
 * @param {string} indicator — FRED series ID
 * @returns {Promise<{ indicator, data: Array<{date, value}>, source: string }>}
 */
export async function fetchMacroData(indicator) {
  if (!indicator || typeof indicator !== 'string') throw new Error('indicator required')
  const cleanIndicator = indicator.replace(/[^A-Z0-9]/gi, '').toUpperCase()

  const fredKey = process.env.FRED_API_KEY
  if (!fredKey) {
    throw new Error('FRED_API_KEY not configured. Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html')
  }

  const url = `${FRED_BASE}/series/observations?series_id=${cleanIndicator}&api_key=${fredKey}&file_type=json&sort_order=asc&observation_start=2000-01-01`
  const data = await fetchJSON(url)

  if (!data.observations) throw new Error('No FRED data returned')

  const observations = data.observations
    .filter(o => o.value !== '.')
    .map(o => ({
      date:  o.date,
      value: parseFloat(o.value),
    }))

  return { indicator: cleanIndicator, data: observations, source: 'fred' }
}

/**
 * Fetch fundamental data for a stock symbol.
 * Uses Yahoo Finance summary endpoint.
 *
 * @param {string} symbol
 * @returns {Promise<{ symbol, pe, eps, revenue, marketCap, dividendYield, beta, source: string }>}
 */
export async function fetchFundamentals(symbol) {
  const cleanSymbol = sanitizeTicker(symbol)
  if (!cleanSymbol) throw new Error('Invalid symbol')

  const url = `${YAHOO_BASE}/v10/finance/quoteSummary/${encodeURIComponent(cleanSymbol)}?modules=summaryDetail,defaultKeyStatistics,financialData,incomeStatementHistory`
  const data = await fetchJSON(url)

  const result = data?.quoteSummary?.result?.[0]
  if (!result) throw new Error('No fundamentals data from Yahoo Finance')

  const summary  = result.summaryDetail ?? {}
  const keyStats = result.defaultKeyStatistics ?? {}
  const finData  = result.financialData ?? {}

  return {
    symbol:        cleanSymbol,
    pe:            summary.trailingPE?.raw            ?? null,
    forwardPE:     summary.forwardPE?.raw             ?? null,
    eps:           keyStats.trailingEps?.raw          ?? null,
    revenue:       finData.totalRevenue?.raw          ?? null,
    revenueGrowth: finData.revenueGrowth?.raw         ?? null,
    grossMargin:   finData.grossMargins?.raw          ?? null,
    marketCap:     summary.marketCap?.raw             ?? null,
    dividendYield: summary.dividendYield?.raw         ?? null,
    beta:          summary.beta?.raw                  ?? null,
    priceToBook:   keyStats.priceToBook?.raw          ?? null,
    debtToEquity:  finData.debtToEquity?.raw          ?? null,
    returnOnEquity: finData.returnOnEquity?.raw       ?? null,
    source:        'yahoo',
  }
}

/**
 * Fetch earnings calendar for a symbol.
 * Uses Yahoo Finance earnings endpoint.
 *
 * @param {string} symbol
 * @returns {Promise<{ symbol, earnings: Array, source: string }>}
 */
export async function fetchEarningsCalendar(symbol) {
  const cleanSymbol = sanitizeTicker(symbol)
  if (!cleanSymbol) throw new Error('Invalid symbol')

  const url = `${YAHOO_BASE}/v10/finance/quoteSummary/${encodeURIComponent(cleanSymbol)}?modules=earningsHistory,earningsTrend,calendarEvents`
  const data = await fetchJSON(url)

  const result = data?.quoteSummary?.result?.[0]
  if (!result) throw new Error('No earnings data from Yahoo Finance')

  const history = result.earningsHistory?.history ?? []
  const calendar = result.calendarEvents?.earnings ?? {}

  const historicalEarnings = history.map(e => ({
    date:          e.quarter?.fmt ?? null,
    epsActual:     e.epsActual?.raw    ?? null,
    epsEstimate:   e.epsEstimate?.raw  ?? null,
    epsDiff:       e.epsDifference?.raw ?? null,
    surprisePct:   e.surprisePercent?.raw ?? null,
  }))

  const nextEarnings = {
    earningsDate:  calendar.earningsDate?.[0]?.fmt ?? null,
    epsEstimate:   calendar.epsAverage?.raw ?? null,
    revenueEstimate: calendar.revenueAverage?.raw ?? null,
  }

  return {
    symbol:   cleanSymbol,
    next:     nextEarnings,
    history:  historicalEarnings,
    source:   'yahoo',
  }
}

/**
 * Fetch dividend history for a symbol.
 * Uses Yahoo Finance chart endpoint with events=dividends.
 *
 * @param {string} symbol
 * @returns {Promise<{ symbol, dividends: Array<{date, amount}>, source: string }>}
 */
export async function fetchDividendHistory(symbol) {
  const cleanSymbol = sanitizeTicker(symbol)
  if (!cleanSymbol) throw new Error('Invalid symbol')

  const period1 = toUnixTimestamp('2010-01-01')
  const period2 = Math.floor(Date.now() / 1000)

  const url = `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(cleanSymbol)}?period1=${period1}&period2=${period2}&interval=1d&events=dividends`
  const data = await fetchJSON(url)

  const result = data?.chart?.result?.[0]
  if (!result) throw new Error('No dividend data from Yahoo Finance')

  const dividendEvents = result.events?.dividends ?? {}
  const dividends = Object.values(dividendEvents)
    .map(d => ({
      date:   new Date(d.date * 1000).toISOString().split('T')[0],
      amount: d.amount ?? null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return { symbol: cleanSymbol, dividends, source: 'yahoo' }
}
