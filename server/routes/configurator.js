/**
 * configurator.js — Integration Configurator API
 *
 * Super-admin only: manage all external resource integrations.
 * Supports per-user overrides (admin can set different keys per user).
 *
 * Storage: data/system/integrations/{category}/{id}.enc
 *   - Global configs: data/system/integrations/global/{category}.enc
 *   - User overrides: data/system/integrations/users/{userId}/{category}.enc
 *
 * Endpoints:
 *   GET    /api/configurator/integrations              — all categories + status
 *   GET    /api/configurator/integrations/:category    — one category
 *   PUT    /api/configurator/integrations/:category    — save global config
 *   DELETE /api/configurator/integrations/:category/:id — remove one integration
 *   GET    /api/configurator/integrations/user/:userId — user overrides
 *   PUT    /api/configurator/integrations/user/:userId/:category — set user override
 *   DELETE /api/configurator/integrations/user/:userId/:category — remove override
 *   POST   /api/configurator/integrations/:category/test — test connection
 *   GET    /api/configurator/schema                    — full resource schema
 */

import { Router } from 'express'
import { requireSuperAdmin } from '../middleware/auth.js'
import { writeSecure, readSecure, listSecure, deleteSecure } from '../storage/fileStore.js'
import { sanitizeTicker } from '../utils/sanitize.js'

const router = Router()

// All configurator routes require super-admin
router.use(requireSuperAdmin)

// ── Schema — defines all supported integration categories ─────────────────────

const INTEGRATION_SCHEMA = {
  market_data: {
    label:       'Market Data',
    icon:        '📈',
    description: 'Live price feeds, OHLCV history, order book data',
    multiple:    true,   // can have multiple active providers
    providers: [
      { id: 'yahoo_finance',  name: 'Yahoo Finance',       authType: 'none',   fields: [],                                    free: true,  docs: 'https://finance.yahoo.com' },
      { id: 'zerodha',        name: 'Zerodha Kite',        authType: 'oauth',  fields: ['apiKey','apiSecret','redirectUrl'],   free: false, docs: 'https://kite.trade/docs' },
      { id: 'finnhub',        name: 'Finnhub',             authType: 'apikey', fields: ['apiKey'],                            free: true,  docs: 'https://finnhub.io/docs' },
      { id: 'alpha_vantage',  name: 'Alpha Vantage',       authType: 'apikey', fields: ['apiKey'],                            free: true,  docs: 'https://www.alphavantage.co/documentation' },
      { id: 'twelve_data',    name: 'Twelve Data',         authType: 'apikey', fields: ['apiKey'],                            free: true,  docs: 'https://twelvedata.com/docs' },
      { id: 'polygon',        name: 'Polygon.io',          authType: 'apikey', fields: ['apiKey'],                            free: true,  docs: 'https://polygon.io/docs' },
      { id: 'binance',        name: 'Binance WebSocket',   authType: 'none',   fields: [],                                    free: true,  docs: 'https://binance-docs.github.io' },
    ],
  },
  ai_llm: {
    label:       'AI / LLM Providers',
    icon:        '🤖',
    description: 'Cloud AI models for JARVIS, analysis, strategy generation, and intelligence hub',
    multiple:    true,
    providers: [
      {
        id: 'openai', name: 'OpenAI (GPT)',
        authType: 'bearer', fields: ['apiKey', 'defaultModel', 'orgId'],
        free: false,
        docs:    'https://platform.openai.com/docs/overview',
        signup:  'https://platform.openai.com/signup',
        apiKeys: 'https://platform.openai.com/api-keys',
        info:    'Industry-leading GPT models. GPT-4o is the best balance of speed and intelligence. Requires a paid account after free trial credits.',
        models:  ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', 'o1-mini'],
        fieldInfo: {
          apiKey:       'Found at platform.openai.com/api-keys → Create new secret key. Starts with sk-...',
          defaultModel: 'Recommended: gpt-4o-mini (fast + cheap) or gpt-4o (best quality)',
          orgId:        'Optional. Found at platform.openai.com/settings/organization → Organization ID',
        },
      },
      {
        id: 'anthropic', name: 'Anthropic (Claude)',
        authType: 'bearer', fields: ['apiKey', 'defaultModel'],
        free: false,
        docs:    'https://docs.anthropic.com/en/api/getting-started',
        signup:  'https://console.anthropic.com/login',
        apiKeys: 'https://console.anthropic.com/settings/keys',
        info:    'Claude models excel at reasoning, analysis, and long-context tasks. Claude 3.5 Sonnet is the recommended model for financial analysis.',
        models:  ['claude-sonnet-4-5', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
        fieldInfo: {
          apiKey:       'Found at console.anthropic.com/settings/keys → Create Key. Starts with sk-ant-...',
          defaultModel: 'Recommended: claude-3-5-haiku-20241022 (fast) or claude-sonnet-4-5 (best)',
        },
      },
      {
        id: 'gemini', name: 'Google Gemini',
        authType: 'apikey', fields: ['apiKey', 'defaultModel'],
        free: true,
        docs:    'https://ai.google.dev/gemini-api/docs',
        signup:  'https://aistudio.google.com',
        apiKeys: 'https://aistudio.google.com/app/apikey',
        info:    'Google Gemini offers a generous free tier (1500 req/day on Flash). Gemini 1.5 Flash is fast and free — ideal for high-volume analysis.',
        models:  ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.5-pro'],
        fieldInfo: {
          apiKey:       'Found at aistudio.google.com/app/apikey → Get API key. No credit card needed for free tier.',
          defaultModel: 'Recommended: gemini-2.0-flash (free, fast) or gemini-1.5-pro (best quality)',
        },
      },
      {
        id: 'groq', name: 'Groq (Llama / Mixtral)',
        authType: 'bearer', fields: ['apiKey', 'defaultModel'],
        free: true,
        docs:    'https://console.groq.com/docs/openai',
        signup:  'https://console.groq.com/login',
        apiKeys: 'https://console.groq.com/keys',
        info:    'Groq runs open-source models (Llama 3, Mixtral) at extreme speed on custom LPU hardware. Free tier with generous rate limits. Best for real-time analysis.',
        models:  ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
        fieldInfo: {
          apiKey:       'Found at console.groq.com/keys → Create API Key. Free account available.',
          defaultModel: 'Recommended: llama-3.3-70b-versatile (best) or llama-3.1-8b-instant (fastest)',
        },
      },
      {
        id: 'xai', name: 'xAI Grok',
        authType: 'bearer', fields: ['apiKey', 'defaultModel'],
        free: false,
        docs:    'https://docs.x.ai/docs',
        signup:  'https://console.x.ai',
        apiKeys: 'https://console.x.ai/team/default/api-keys',
        info:    'xAI Grok models are OpenAI-compatible. Grok-3 leads in reasoning and real-time knowledge. Sign up at console.x.ai with your X (Twitter) account.',
        models:  ['grok-3', 'grok-3-fast', 'grok-3-mini', 'grok-2-1212'],
        fieldInfo: {
          apiKey:       'Found at console.x.ai → API Keys → Create API Key. Starts with xai-...',
          defaultModel: 'Recommended: grok-3-fast (speed) or grok-3 (best reasoning)',
        },
      },
      {
        id: 'deepseek', name: 'DeepSeek',
        authType: 'bearer', fields: ['apiKey', 'defaultModel'],
        free: false,
        docs:    'https://platform.deepseek.com/api-docs',
        signup:  'https://platform.deepseek.com',
        apiKeys: 'https://platform.deepseek.com/api_keys',
        info:    'DeepSeek V3 and R1 offer GPT-4-level performance at a fraction of the cost. R1 is a reasoning model ideal for complex financial analysis.',
        models:  ['deepseek-chat', 'deepseek-reasoner'],
        fieldInfo: {
          apiKey:       'Found at platform.deepseek.com/api_keys → Create API Key.',
          defaultModel: 'Recommended: deepseek-chat (general) or deepseek-reasoner (complex analysis)',
        },
      },
      {
        id: 'mistral', name: 'Mistral AI',
        authType: 'bearer', fields: ['apiKey', 'defaultModel'],
        free: false,
        docs:    'https://docs.mistral.ai/api',
        signup:  'https://console.mistral.ai',
        apiKeys: 'https://console.mistral.ai/api-keys',
        info:    'Mistral offers efficient European-hosted models. Mistral Large is competitive with GPT-4. Good for GDPR-sensitive deployments.',
        models:  ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest', 'open-mixtral-8x22b'],
        fieldInfo: {
          apiKey:       'Found at console.mistral.ai/api-keys → Create new key.',
          defaultModel: 'Recommended: mistral-small-latest (cheap) or mistral-large-latest (best)',
        },
      },
      {
        id: 'together', name: 'Together AI',
        authType: 'bearer', fields: ['apiKey', 'defaultModel'],
        free: true,
        docs:    'https://docs.together.ai/docs/quickstart',
        signup:  'https://api.together.ai',
        apiKeys: 'https://api.together.ai/settings/api-keys',
        info:    'Together AI hosts 100+ open-source models (Llama, Qwen, DBRX) with OpenAI-compatible API. Free $25 credit on signup. Best for open-source model access.',
        models:  ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo', 'mistralai/Mixtral-8x22B-Instruct-v0.1'],
        fieldInfo: {
          apiKey:       'Found at api.together.ai/settings/api-keys → Create API Key. $25 free credit on signup.',
          defaultModel: 'Recommended: meta-llama/Llama-3.3-70B-Instruct-Turbo',
        },
      },
      {
        id: 'perplexity', name: 'Perplexity AI',
        authType: 'bearer', fields: ['apiKey', 'defaultModel'],
        free: false,
        docs:    'https://docs.perplexity.ai/home',
        signup:  'https://www.perplexity.ai/settings/api',
        apiKeys: 'https://www.perplexity.ai/settings/api',
        info:    'Perplexity models have real-time web search built in — ideal for fetching live news, earnings, and market events for analysis.',
        models:  ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning'],
        fieldInfo: {
          apiKey:       'Found at perplexity.ai/settings/api → Generate. Requires Perplexity Pro subscription.',
          defaultModel: 'Recommended: sonar (web search) or sonar-reasoning-pro (deep analysis)',
        },
      },
      {
        id: 'cohere', name: 'Cohere',
        authType: 'bearer', fields: ['apiKey', 'defaultModel'],
        free: true,
        docs:    'https://docs.cohere.com/docs/the-cohere-platform',
        signup:  'https://dashboard.cohere.com/welcome/register',
        apiKeys: 'https://dashboard.cohere.com/api-keys',
        info:    'Cohere Command R+ excels at RAG (retrieval-augmented generation) and tool use. Free trial key available. Good for document analysis in Intel Hub.',
        models:  ['command-r-plus', 'command-r', 'command-light'],
        fieldInfo: {
          apiKey:       'Found at dashboard.cohere.com/api-keys → New Trial Key (free) or Production Key.',
          defaultModel: 'Recommended: command-r-plus (best) or command-r (cheaper)',
        },
      },
      {
        id: 'openrouter', name: 'OpenRouter (Multi-model)',
        authType: 'bearer', fields: ['apiKey', 'defaultModel'],
        free: true,
        docs:    'https://openrouter.ai/docs',
        signup:  'https://openrouter.ai/sign-up',
        apiKeys: 'https://openrouter.ai/settings/keys',
        info:    'OpenRouter is a unified API gateway for 200+ models from all providers. One key, one endpoint, access to everything. Some models are free. Best for flexibility.',
        models:  ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'google/gemini-flash-1.5', 'meta-llama/llama-3.3-70b-instruct:free'],
        fieldInfo: {
          apiKey:       'Found at openrouter.ai/settings/keys → Create Key. Starts with sk-or-...',
          defaultModel: 'Use full model path e.g. anthropic/claude-3.5-sonnet or meta-llama/llama-3.3-70b-instruct:free',
        },
      },
      {
        id: 'ollama', name: 'Ollama (Local)',
        authType: 'none', fields: ['baseUrl', 'defaultModel'],
        free: true,
        docs:    'https://ollama.com/library',
        signup:  'https://ollama.com/download',
        apiKeys: null,
        info:    'Run AI models 100% locally — no API key, no cost, no data leaves your machine. Install Ollama, then pull a model: ollama pull llama3.2',
        models:  ['llama3.2', 'llama3.1:8b', 'mistral', 'qwen2.5', 'phi3', 'gemma2'],
        fieldInfo: {
          baseUrl:      'Default: http://localhost:11434 — change only if Ollama runs on a different port',
          defaultModel: 'Run: ollama list to see installed models. Pull with: ollama pull llama3.2',
        },
      },
      {
        id: 'lmstudio', name: 'LM Studio (Local)',
        authType: 'none', fields: ['baseUrl', 'defaultModel'],
        free: true,
        docs:    'https://lmstudio.ai/docs',
        signup:  'https://lmstudio.ai',
        apiKeys: null,
        info:    'LM Studio provides a GUI for running local models with an OpenAI-compatible server. Enable the local server in LM Studio → Developer tab.',
        models:  ['any model loaded in LM Studio'],
        fieldInfo: {
          baseUrl:      'Default: http://localhost:1234 — check LM Studio → Developer → Server Port',
          defaultModel: 'Copy the model identifier shown in LM Studio after loading a model',
        },
      },
    ],
  },
  database: {
    label:       'Databases',
    icon:        '🗄',
    description: 'Storage backends for predictions, users, and analytics',
    multiple:    false,  // one primary DB per category
    providers: [
      { id: 'mongodb',    name: 'MongoDB Atlas',           authType: 'uri',    fields: ['uri','database'],         free: true,  docs: 'https://cloud.mongodb.com' },
      { id: 'postgres',   name: 'PostgreSQL',              authType: 'conn',   fields: ['host','port','database','user','password'], free: false, docs: 'https://postgresql.org' },
      { id: 'redis',      name: 'Redis',                   authType: 'conn',   fields: ['host','port','password'],  free: true,  docs: 'https://redis.io' },
      { id: 'sqlite',     name: 'SQLite (Local)',          authType: 'none',   fields: ['path'],                   free: true,  docs: 'https://sqlite.org' },
    ],
  },
  news_sentiment: {
    label:       'News & Sentiment',
    icon:        '📰',
    description: 'News feeds, social sentiment, and NLP data sources',
    multiple:    true,
    providers: [
      { id: 'newsapi',    name: 'NewsAPI',                 authType: 'apikey', fields: ['apiKey'],                 free: true,  docs: 'https://newsapi.org/docs' },
      { id: 'polygon_news', name: 'Polygon News',         authType: 'apikey', fields: ['apiKey'],                 free: true,  docs: 'https://polygon.io/docs/stocks/get_v2_reference_news' },
      { id: 'finnhub_news', name: 'Finnhub News',         authType: 'apikey', fields: ['apiKey'],                 free: true,  docs: 'https://finnhub.io/docs/api/company-news' },
    ],
  },
  macro_economic: {
    label:       'Macro / Economic',
    icon:        '🏦',
    description: 'GDP, inflation, interest rates, central bank data',
    multiple:    true,
    providers: [
      { id: 'fred',       name: 'FRED (Federal Reserve)',  authType: 'apikey', fields: ['apiKey'],                 free: true,  docs: 'https://fred.stlouisfed.org/docs/api' },
      { id: 'world_bank', name: 'World Bank',              authType: 'none',   fields: [],                         free: true,  docs: 'https://datahelpdesk.worldbank.org' },
    ],
  },
  image_wallpaper: {
    label:       'Image / Wallpaper',
    icon:        '🖼',
    description: 'Image search APIs for JARVIS theme generation',
    multiple:    true,
    providers: [
      { id: 'unsplash',   name: 'Unsplash',                authType: 'apikey', fields: ['apiKey'],                 free: true,  docs: 'https://unsplash.com/developers' },
      { id: 'pexels',     name: 'Pexels',                  authType: 'apikey', fields: ['apiKey'],                 free: true,  docs: 'https://www.pexels.com/api' },
      { id: 'pixabay',    name: 'Pixabay',                 authType: 'apikey', fields: ['apiKey'],                 free: true,  docs: 'https://pixabay.com/api/docs' },
    ],
  },
  notifications: {
    label:       'Notifications',
    icon:        '🔔',
    description: 'Push notifications, email, and webhook alerts',
    multiple:    true,
    providers: [
      { id: 'telegram',   name: 'Telegram Bot',            authType: 'apikey', fields: ['botToken','chatId'],      free: true,  docs: 'https://core.telegram.org/bots/api' },
      { id: 'email_smtp', name: 'Email (SMTP)',            authType: 'conn',   fields: ['host','port','user','password','from'], free: false, docs: '' },
      { id: 'webhook',    name: 'Webhook',                 authType: 'none',   fields: ['url','secret'],           free: true,  docs: '' },
    ],
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function globalPath(category) {
  return `system/integrations/global/${category}`
}

function userPath(userId, category) {
  return `system/integrations/users/${userId}/${category}`
}

function maskSecrets(config) {
  if (!config) return config
  const MASK_FIELDS = ['apiKey', 'apiSecret', 'password', 'botToken', 'secret', 'uri']
  const masked = { ...config }
  if (masked.providers) {
    masked.providers = masked.providers.map(p => {
      const mp = { ...p }
      for (const f of MASK_FIELDS) {
        if (mp[f] && typeof mp[f] === 'string' && mp[f].length > 4) {
          mp[f] = mp[f].slice(0, 4) + '•'.repeat(Math.min(mp[f].length - 4, 20))
        }
      }
      return mp
    })
  }
  return masked
}

// ── GET /api/configurator/schema ──────────────────────────────────────────────

router.get('/schema', (req, res) => {
  res.json({ schema: INTEGRATION_SCHEMA, categories: Object.keys(INTEGRATION_SCHEMA) })
})

// ── GET /api/configurator/integrations ───────────────────────────────────────

router.get('/integrations', (req, res) => {
  const result = {}
  for (const category of Object.keys(INTEGRATION_SCHEMA)) {
    const stored = readSecure(globalPath(category)) ?? { providers: [], enabled: [] }
    result[category] = {
      ...INTEGRATION_SCHEMA[category],
      config:  maskSecrets(stored),
      enabled: stored.enabled ?? [],
    }
  }
  res.json({ ok: true, integrations: result })
})

// ── GET /api/configurator/integrations/:category ─────────────────────────────

router.get('/integrations/:category', (req, res) => {
  const { category } = req.params
  if (!INTEGRATION_SCHEMA[category]) return res.status(404).json({ error: 'Unknown category' })
  const stored = readSecure(globalPath(category)) ?? { providers: [], enabled: [] }
  res.json({
    ok:       true,
    category,
    schema:   INTEGRATION_SCHEMA[category],
    config:   maskSecrets(stored),
    enabled:  stored.enabled ?? [],
  })
})

// ── PUT /api/configurator/integrations/:category ─────────────────────────────
// Save full category config (array of provider configs + enabled list)

router.put('/integrations/:category', (req, res) => {
  const { category } = req.params
  if (!INTEGRATION_SCHEMA[category]) return res.status(404).json({ error: 'Unknown category' })

  const { providers = [], enabled = [] } = req.body
  if (!Array.isArray(providers)) return res.status(400).json({ error: 'providers must be array' })

  // Validate provider IDs against schema
  const validIds = INTEGRATION_SCHEMA[category].providers.map(p => p.id)
  for (const p of providers) {
    if (p.id && !validIds.includes(p.id)) {
      return res.status(400).json({ error: `Unknown provider: ${p.id}` })
    }
  }

  // Read existing to preserve secrets that weren't re-submitted (masked)
  const existing = readSecure(globalPath(category)) ?? { providers: [], enabled: [] }
  const existingMap = Object.fromEntries((existing.providers ?? []).map(p => [p.id, p]))

  // Merge: keep existing secrets if new value is masked (starts with first 4 chars + bullets)
  const merged = providers.map(p => {
    const ex = existingMap[p.id] ?? {}
    const merged_p = { ...ex, ...p }
    // Restore masked fields from existing
    const MASK_FIELDS = ['apiKey', 'apiSecret', 'password', 'botToken', 'secret', 'uri']
    for (const f of MASK_FIELDS) {
      if (p[f] && typeof p[f] === 'string' && p[f].includes('•')) {
        merged_p[f] = ex[f] ?? p[f]  // keep existing secret
      }
    }
    return merged_p
  })

  const record = {
    providers: merged,
    enabled:   enabled.filter(id => validIds.includes(id)),
    updatedAt: new Date().toISOString(),
    updatedBy: req.user?.userId,
  }

  writeSecure(globalPath(category), record)

  // Sync to .env-style in-memory (so running server picks up changes)
  _syncToEnv(category, merged, enabled)

  res.json({ ok: true, category, enabled: record.enabled, count: merged.length })
})

// ── DELETE /api/configurator/integrations/:category/:providerId ──────────────

router.delete('/integrations/:category/:providerId', (req, res) => {
  const { category, providerId } = req.params
  if (!INTEGRATION_SCHEMA[category]) return res.status(404).json({ error: 'Unknown category' })

  const existing = readSecure(globalPath(category)) ?? { providers: [], enabled: [] }
  existing.providers = (existing.providers ?? []).filter(p => p.id !== providerId)
  existing.enabled   = (existing.enabled   ?? []).filter(id => id !== providerId)
  existing.updatedAt = new Date().toISOString()

  writeSecure(globalPath(category), existing)
  res.json({ ok: true, removed: providerId })
})

// ── GET /api/configurator/integrations/user/:userId ──────────────────────────

router.get('/integrations/user/:userId', (req, res) => {
  const { userId } = req.params
  const overrides = {}
  for (const category of Object.keys(INTEGRATION_SCHEMA)) {
    const stored = readSecure(userPath(userId, category))
    if (stored) overrides[category] = maskSecrets(stored)
  }
  res.json({ ok: true, userId, overrides })
})

// ── PUT /api/configurator/integrations/user/:userId/:category ────────────────

router.put('/integrations/user/:userId/:category', (req, res) => {
  const { userId, category } = req.params
  if (!INTEGRATION_SCHEMA[category]) return res.status(404).json({ error: 'Unknown category' })

  const { providers = [], enabled = [] } = req.body
  const record = { providers, enabled, updatedAt: new Date().toISOString(), setBy: req.user?.userId }
  writeSecure(userPath(userId, category), record)
  res.json({ ok: true, userId, category })
})

// ── DELETE /api/configurator/integrations/user/:userId/:category ─────────────

router.delete('/integrations/user/:userId/:category', (req, res) => {
  const { userId, category } = req.params
  deleteSecure(userPath(userId, category))
  res.json({ ok: true, removed: true })
})

// ── POST /api/configurator/integrations/:category/test ───────────────────────

router.post('/integrations/:category/test', async (req, res) => {
  const { category } = req.params
  const { providerId } = req.body

  const stored = readSecure(globalPath(category)) ?? { providers: [] }
  const provider = (stored.providers ?? []).find(p => p.id === providerId)
  if (!provider) return res.status(404).json({ error: 'Provider not configured' })

  const result = await _testProvider(category, provider)
  res.json(result)
})

// ── Sync to process.env (so running server picks up new keys) ─────────────────

function _syncToEnv(category, providers, enabled) {
  for (const p of providers) {
    if (!enabled.includes(p.id)) continue
    // Map provider fields to env var names
    const envMap = {
      openai:       { apiKey: 'OPENAI_API_KEY', orgId: 'OPENAI_ORG_ID' },
      anthropic:    { apiKey: 'ANTHROPIC_API_KEY' },
      gemini:       { apiKey: 'GEMINI_API_KEY' },
      groq:         { apiKey: 'GROQ_API_KEY' },
      xai:          { apiKey: 'XAI_API_KEY' },
      deepseek:     { apiKey: 'DEEPSEEK_API_KEY' },
      mistral:      { apiKey: 'MISTRAL_API_KEY' },
      together:     { apiKey: 'TOGETHER_API_KEY' },
      perplexity:   { apiKey: 'PERPLEXITY_API_KEY' },
      cohere:       { apiKey: 'COHERE_API_KEY' },
      openrouter:   { apiKey: 'OPENROUTER_API_KEY' },
      finnhub:      { apiKey: 'FINNHUB_KEY' },
      alpha_vantage:{ apiKey: 'ALPHA_VANTAGE_KEY' },
      twelve_data:  { apiKey: 'TWELVE_DATA_KEY' },
      newsapi:      { apiKey: 'NEWSAPI_KEY' },
      fred:         { apiKey: 'FRED_API_KEY' },
      unsplash:     { apiKey: 'UNSPLASH_API_KEY' },
      pexels:       { apiKey: 'PEXELS_API_KEY' },
      pixabay:      { apiKey: 'PIXABAY_API_KEY' },
      mongodb:      { uri: 'MONGODB_ATLAS_URI' },
      telegram:     { botToken: 'TELEGRAM_BOT_TOKEN', chatId: 'TELEGRAM_CHAT_ID' },
    }
    const mapping = envMap[p.id] ?? {}
    for (const [field, envVar] of Object.entries(mapping)) {
      if (p[field] && !p[field].includes('•')) {
        process.env[envVar] = p[field]
      }
    }
  }
}

// ── Test provider connection ──────────────────────────────────────────────────

async function _testProvider(category, provider) {
  const start = Date.now()
  try {
    if (category === 'market_data' && provider.id === 'yahoo_finance') {
      const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=1d&range=1d', { signal: AbortSignal.timeout(5000) })
      return { ok: r.ok, latency_ms: Date.now() - start, status: r.status, provider: provider.id }
    }
    if (category === 'market_data' && provider.id === 'finnhub' && provider.apiKey) {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${provider.apiKey}`, { signal: AbortSignal.timeout(5000) })
      return { ok: r.ok, latency_ms: Date.now() - start, status: r.status, provider: provider.id }
    }
    if (category === 'ai_llm' && provider.id === 'openai' && provider.apiKey) {
      const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${provider.apiKey}` }, signal: AbortSignal.timeout(8000) })
      return { ok: r.ok, latency_ms: Date.now() - start, status: r.status, provider: provider.id }
    }
    if (category === 'ai_llm' && provider.id === 'anthropic' && provider.apiKey) {
      const r = await fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(8000) })
      return { ok: r.ok, latency_ms: Date.now() - start, status: r.status, provider: provider.id }
    }
    if (category === 'ai_llm' && provider.id === 'gemini' && provider.apiKey) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${provider.apiKey}`, { signal: AbortSignal.timeout(8000) })
      return { ok: r.ok, latency_ms: Date.now() - start, status: r.status, provider: provider.id }
    }
    if (category === 'ai_llm' && provider.id === 'groq' && provider.apiKey) {
      const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${provider.apiKey}` }, signal: AbortSignal.timeout(8000) })
      return { ok: r.ok, latency_ms: Date.now() - start, status: r.status, provider: provider.id }
    }
    if (category === 'ai_llm' && provider.id === 'xai' && provider.apiKey) {
      const r = await fetch('https://api.x.ai/v1/models', { headers: { Authorization: `Bearer ${provider.apiKey}` }, signal: AbortSignal.timeout(8000) })
      return { ok: r.ok, latency_ms: Date.now() - start, status: r.status, provider: provider.id }
    }
    if (category === 'ai_llm' && provider.id === 'deepseek' && provider.apiKey) {
      const r = await fetch('https://api.deepseek.com/models', { headers: { Authorization: `Bearer ${provider.apiKey}` }, signal: AbortSignal.timeout(8000) })
      return { ok: r.ok, latency_ms: Date.now() - start, status: r.status, provider: provider.id }
    }
    if (category === 'ai_llm' && provider.id === 'mistral' && provider.apiKey) {
      const r = await fetch('https://api.mistral.ai/v1/models', { headers: { Authorization: `Bearer ${provider.apiKey}` }, signal: AbortSignal.timeout(8000) })
      return { ok: r.ok, latency_ms: Date.now() - start, status: r.status, provider: provider.id }
    }
    if (category === 'ai_llm' && provider.id === 'together' && provider.apiKey) {
      const r = await fetch('https://api.together.ai/v1/models', { headers: { Authorization: `Bearer ${provider.apiKey}` }, signal: AbortSignal.timeout(8000) })
      return { ok: r.ok, latency_ms: Date.now() - start, status: r.status, provider: provider.id }
    }
    if (category === 'ai_llm' && provider.id === 'openrouter' && provider.apiKey) {
      const r = await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${provider.apiKey}` }, signal: AbortSignal.timeout(8000) })
      return { ok: r.ok, latency_ms: Date.now() - start, status: r.status, provider: provider.id }
    }
    if (category === 'ai_llm' && provider.id === 'cohere' && provider.apiKey) {
      const r = await fetch('https://api.cohere.com/v1/models', { headers: { Authorization: `Bearer ${provider.apiKey}` }, signal: AbortSignal.timeout(8000) })
      return { ok: r.ok, latency_ms: Date.now() - start, status: r.status, provider: provider.id }
    }
    if (category === 'ai_llm' && provider.id === 'ollama') {
      const base = provider.baseUrl || 'http://localhost:11434'
      const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) })
      return { ok: r.ok, latency_ms: Date.now() - start, status: r.status, provider: provider.id }
    }
    if (category === 'database' && provider.id === 'mongodb' && provider.uri) {
      const { MongoClient } = await import('mongodb')
      const client = new MongoClient(provider.uri, { serverSelectionTimeoutMS: 5000 })
      await client.connect()
      await client.db().command({ ping: 1 })
      await client.close()
      return { ok: true, latency_ms: Date.now() - start, provider: provider.id }
    }
    // Generic: just return ok for providers without test logic
    return { ok: true, latency_ms: Date.now() - start, provider: provider.id, note: 'No test available — assumed OK' }
  } catch (err) {
    return { ok: false, latency_ms: Date.now() - start, provider: provider.id, error: err.message }
  }
}

export default router
