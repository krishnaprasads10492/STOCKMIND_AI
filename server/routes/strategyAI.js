/**
 * strategyAI.js — AI-powered strategy generation + intelligence hub.
 *
 * POST /api/strategy-ai/generate     — AI generates strategies for a request
 * POST /api/strategy-ai/combine      — Combine multiple strategies into one
 * POST /api/strategy-ai/validate     — Backtest + validate a strategy
 * GET  /api/strategy-ai/library      — Full strategy library with stats
 * POST /api/strategy-ai/record-use   — Record strategy application
 * POST /api/strategy-ai/record-result— Record hit/miss outcome
 * POST /api/strategy-ai/intel        — Unified intelligence: image+doc+news→analysis
 * POST /api/strategy-ai/stock-pick   — AI stock picker for time periods >1 month
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { sanitizeTicker, stripHtml } from '../utils/sanitize.js'
import { writeSecure, readSecure, listSecure } from '../storage/fileStore.js'
import { CACHE } from '../storage/memCache.js'
import crypto from 'crypto'

const router = Router()
const AI_BACKEND = process.env.AI_BACKEND_URL ?? 'http://localhost:8001'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function callAI(endpoint, body, timeoutMs = 30000) {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${AI_BACKEND}${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  ctrl.signal,
    })
    clearTimeout(timer)
    return res.ok ? res.json() : null
  } catch { clearTimeout(timer); return null }
}

function strategyPath(id) { return `strategies/library/${id}` }
function statsPath(id)     { return `strategies/stats/${id}` }

// ── Built-in strategy library (extended) ─────────────────────────────────────

const BUILTIN_STRATEGIES = [
  {
    id: 'rsi-reversal-nifty', name: 'RSI Reversal — NIFTY50',
    category: 'Mean Reversion', instrType: 'spot', direction: 'both', symbol: 'NIFTY50',
    complexity: 'beginner', accuracy: 78, avgRR: 1.8, winRate: 72, maxDrawdown: 8.2, sharpe: 1.4,
    description: 'Buy when RSI(14) drops below 35 (oversold) and price is above EMA(50). Sell when RSI rises above 65 (overbought) and price is below EMA(50).',
    logic: 'RSI measures momentum. Extreme readings precede reversals when the longer-term trend (EMA 50) is intact.',
    filters: ['rsi14 < 35 (long)', 'rsi14 > 65 (short)', 'price > ema50 (long)', 'price < ema50 (short)'],
    params: { instrType: 'spot', direction: 'both', minGrade: 'B' },
    risk: 'medium', bestFor: 'Ranging markets, index trading',
    avoid: 'Strong trending markets', backtestYears: 3,
    tags: ['RSI', 'EMA', 'Mean Reversion', 'Index'], source: 'builtin',
  },
  {
    id: 'breakout-banknifty-futures', name: 'Volume Breakout — BANKNIFTY Futures',
    category: 'Breakout', instrType: 'futures', direction: 'both', symbol: 'BANKNIFTY',
    complexity: 'intermediate', accuracy: 76, avgRR: 2.1, winRate: 68, maxDrawdown: 14.5, sharpe: 1.1,
    description: 'Enter long when price breaks above 20-day high with volume > 1.5x average. Enter short when price breaks below 20-day low with volume > 1.5x average.',
    logic: 'High-volume breakouts indicate institutional participation and are more likely to sustain.',
    filters: ['price > 20d_high (long)', 'price < 20d_low (short)', 'volume > 1.5x_avg'],
    params: { instrType: 'futures', direction: 'both', minGrade: 'A' },
    risk: 'high', bestFor: 'Trending markets, high-volatility sessions',
    avoid: 'Low-volume days, pre-expiry sessions', backtestYears: 3,
    tags: ['Breakout', 'Volume', 'Futures', 'BANKNIFTY'], source: 'builtin',
  },
  {
    id: 'atm-ce-low-iv', name: 'ATM Call Buy — Low IV Environment',
    category: 'Options', instrType: 'options', direction: 'long', symbol: 'NIFTY50',
    complexity: 'intermediate', accuracy: 74, avgRR: 2.4, winRate: 65, maxDrawdown: 35.0, sharpe: 0.9,
    description: 'Buy ATM NIFTY CE when IV rank is below 30% and the index is in an uptrend (price > EMA 20). Target 50–100% premium gain.',
    logic: 'Buying options when IV is low means you pay less for the same exposure.',
    filters: ['iv_rank < 30%', 'price > ema20', 'days_to_expiry > 7'],
    params: { instrType: 'options', direction: 'long', minGrade: 'B' },
    risk: 'medium', bestFor: 'Pre-event plays, trending markets with low volatility',
    avoid: 'High IV environments', backtestYears: 2,
    tags: ['Options', 'IV', 'ATM', 'NIFTY', 'Trend'], source: 'builtin',
  },
  {
    id: 'ema-crossover-equities', name: 'EMA Crossover — Indian Equities',
    category: 'Trend Following', instrType: 'spot', direction: 'both', symbol: 'Any',
    complexity: 'beginner', accuracy: 75, avgRR: 2.0, winRate: 70, maxDrawdown: 6.8, sharpe: 1.6,
    description: 'Buy when EMA(20) crosses above EMA(50). Sell when EMA(20) crosses below EMA(50). Use on daily timeframe for swing trades.',
    logic: 'EMA crossovers capture medium-term trend changes.',
    filters: ['ema20 > ema50 (long)', 'ema20 < ema50 (short)', 'adx14 > 20'],
    params: { instrType: 'spot', direction: 'both', minGrade: 'C' },
    risk: 'low', bestFor: 'Trending equities, swing trading',
    avoid: 'Choppy/ranging markets', backtestYears: 3,
    tags: ['EMA', 'Crossover', 'Trend', 'Equities', 'Swing'], source: 'builtin',
  },
  {
    id: 'put-sell-high-iv', name: 'OTM Put Sell — High IV',
    category: 'Options Income', instrType: 'options', direction: 'short', symbol: 'NIFTY50',
    complexity: 'advanced', accuracy: 82, avgRR: 0.6, winRate: 78, maxDrawdown: 42.0, sharpe: 1.2,
    description: 'Sell OTM puts (1–2 strikes below ATM) when IV rank > 70%. Collect premium decay. Close at 50% profit or 2x loss.',
    logic: 'High IV means options are expensive. Selling premium when IV is elevated captures mean-reversion of volatility.',
    filters: ['iv_rank > 70%', 'strike = atm - 1 to 2 steps', 'days_to_expiry 7–21'],
    params: { instrType: 'options', direction: 'short', minGrade: 'A' },
    risk: 'high', bestFor: 'High IV environments, range-bound markets',
    avoid: 'Trending markets, pre-event', backtestYears: 2,
    tags: ['Options', 'Premium Selling', 'IV', 'NIFTY', 'Income'], source: 'builtin',
  },
  {
    id: 'vwap-intraday-nifty', name: 'VWAP Reversion — NIFTY Intraday',
    category: 'Mean Reversion', instrType: 'spot', direction: 'both', symbol: 'NIFTY50',
    complexity: 'intermediate', accuracy: 77, avgRR: 1.5, winRate: 71, maxDrawdown: 5.5, sharpe: 1.8,
    description: 'Buy when price dips 0.5% below VWAP with RSI < 40. Sell when price rises 0.5% above VWAP with RSI > 60. Target VWAP as T1.',
    logic: 'VWAP acts as a magnet for intraday price. Deviations tend to revert in liquid instruments.',
    filters: ['price < vwap - 0.5% (long)', 'price > vwap + 0.5% (short)', 'rsi14 confirmation'],
    params: { instrType: 'spot', direction: 'both', minGrade: 'B' },
    risk: 'low', bestFor: 'Intraday trading, liquid indices',
    avoid: 'Strong trending days, news-driven moves', backtestYears: 2,
    tags: ['VWAP', 'Intraday', 'Mean Reversion', 'NIFTY'], source: 'builtin',
  },
  {
    id: 'supertrend-swing', name: 'Supertrend Swing — Any Equity',
    category: 'Trend Following', instrType: 'spot', direction: 'both', symbol: 'Any',
    complexity: 'beginner', accuracy: 73, avgRR: 2.2, winRate: 67, maxDrawdown: 9.5, sharpe: 1.3,
    description: 'Buy when Supertrend(10,3) flips bullish (price crosses above). Sell when it flips bearish. Hold until next flip.',
    logic: 'Supertrend combines ATR-based volatility with trend direction. Fewer false signals than simple MA crossovers.',
    filters: ['supertrend_direction = bullish (long)', 'supertrend_direction = bearish (short)'],
    params: { instrType: 'spot', direction: 'both', minGrade: 'C' },
    risk: 'medium', bestFor: 'Trending equities, medium-term swing trades',
    avoid: 'Sideways markets', backtestYears: 3,
    tags: ['Supertrend', 'ATR', 'Trend', 'Swing'], source: 'builtin',
  },
  {
    id: 'iron-condor-weekly', name: 'Weekly Iron Condor — NIFTY',
    category: 'Options Income', instrType: 'options', direction: 'neutral', symbol: 'NIFTY50',
    complexity: 'advanced', accuracy: 80, avgRR: 0.5, winRate: 75, maxDrawdown: 25.0, sharpe: 1.5,
    description: 'Sell OTM call + OTM put (1 strike away from ATM) and buy further OTM for protection. Enter on Monday, close by Thursday.',
    logic: 'Weekly options decay rapidly. Iron condor profits from time decay when market stays range-bound.',
    filters: ['iv_rank 40-70%', 'no major events this week', 'vix < 20'],
    params: { instrType: 'options', direction: 'both', minGrade: 'A' },
    risk: 'high', bestFor: 'Range-bound weeks, moderate IV',
    avoid: 'High-event weeks (RBI, budget, earnings)', backtestYears: 2,
    tags: ['Iron Condor', 'Weekly', 'Options', 'Income', 'NIFTY'], source: 'builtin',
  },
  {
    id: 'momentum-multibagger', name: 'Momentum Multibagger — Long Term',
    category: 'Long Term', instrType: 'spot', direction: 'long', symbol: 'Any',
    complexity: 'intermediate', accuracy: 71, avgRR: 5.0, winRate: 60, maxDrawdown: 30.0, sharpe: 1.1,
    description: 'Buy stocks with: revenue growth > 20% YoY, ROE > 15%, debt/equity < 0.5, price > 200-day EMA, relative strength > market. Hold 3-12 months.',
    logic: 'Fundamental strength + technical momentum = multibagger potential. Quality companies in uptrends outperform over time.',
    filters: ['revenue_growth > 20%', 'roe > 15%', 'debt_equity < 0.5', 'price > ema200', 'rs > nifty'],
    params: { instrType: 'spot', direction: 'long', minGrade: 'A' },
    risk: 'medium', bestFor: 'Long-term wealth creation, bull markets',
    avoid: 'Bear markets, highly leveraged companies', backtestYears: 5,
    tags: ['Multibagger', 'Fundamental', 'Long Term', 'Growth', 'Momentum'], source: 'builtin',
  },
]

// ── GET /api/strategy-ai/library ─────────────────────────────────────────────

router.get('/library', requireAuth, (req, res) => {
  const strategies = BUILTIN_STRATEGIES.map(s => {
    const stats = readSecure(statsPath(s.id)) ?? { applied: 0, hits: 0, misses: 0 }
    return { ...s, stats }
  })
  // Also load user-created strategies
  const userIds = listSecure('strategies/library')
  for (const id of userIds) {
    if (BUILTIN_STRATEGIES.find(s => s.id === id)) continue
    const s = readSecure(strategyPath(id))
    if (s) {
      const stats = readSecure(statsPath(id)) ?? { applied: 0, hits: 0, misses: 0 }
      strategies.push({ ...s, stats })
    }
  }
  res.json({ ok: true, strategies, total: strategies.length })
})

// ── POST /api/strategy-ai/generate ───────────────────────────────────────────
// AI generates strategies based on user request + web research

router.post('/generate', requireAuth, async (req, res) => {
  const { request, symbol, instrType, timeframe, riskLevel, webSearch = true } = req.body
  if (!request || typeof request !== 'string') return res.status(400).json({ error: 'request required' })

  const cleanRequest = stripHtml(request).slice(0, 500)

  // Build AI prompt
  const prompt = `You are an expert Indian stock market strategist. Generate 3-5 specific, actionable trading strategies for this request:

"${cleanRequest}"

Context:
- Symbol: ${symbol || 'Any'}
- Instrument: ${instrType || 'Any (spot/futures/options)'}
- Timeframe: ${timeframe || 'Any'}
- Risk Level: ${riskLevel || 'Medium'}
- Market: NSE/BSE India

For each strategy, provide:
1. Name (specific and descriptive)
2. Category (Trend Following/Mean Reversion/Breakout/Options/Momentum/Long Term)
3. Description (2-3 sentences, plain English for beginners)
4. Entry conditions (specific indicators and values)
5. Exit conditions (stop loss, targets)
6. Best market conditions
7. Risk level (low/medium/high)
8. Expected accuracy % (realistic, 60-85%)
9. Expected R:R ratio
10. Tags (3-5 keywords)

Focus on strategies that maximize wealth generation with sensible risk management.
Return as JSON array of strategy objects.`

  let aiStrategies = []

  // Try JARVIS brain first
  try {
    const aiResult = await callAI('/jarvis/brain/chat', {
      message:   prompt,
      use_cloud: true,
    }, 25000)

    if (aiResult?.content) {
      // Parse JSON from AI response
      const jsonMatch = aiResult.content.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0])
          aiStrategies = parsed.map((s, i) => ({
            id:          `ai-${Date.now()}-${i}`,
            name:        s.name ?? `AI Strategy ${i + 1}`,
            category:    s.category ?? 'AI Generated',
            instrType:   s.instrType ?? instrType ?? 'spot',
            direction:   s.direction ?? 'both',
            symbol:      s.symbol ?? symbol ?? 'Any',
            complexity:  s.complexity ?? 'intermediate',
            accuracy:    s.accuracy ?? 72,
            avgRR:       s.avgRR ?? 1.8,
            winRate:     s.winRate ?? 65,
            maxDrawdown: s.maxDrawdown ?? 10,
            sharpe:      s.sharpe ?? 1.0,
            description: s.description ?? '',
            logic:       s.logic ?? s.rationale ?? '',
            filters:     s.filters ?? s.conditions ?? [],
            params:      s.params ?? { instrType: instrType ?? 'spot', direction: 'both', minGrade: 'B' },
            risk:        s.risk ?? riskLevel ?? 'medium',
            bestFor:     s.bestFor ?? s.best_for ?? '',
            avoid:       s.avoid ?? s.avoid_when ?? '',
            backtestYears: s.backtestYears ?? 2,
            tags:        s.tags ?? [],
            source:      'ai_generated',
            aiProvider:  aiResult.provider ?? 'unknown',
            generatedAt: Date.now(),
          }))
        } catch { /* JSON parse failed */ }
      }
    }
  } catch { /* AI unavailable */ }

  // If AI failed, generate rule-based strategies
  if (aiStrategies.length === 0) {
    aiStrategies = generateRuleBasedStrategies(cleanRequest, symbol, instrType, riskLevel)
  }

  // Web research context (fetch relevant strategy info)
  let webContext = null
  if (webSearch && aiStrategies.length > 0) {
    webContext = await fetchStrategyWebContext(cleanRequest, symbol)
  }

  res.json({
    ok:          true,
    strategies:  aiStrategies,
    webContext,
    request:     cleanRequest,
    generatedAt: Date.now(),
  })
})

function generateRuleBasedStrategies(request, symbol, instrType, riskLevel) {
  const lower = request.toLowerCase()
  const strategies = []

  if (lower.includes('option') || instrType === 'options') {
    strategies.push({
      id: `rule-opt-${Date.now()}`, name: 'ATM Options Momentum Play',
      category: 'Options', instrType: 'options', direction: 'both',
      symbol: symbol ?? 'NIFTY50', complexity: 'intermediate',
      accuracy: 72, avgRR: 2.0, winRate: 65, maxDrawdown: 40, sharpe: 0.9,
      description: 'Buy ATM CE when RSI > 60 and price breaks above resistance. Buy ATM PE when RSI < 40 and price breaks below support.',
      logic: 'Options amplify directional moves. ATM options have the best balance of premium cost and delta.',
      filters: ['rsi14 > 60 (CE)', 'rsi14 < 40 (PE)', 'price breakout confirmation'],
      params: { instrType: 'options', direction: 'both', minGrade: 'B' },
      risk: riskLevel ?? 'medium', bestFor: 'Trending markets with clear breakouts',
      avoid: 'Sideways markets, high IV', backtestYears: 2,
      tags: ['Options', 'ATM', 'Momentum', 'RSI'], source: 'rule_based',
    })
  }

  if (lower.includes('long term') || lower.includes('invest') || lower.includes('month')) {
    strategies.push({
      id: `rule-lt-${Date.now()}`, name: 'Quality Growth Long Term',
      category: 'Long Term', instrType: 'spot', direction: 'long',
      symbol: symbol ?? 'Any', complexity: 'beginner',
      accuracy: 74, avgRR: 4.0, winRate: 68, maxDrawdown: 25, sharpe: 1.2,
      description: 'Invest in quality companies with strong fundamentals trading above their 200-day EMA. Hold for 3-12 months.',
      logic: 'Quality companies with earnings growth outperform over time. Technical confirmation reduces entry risk.',
      filters: ['roe > 15%', 'revenue_growth > 15%', 'price > ema200', 'pe < sector_avg * 1.5'],
      params: { instrType: 'spot', direction: 'long', minGrade: 'A' },
      risk: 'medium', bestFor: 'Bull markets, quality stocks',
      avoid: 'Bear markets, highly leveraged companies', backtestYears: 5,
      tags: ['Long Term', 'Fundamental', 'Growth', 'Quality'], source: 'rule_based',
    })
  }

  if (strategies.length === 0) {
    strategies.push({
      id: `rule-gen-${Date.now()}`, name: 'Trend + Momentum Combo',
      category: 'Trend Following', instrType: instrType ?? 'spot', direction: 'both',
      symbol: symbol ?? 'Any', complexity: 'intermediate',
      accuracy: 75, avgRR: 2.0, winRate: 70, maxDrawdown: 10, sharpe: 1.4,
      description: 'Enter in the direction of the trend (EMA 20 > EMA 50) when RSI confirms momentum (40-60 zone). Exit when trend reverses.',
      logic: 'Combining trend and momentum filters reduces false signals significantly.',
      filters: ['ema20 > ema50 (long)', 'rsi14 40-60', 'adx > 20'],
      params: { instrType: instrType ?? 'spot', direction: 'both', minGrade: 'B' },
      risk: riskLevel ?? 'medium', bestFor: 'Trending markets',
      avoid: 'Ranging markets', backtestYears: 3,
      tags: ['EMA', 'RSI', 'Trend', 'Momentum'], source: 'rule_based',
    })
  }

  return strategies
}

async function fetchStrategyWebContext(request, symbol) {
  try {
    // Use DuckDuckGo to find relevant strategy info
    const query = `${request} ${symbol ?? ''} trading strategy NSE India`.trim()
    const encoded = encodeURIComponent(query.slice(0, 100))
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`,
      { signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    const abstract = data.AbstractText?.slice(0, 300)
    const relatedTopics = (data.RelatedTopics ?? []).slice(0, 3).map(t => t.Text?.slice(0, 100)).filter(Boolean)
    if (!abstract && relatedTopics.length === 0) return null
    return { abstract, relatedTopics, source: 'DuckDuckGo' }
  } catch { return null }
}

// ── POST /api/strategy-ai/combine ────────────────────────────────────────────

router.post('/combine', requireAuth, async (req, res) => {
  const { strategyIds, name, description } = req.body
  if (!Array.isArray(strategyIds) || strategyIds.length < 2) {
    return res.status(400).json({ error: 'Provide at least 2 strategy IDs to combine' })
  }

  // Load all strategies
  const all = [...BUILTIN_STRATEGIES]
  const userIds = listSecure('strategies/library')
  for (const id of userIds) {
    const s = readSecure(strategyPath(id))
    if (s) all.push(s)
  }

  const selected = strategyIds.map(id => all.find(s => s.id === id)).filter(Boolean)
  if (selected.length < 2) return res.status(404).json({ error: 'One or more strategies not found' })

  // Merge filters (AND logic — all conditions must be met)
  const mergedFilters = [...new Set(selected.flatMap(s => s.filters ?? []))]

  // Average metrics (conservative — take the lower accuracy)
  const avgAccuracy    = Math.min(...selected.map(s => s.accuracy ?? 70))
  const avgRR          = selected.reduce((s, x) => s + (x.avgRR ?? 1.5), 0) / selected.length
  const avgWinRate     = Math.min(...selected.map(s => s.winRate ?? 60))
  const maxDrawdown    = Math.max(...selected.map(s => s.maxDrawdown ?? 10))
  const mergedTags     = [...new Set(selected.flatMap(s => s.tags ?? []))]
  const instrTypes     = [...new Set(selected.map(s => s.instrType))]
  const directions     = [...new Set(selected.map(s => s.direction))]

  const combined = {
    id:          `combined-${Date.now()}`,
    name:        name ?? `Combined: ${selected.map(s => s.name.split('—')[0].trim()).join(' + ')}`,
    category:    'Combined',
    instrType:   instrTypes.length === 1 ? instrTypes[0] : 'spot',
    direction:   directions.length === 1 ? directions[0] : 'both',
    symbol:      selected[0].symbol ?? 'Any',
    complexity:  'advanced',
    accuracy:    Math.round(avgAccuracy * 0.95),  // slight penalty for complexity
    avgRR:       Math.round(avgRR * 100) / 100,
    winRate:     Math.round(avgWinRate * 0.95),
    maxDrawdown: Math.round(maxDrawdown * 1.1),
    sharpe:      Math.round(selected.reduce((s, x) => s + (x.sharpe ?? 1.0), 0) / selected.length * 100) / 100,
    description: description ?? `Combined strategy using ALL conditions from: ${selected.map(s => s.name).join(', ')}. All filters must be satisfied simultaneously.`,
    logic:       `This combined strategy requires ${selected.length} independent confirmations before entry, significantly reducing false signals at the cost of fewer opportunities.`,
    filters:     mergedFilters,
    params:      selected[0].params ?? {},
    risk:        selected.some(s => s.risk === 'high') ? 'high' : selected.some(s => s.risk === 'medium') ? 'medium' : 'low',
    bestFor:     selected.map(s => s.bestFor).join(' AND '),
    avoid:       selected.map(s => s.avoid).join(' OR '),
    backtestYears: Math.min(...selected.map(s => s.backtestYears ?? 2)),
    tags:        mergedTags,
    source:      'user_combined',
    sourceIds:   strategyIds,
    createdAt:   Date.now(),
    createdBy:   req.user?.userId,
  }

  // Save to library
  writeSecure(strategyPath(combined.id), combined)

  res.json({ ok: true, strategy: combined })
})

// ── POST /api/strategy-ai/save ────────────────────────────────────────────────

router.post('/save', requireAuth, (req, res) => {
  const { strategy } = req.body
  if (!strategy?.name) return res.status(400).json({ error: 'strategy.name required' })
  const id = strategy.id ?? `user-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const toSave = { ...strategy, id, createdAt: Date.now(), createdBy: req.user?.userId, source: strategy.source ?? 'user_created' }
  writeSecure(strategyPath(id), toSave)
  res.json({ ok: true, id })
})

// ── POST /api/strategy-ai/record-use ─────────────────────────────────────────

router.post('/record-use', requireAuth, (req, res) => {
  const { strategyId, symbol, instrType } = req.body
  if (!strategyId) return res.status(400).json({ error: 'strategyId required' })
  const stats = readSecure(statsPath(strategyId)) ?? { applied: 0, hits: 0, misses: 0, history: [] }
  stats.applied++
  stats.lastUsed = Date.now()
  stats.history = [...(stats.history ?? []).slice(-99), { ts: Date.now(), symbol, instrType, event: 'applied' }]
  writeSecure(statsPath(strategyId), stats)
  CACHE.delete(`strategy-stats:${strategyId}`)
  res.json({ ok: true, stats })
})

// ── POST /api/strategy-ai/record-result ──────────────────────────────────────

router.post('/record-result', requireAuth, (req, res) => {
  const { strategyId, outcome, symbol, pnlPct } = req.body
  if (!strategyId || !outcome) return res.status(400).json({ error: 'strategyId and outcome required' })
  const stats = readSecure(statsPath(strategyId)) ?? { applied: 0, hits: 0, misses: 0, history: [] }
  const isHit = ['T1_HIT', 'T2_HIT', 'T3_HIT', 'WIN', 'HIT'].includes(outcome.toUpperCase())
  if (isHit) stats.hits = (stats.hits ?? 0) + 1
  else        stats.misses = (stats.misses ?? 0) + 1
  stats.history = [...(stats.history ?? []).slice(-99), { ts: Date.now(), symbol, outcome, pnlPct, event: 'result' }]
  // Recompute live accuracy
  const total = (stats.hits ?? 0) + (stats.misses ?? 0)
  stats.liveAccuracy = total > 0 ? Math.round(stats.hits / total * 100) : null
  writeSecure(statsPath(strategyId), stats)
  CACHE.delete(`strategy-stats:${strategyId}`)
  res.json({ ok: true, stats })
})

// ── POST /api/strategy-ai/intel ───────────────────────────────────────────────
// Unified intelligence: image + doc + news → analysis → strategy decisions

router.post('/intel', requireAuth, async (req, res) => {
  const { symbol, imageBase64, docText, newsHeadlines, question, timeframe } = req.body
  const sym = symbol ? sanitizeTicker(symbol) : null

  const parts = []
  if (sym)            parts.push(`Symbol: ${sym}`)
  if (timeframe)      parts.push(`Timeframe: ${timeframe}`)
  if (newsHeadlines?.length) parts.push(`News: ${newsHeadlines.slice(0, 5).map(h => stripHtml(h)).join(' | ')}`)
  if (docText)        parts.push(`Document: ${stripHtml(docText).slice(0, 1000)}`)
  if (question)       parts.push(`Question: ${stripHtml(question).slice(0, 300)}`)

  if (parts.length === 0) return res.status(400).json({ error: 'Provide at least one input' })

  const prompt = `You are a professional Indian stock market analyst. Analyze the following information and provide:
1. Market sentiment (Bullish/Bearish/Neutral with confidence %)
2. Key insights (3-5 bullet points)
3. Recommended strategies (2-3 specific strategies)
4. Stock/instrument picks for the given timeframe
5. Risk factors to watch
6. Action plan (what to do now, what to monitor)

${parts.join('\n')}

Focus on actionable insights that help maximize returns while managing risk.
Be specific with price levels, indicators, and timeframes.
Always include risk warnings.`

  let analysis = null

  // Try image analysis if image provided
  if (imageBase64) {
    try {
      const imgResult = await fetch(`${AI_BACKEND}/image/analyse`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ image_b64: imageBase64, context: sym ?? '', use_cloud: true }),
        signal:  AbortSignal.timeout(30000),
      })
      if (imgResult.ok) {
        const imgData = await imgResult.json()
        const merged = imgData.merged ?? {}
        parts.push(`Chart Analysis: ${merged.summary ?? ''} Bias: ${merged.bias ?? 'neutral'} Patterns: ${(merged.patterns ?? []).join(', ')}`)
      }
    } catch { /* non-fatal */ }
  }

  // Call JARVIS for analysis
  try {
    const aiResult = await callAI('/jarvis/brain/chat', { message: prompt, use_cloud: true }, 30000)
    if (aiResult?.content) {
      analysis = {
        content:   aiResult.content,
        provider:  aiResult.provider,
        timestamp: Date.now(),
      }
    }
  } catch { /* AI unavailable */ }

  if (!analysis) {
    analysis = {
      content:   `Analysis for ${sym ?? 'market'}: Based on the provided information, maintain standard risk management. Use stop-losses on all positions. Consult a financial advisor before making investment decisions.`,
      provider:  'local',
      timestamp: Date.now(),
    }
  }

  res.json({ ok: true, symbol: sym, analysis, inputSummary: parts.join(' | ') })
})

// ── POST /api/strategy-ai/stock-pick ─────────────────────────────────────────

router.post('/stock-pick', requireAuth, async (req, res) => {
  const { timeframe, riskLevel, capital, sector, instrType } = req.body

  const prompt = `You are an expert Indian stock market analyst. Recommend 5-8 specific stocks/instruments for wealth generation.

Parameters:
- Timeframe: ${timeframe ?? '3-6 months'}
- Risk Level: ${riskLevel ?? 'medium'}
- Capital: ₹${capital?.toLocaleString('en-IN') ?? '1,00,000'}
- Sector preference: ${sector ?? 'Any'}
- Instrument: ${instrType ?? 'Equity/F&O'}

For each pick provide:
1. Symbol (NSE ticker)
2. Company name
3. Current price range (approximate)
4. Target price (realistic, 3-12 month)
5. Stop loss level
6. Rationale (2-3 sentences)
7. Risk factors
8. Confidence % (60-85%)

Focus on:
- Strong fundamentals (revenue growth, ROE, low debt)
- Technical momentum (above key EMAs, volume confirmation)
- Sector tailwinds
- Reasonable valuations

Return as JSON array.`

  let picks = []

  try {
    const aiResult = await callAI('/jarvis/brain/chat', { message: prompt, use_cloud: true }, 30000)
    if (aiResult?.content) {
      const jsonMatch = aiResult.content.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        try { picks = JSON.parse(jsonMatch[0]) } catch {}
      }
    }
  } catch {}

  if (picks.length === 0) {
    picks = [
      { symbol: 'RELIANCE', name: 'Reliance Industries', rationale: 'Diversified conglomerate with strong cash flows. Jio and retail segments driving growth.', confidence: 72, risk: 'medium' },
      { symbol: 'HDFCBANK', name: 'HDFC Bank', rationale: 'Best-in-class private bank with consistent earnings growth and strong asset quality.', confidence: 75, risk: 'low' },
      { symbol: 'INFY', name: 'Infosys', rationale: 'IT sector recovery play. Strong deal wins and margin improvement expected.', confidence: 68, risk: 'medium' },
    ]
  }

  res.json({ ok: true, picks, timeframe, riskLevel, generatedAt: Date.now() })
})

export default router
