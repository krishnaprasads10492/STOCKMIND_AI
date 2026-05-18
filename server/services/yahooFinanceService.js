/**
 * yahooFinanceService.js — Multi-source market data service.
 *
 * Source priority (auto-fallback):
 *   1. Yahoo Finance v8 chart API  — free, no key, less rate-limited
 *   2. yahoo-finance2 library      — fallback
 *   3. Stale cache                 — returns last known value on failure
 *
 * Cache: 15s TTL for quotes, 5min TTL for OHLCV history.
 */

import yahooFinance from 'yahoo-finance2'

yahooFinance.suppressNotices(['yahooSurvey'])

// ── Symbol mapping ────────────────────────────────────────────────────────────

const SYMBOL_MAP = {
  'NIFTY50':    '^NSEI',    'BANKNIFTY':  '^NSEBANK',  'SENSEX':     '^BSESN',
  'NIFTYIT':    '^CNXIT',   'FINNIFTY':   'NIFTY_FIN_SERVICE.NS',
  'NIFTYMID':   '^NSMIDCP', 'NIFTYNXT50': '^NSMIDCP',
  'NIFTY':      '^NSEI',    'MIDCPNIFTY': '^NSMIDCP',
  'BTCUSDT':    'BTC-USD',  'ETHUSDT':    'ETH-USD',   'BNBUSDT':    'BNB-USD',
  'SOLUSDT':    'SOL-USD',  'XRPUSDT':    'XRP-USD',   'ADAUSDT':    'ADA-USD',
  'DOGEUSDT':   'DOGE-USD', 'AVAXUSDT':   'AVAX-USD',  'DOTUSDT':    'DOT-USD',
  'MATICUSDT':  'MATIC-USD',
  'USDINR':     'INR=X',    'EURUSD':     'EURUSD=X',  'GBPUSD':     'GBPUSD=X',
  'USDJPY':     'JPY=X',    'AUDUSD':     'AUDUSD=X',  'USDCHF':     'CHF=X',
  'EURINR':     'EURINR=X',
  'SPX':        '^GSPC',    'NDX':        '^NDX',       'DJI':        '^DJI',
  'FTSE':       '^FTSE',    'DAX':        '^GDAXI',     'N225':       '^N225',
  'HSI':        '^HSI',
  'GOLD':       'GC=F',     'SILVER':     'SI=F',       'CRUDEOIL':   'CL=F',
  'NATURALGAS': 'NG=F',     'COPPER':     'HG=F',       'ALUMINIUM':  'ALI=F',
}

export function toYahooSymbol(symbol, exchange = 'NSE') {
  if (SYMBOL_MAP[symbol]) return SYMBOL_MAP[symbol]
  if (exchange === 'BSE') return `${symbol}.BO`
  return `${symbol}.NS`
}

// ── Cache ─────────────────────────────────────────────────────────────────────

const quoteCache = new Map()
const ohlcvCache = new Map()
const QUOTE_TTL  = 15_000   // 15s
const OHLCV_TTL  = 300_000  // 5 min

function getCached(map, key, ttl) {
  const e = map.get(key)
  if (e && Date.now() - e.ts < ttl) return e.data
  return null
}

function setCache(map, key, data) {
  map.set(key, { data, ts: Date.now() })
  if (map.size > 500) {
    const oldest = [...map.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]
    map.delete(oldest[0])
  }
}

function getStale(map, key) {
  return map.get(key)?.data ?? null
}

// ── Source 1: Yahoo Finance v8 chart API ──────────────────────────────────────

async function fetchFromYahooV8(yahooSym, symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=1d`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(6_000),
    })
    if (!res.ok) return null
    const json = await res.json()
    const meta = json?.chart?.result?.[0]?.meta
    if (!meta?.regularMarketPrice) return null

    const price = meta.regularMarketPrice
    const prev  = meta.previousClose ?? meta.chartPreviousClose ?? price
    return {
      symbol,
      price,
      change:      price - prev,
      changePct:   ((price - prev) / prev) * 100,
      open:        meta.regularMarketOpen ?? price,
      high:        meta.regularMarketDayHigh ?? price,
      low:         meta.regularMarketDayLow ?? price,
      close:       prev,
      volume:      meta.regularMarketVolume ?? 0,
      week52High:  meta.fiftyTwoWeekHigh ?? null,
      week52Low:   meta.fiftyTwoWeekLow  ?? null,
      companyName: meta.longName ?? meta.shortName ?? symbol,
      exchange:    meta.exchangeName ?? null,
      currency:    meta.currency ?? 'INR',
      marketState: meta.marketState ?? 'CLOSED',
      source:      'yahoo',
      live:        meta.marketState === 'REGULAR',
      ts:          Date.now(),
    }
  } catch {
    return null
  }
}

// ── Source 2: yahoo-finance2 library ─────────────────────────────────────────

async function fetchFromYahooLib(yahooSym, symbol) {
  try {
    const q = await yahooFinance.quote(yahooSym, {}, { validateResult: false })
    if (!q?.regularMarketPrice) return null
    const price = q.regularMarketPrice
    const prev  = q.regularMarketPreviousClose ?? price
    return {
      symbol,
      price,
      change:       q.regularMarketChange       ?? (price - prev),
      changePct:    q.regularMarketChangePercent ?? ((price - prev) / prev * 100),
      open:         q.regularMarketOpen         ?? price,
      high:         q.regularMarketDayHigh      ?? price,
      low:          q.regularMarketDayLow       ?? price,
      close:        prev,
      volume:       q.regularMarketVolume       ?? 0,
      week52High:   q.fiftyTwoWeekHigh          ?? null,
      week52Low:    q.fiftyTwoWeekLow           ?? null,
      marketCap:    q.marketCap                 ?? null,
      pe:           q.trailingPE                ?? null,
      eps:          q.epsTrailingTwelveMonths   ?? null,
      dividendYield: q.dividendYield            ?? null,
      sector:       q.sector                    ?? null,
      industry:     q.industry                  ?? null,
      companyName:  q.longName ?? q.shortName   ?? symbol,
      exchange:     q.exchange                  ?? null,
      currency:     q.currency                  ?? 'INR',
      marketState:  q.marketState               ?? 'CLOSED',
      source:       'yahoo',
      live:         q.marketState === 'REGULAR',
      ts:           Date.now(),
    }
  } catch {
    return null
  }
}

// ── Public: single quote ──────────────────────────────────────────────────────

export async function fetchQuote(symbol, exchange = 'NSE') {
  const yahooSym = toYahooSymbol(symbol, exchange)
  const cacheKey = `${yahooSym}:${exchange}`

  const cached = getCached(quoteCache, cacheKey, QUOTE_TTL)
  if (cached) return cached

  let tick = await fetchFromYahooV8(yahooSym, symbol)
  if (!tick) tick = await fetchFromYahooLib(yahooSym, symbol)

  if (tick) {
    setCache(quoteCache, cacheKey, tick)
    return tick
  }

  const stale = getStale(quoteCache, cacheKey)
  if (stale) {
    console.info(`[Market] Using stale cache for ${symbol}`)
    return { ...stale, stale: true }
  }

  console.warn(`[Market] No data available for ${symbol} (${yahooSym})`)
  return null
}

// ── Public: batch quotes ──────────────────────────────────────────────────────

export async function batchFetchQuotes(items) {
  const result = new Map()
  for (const { symbol, exchange } of items) {
    const tick = await fetchQuote(symbol, exchange ?? 'NSE')
    if (tick) result.set(symbol, tick)
    if (items.length > 1) await new Promise(r => setTimeout(r, 300))
  }
  return result
}

// ── Public: OHLCV history ─────────────────────────────────────────────────────
/**
 * Fetch daily OHLCV bars for a symbol.
 * @param {string} symbol
 * @param {string} exchange
 * @param {number} bars  — number of trading days (default 250 = ~1 year)
 * @returns {Array<{date,open,high,low,close,volume}>|null}
 */
export async function fetchOHLCV(symbol, exchange = 'NSE', bars = 250) {
  const yahooSym = toYahooSymbol(symbol, exchange)
  const cacheKey = `ohlcv:${yahooSym}:${bars}`

  const cached = getCached(ohlcvCache, cacheKey, OHLCV_TTL)
  if (cached) return cached

  // Try v8 chart API with longer range
  try {
    const range = bars <= 60 ? '3mo' : bars <= 130 ? '6mo' : bars <= 260 ? '1y' : bars <= 780 ? '3y' : '5y'
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=${range}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) {
      const json = await res.json()
      const result = json?.chart?.result?.[0]
      if (result) {
        const timestamps = result.timestamp ?? []
        const q = result.indicators?.quote?.[0] ?? {}
        const adjClose = result.indicators?.adjclose?.[0]?.adjclose ?? q.close

        const ohlcv = timestamps.map((ts, i) => ({
          date:   new Date(ts * 1000).toISOString().slice(0, 10),
          open:   q.open?.[i]   ?? null,
          high:   q.high?.[i]   ?? null,
          low:    q.low?.[i]    ?? null,
          close:  adjClose?.[i] ?? q.close?.[i] ?? null,
          volume: q.volume?.[i] ?? 0,
        })).filter(r => r.close != null).slice(-bars)

        if (ohlcv.length >= 20) {
          setCache(ohlcvCache, cacheKey, ohlcv)
          return ohlcv
        }
      }
    }
  } catch (e) {
    console.warn(`[Market] OHLCV v8 failed for ${symbol}: ${e.message}`)
  }

  // Fallback: yahoo-finance2 historical
  try {
    const endDate   = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - Math.ceil(bars * 1.5))  // extra buffer for weekends

    const hist = await yahooFinance.historical(yahooSym, {
      period1: startDate.toISOString().slice(0, 10),
      period2: endDate.toISOString().slice(0, 10),
      interval: '1d',
    }, { validateResult: false })

    if (hist?.length >= 20) {
      const ohlcv = hist.slice(-bars).map(r => ({
        date:   r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
        open:   r.open,
        high:   r.high,
        low:    r.low,
        close:  r.adjClose ?? r.close,
        volume: r.volume ?? 0,
      }))
      setCache(ohlcvCache, cacheKey, ohlcv)
      return ohlcv
    }
  } catch (e) {
    console.warn(`[Market] OHLCV historical failed for ${symbol}: ${e.message}`)
  }

  // Return stale if available
  const stale = getStale(ohlcvCache, cacheKey)
  if (stale) return stale

  return null
}

// ── Public: symbol search ─────────────────────────────────────────────────────

export async function searchSymbol(query) {
  try {
    const results = await yahooFinance.search(query, {}, { validateResult: false })
    return (results.quotes ?? []).slice(0, 10).map(r => ({
      symbol:   r.symbol,
      name:     r.longname ?? r.shortname ?? r.symbol,
      exchange: r.exchange,
      type:     r.quoteType,
    }))
  } catch {
    return []
  }
}
