/**
 * useJarvisCommander — Universal app controller via JARVIS NLU.
 *
 * Converts any free-form voice/text input into app actions.
 * Both voice commands and typed messages flow through here.
 *
 * Architecture:
 *   1. Input (voice transcript or typed text)
 *   2. NLU intent extraction (local fast-path for common commands)
 *   3. If unrecognised → JARVIS brain chat for full NLP
 *   4. Action object dispatched to the calling component
 *   5. AppShell executes: navigate, setSymbol, setModule, runPrediction, etc.
 *
 * Supported actions:
 *   navigate         → go to any page
 *   setSymbol        → change active symbol
 *   setModule        → change market module
 *   generateSignals  → run predictions
 *   setTheme         → change UI theme
 *   setNightLight    → adjust night light
 *   setChartInterval → change chart timeframe
 *   addFavourite     → star a symbol
 *   runBacktest      → trigger backtest
 *   systemScan       → health/deps/code scan
 *   openModal        → keygen, password change
 *   speak            → JARVIS speaks back via TTS
 *   chat             → free-form JARVIS response
 */

import { useCallback, useRef } from 'react'
import { useAuthStore } from '@store/authStore.js'
import { MARKET_MODULES } from '@store/marketStore.js'
import { brainChat } from '@services/jarvisClient.js'

// ── Local fast-path NLU ───────────────────────────────────────────────────────
// These patterns are checked BEFORE sending to the AI backend.
// Order matters — more specific patterns first.

const LOCAL_PATTERNS = [
  // Navigation
  { re: /\b(go to|open|show|navigate to|take me to)\b.*\b(dashboard|home)\b/i,        action: () => ({ type: 'navigate', to: '/dashboard' }) },
  { re: /\b(go to|open|show|navigate to|take me to)\b.*\b(predict|predictions?|signals?)\b/i, action: () => ({ type: 'navigate', to: '/predictions' }) },
  { re: /\b(go to|open|show|navigate to|take me to)\b.*\b(chart|charts?)\b/i,          action: () => ({ type: 'navigate', to: '/charts' }) },
  { re: /\b(go to|open|show|navigate to|take me to)\b.*\b(rama|ai console)\b/i,        action: () => ({ type: 'navigate', to: '/jarvis' }) },
  { re: /\b(go to|open|show|navigate to|take me to)\b.*\b(ami|advanced market|intelligence)\b/i, action: () => ({ type: 'navigate', to: '/ami' }) },
  { re: /\b(go to|open|show|navigate to|take me to)\b.*\b(multibagger|multi.bagger)\b/i, action: () => ({ type: 'navigate', to: '/multibagger' }) },
  { re: /\b(go to|open|show|navigate to|take me to)\b.*\b(backtest|back.test)\b/i,    action: () => ({ type: 'navigate', to: '/backtest' }) },
  { re: /\b(go to|open|show|navigate to|take me to)\b.*\b(strateg)\b/i,               action: () => ({ type: 'navigate', to: '/strategies' }) },
  { re: /\b(go to|open|show|navigate to|take me to)\b.*\b(settings?|setting)\b/i,     action: () => ({ type: 'navigate', to: '/settings' }) },
  { re: /\b(go to|open|show|navigate to|take me to)\b.*\b(history|past)\b/i,           action: () => ({ type: 'navigate', to: '/history' }) },
  { re: /\b(go to|open|show|navigate to|take me to)\b.*\b(learn|education)\b/i,        action: () => ({ type: 'navigate', to: '/learn' }) },
  { re: /\b(go to|open|show|navigate to|take me to)\b.*\b(favourites?|favorites?|starred)\b/i, action: () => ({ type: 'navigate', to: '/favourites' }) },
  { re: /\b(go to|open|show|navigate to|take me to)\b.*\b(admin|users?)\b/i,           action: () => ({ type: 'navigate', to: '/admin' }) },

  // Predict / generate signals
  { re: /\b(predict|generate signals?|run predict|get signals?|analyse|analyze)\b/i, action: (m, text) => {
    const sym = extractSymbol(text)
    return { type: 'generateSignals', symbol: sym }
  }},
  { re: /\b(what.s? the signal|signal for|prediction for|predictions? for)\b/i, action: (m, text) => {
    const sym = extractSymbol(text)
    return { type: 'generateSignals', symbol: sym }
  }},

  // Symbol selection
  { re: /\b(switch to|change to|select|load|show me)\b.*\b([A-Z]{2,10})\b/i, action: (m, text) => {
    const sym = extractSymbol(text)
    if (sym) return { type: 'setSymbol', symbol: sym }
    return null
  }},

  // Market module selection
  { re: /\b(crypto|bitcoin|btc|ethereum)\b/i,      action: () => ({ type: 'setModule', moduleId: 'crypto' }) },
  { re: /\b(nifty|sensex|banknifty|indian index|indian indices)\b/i, action: () => ({ type: 'setModule', moduleId: 'indices-india' }) },
  { re: /\b(gold|silver|crude|commodit)/i,          action: () => ({ type: 'setModule', moduleId: 'commodities' }) },
  { re: /\b(forex|usd|eur|inr|currency)\b/i,        action: () => ({ type: 'setModule', moduleId: 'forex' }) },
  { re: /\b(futures?|options?|fno|f&o)\b/i,          action: () => ({ type: 'setModule', moduleId: 'fno-india' }) },
  { re: /\b(global|s&p|nasdaq|dow|ftse)\b/i,        action: () => ({ type: 'setModule', moduleId: 'global-indices' }) },

  // Chart interval
  { re: /\b(1 minute|1m|one minute)\b/i,            action: () => ({ type: 'setChartInterval', interval: '1m' }) },
  { re: /\b(5 minute|5m|five minute)\b/i,            action: () => ({ type: 'setChartInterval', interval: '5m' }) },
  { re: /\b(15 minute|15m|fifteen)\b/i,              action: () => ({ type: 'setChartInterval', interval: '15m' }) },
  { re: /\b(30 minute|30m|half.?hour)\b/i,           action: () => ({ type: 'setChartInterval', interval: '30m' }) },
  { re: /\b(1 hour|1h|hourly)\b/i,                   action: () => ({ type: 'setChartInterval', interval: '1h' }) },
  { re: /\b(daily|1 day|1d)\b/i,                     action: () => ({ type: 'setChartInterval', interval: '1d' }) },
  { re: /\b(weekly|1 week|1w)\b/i,                   action: () => ({ type: 'setChartInterval', interval: '1wk' }) },
  { re: /\b(monthly|1 month|1m)\b/i,                 action: () => ({ type: 'setChartInterval', interval: '1mo' }) },

  // Theme
  { re: /\b(dark mode|dark theme)\b/i,               action: () => ({ type: 'setTheme', theme: 'cyber-dark' }) },
  { re: /\b(light mode|light theme)\b/i,             action: () => ({ type: 'setTheme', theme: 'light-clean' }) },
  { re: /\b(night light on|enable night light)\b/i,  action: () => ({ type: 'setNightLight', value: 40 }) },
  { re: /\b(night light off|disable night light)\b/i,action: () => ({ type: 'setNightLight', value: 0 }) },

  // System
  { re: /\b(system (health|status)|how.s the system|check system)\b/i, action: () => ({ type: 'systemScan', scanType: 'diagnostics' }) },
  { re: /\b(scan (dep|package)|dependency scan|check packages?)\b/i,   action: () => ({ type: 'systemScan', scanType: 'dependencies' }) },
  { re: /\b(code (health|quality)|scan code|check code)\b/i,            action: () => ({ type: 'systemScan', scanType: 'code_health' }) },

  // Modals
  { re: /\b(generate (key|access key)|new key|renew key)\b/i,  action: () => ({ type: 'openModal', modal: 'keygen' }) },
  { re: /\b(change password|update password|reset password)\b/i, action: () => ({ type: 'openModal', modal: 'changePassword' }) },

  // Backtest
  { re: /\b(run backtest|backtest|back.test)\b/i,    action: () => ({ type: 'navigate', to: '/backtest' }) },

  // Favourites
  { re: /\b(add to favourites?|star|favourite this|bookmark)\b/i, action: (m, text) => {
    const sym = extractSymbol(text)
    return { type: 'addFavourite', symbol: sym }
  }},

  // Fullscreen
  { re: /\b(fullscreen|full screen)\b/i,             action: () => ({ type: 'fullscreen' }) },

  // Help
  { re: /\b(what can (you|jarvis)|help|commands?|capabilities)\b/i, action: () => ({ type: 'chat', text: 'What can you do? List all voice commands and capabilities.' }) },
]

// ── Symbol extractor ──────────────────────────────────────────────────────────

const ALL_SYMBOLS = MARKET_MODULES.flatMap(m =>
  m.symbols.map(s => ({ symbol: s.symbol, label: s.label.toLowerCase(), exchange: m.exchange, moduleId: m.id }))
)

export function extractSymbol(text) {
  const upper = text.toUpperCase()
  // 1. Exact symbol match
  for (const s of ALL_SYMBOLS) {
    if (upper.includes(s.symbol)) return s.symbol
  }
  // 2. Label match (e.g. "bank nifty" → BANKNIFTY)
  const lower = text.toLowerCase()
  for (const s of ALL_SYMBOLS) {
    if (lower.includes(s.label)) return s.symbol
  }
  // 3. Common spoken aliases
  const aliases = {
    'nifty fifty': 'NIFTY50', 'nifty 50': 'NIFTY50', 'bank nifty': 'BANKNIFTY',
    'bitcoin': 'BTCUSDT', 'ethereum': 'ETHUSDT', 'gold': 'GOLD',
    'crude oil': 'CRUDEOIL', 'reliance': 'RELIANCE', 'tcs': 'TCS',
  }
  for (const [alias, sym] of Object.entries(aliases)) {
    if (lower.includes(alias)) return sym
  }
  return null
}

// ── Local NLU ─────────────────────────────────────────────────────────────────

function localNLU(text) {
  for (const { re, action } of LOCAL_PATTERNS) {
    const m = text.match(re)
    if (m) {
      const result = action(m, text)
      if (result) return result
    }
  }
  return null
}

// ── TTS speaker ───────────────────────────────────────────────────────────────

export function speak(text, options = {}) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  utter.rate   = options.rate   ?? 1.0
  utter.pitch  = options.pitch  ?? 1.0
  utter.volume = options.volume ?? 0.85
  utter.lang   = options.lang   ?? 'en-US'
  // Prefer a lower-pitched voice for JARVIS feel
  const voices = window.speechSynthesis.getVoices()
  const preferred = voices.find(v =>
    v.lang.startsWith('en') && (v.name.includes('Male') || v.name.includes('Google UK') || v.name.includes('Daniel'))
  )
  if (preferred) utter.voice = preferred
  window.speechSynthesis.speak(utter)
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useJarvisCommander({ onAction, token, enabled = true }) {
  const user      = useAuthStore(s => s.user)
  const role      = user?.role ?? 'user'
  const pendingRef = useRef(false)

  /**
   * Process any input (voice transcript or typed text).
   * Returns { action, response } where action is the app action to execute
   * and response is JARVIS's spoken/displayed reply.
   */
  const processInput = useCallback(async (text) => {
    if (!text?.trim() || !enabled || pendingRef.current) return null
    pendingRef.current = true

    try {
      // 1. Local fast-path — instant, no network
      const localAction = localNLU(text)
      if (localAction) {
        const reply = actionToSpeech(localAction, text)
        onAction?.(localAction, reply)
        speak(reply)
        return { action: localAction, response: reply }
      }

      // 2. JARVIS brain — full NLU for anything not caught locally
      let brainResult = null
      try {
        brainResult = await brainChat(
          `[JARVIS COMMAND MODE] User said: "${text}"\n\nRespond with:\n1. A brief spoken confirmation (1-2 sentences max, no markdown)\n2. The action to take\n\nIf this is a navigation request, market query, or app action, execute it. If it's a question, answer concisely.`,
          null,
          true,
          token
        )
      } catch { /* backend offline — use local fallback */ }

      if (brainResult?.response) {
        // Parse action from JARVIS response if it contains one
        const inferredAction = inferActionFromBrainResponse(brainResult.response, text)
        const reply = brainResult.response
          .replace(/\*\*/g, '').replace(/\*/g, '').replace(/#+\s*/g, '')
          .split('\n')[0].slice(0, 150)  // first sentence, no markdown, max 150 chars
        onAction?.(inferredAction, reply)
        speak(reply)
        return { action: inferredAction, response: reply }
      }

      // 3. Final fallback
      const fallback = "I didn't catch that. Try saying: go to predictions, predict NIFTY50, or open charts."
      speak(fallback)
      return { action: null, response: fallback }

    } finally {
      pendingRef.current = false
    }
  }, [enabled, token, onAction])

  return { processInput, extractSymbol, speak }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function actionToSpeech(action, originalText) {
  const symbolPart = action.symbol ? ` for ${action.symbol}` : ''
  switch (action.type) {
    case 'navigate':       return `Opening ${action.to.replace('/', '').replace('-', ' ')}.`
    case 'generateSignals':return `Generating signals${symbolPart}.`
    case 'setSymbol':      return `Switching to ${action.symbol}.`
    case 'setModule':      return `Switching market to ${action.moduleId?.replace('-', ' ')}.`
    case 'setChartInterval':return `Chart interval set to ${action.interval}.`
    case 'setTheme':       return `Theme changed.`
    case 'setNightLight':  return action.value > 0 ? `Night light on at ${action.value}%.` : `Night light off.`
    case 'systemScan':     return `Running ${action.scanType?.replace('_', ' ')} scan.`
    case 'openModal':      return `Opening ${action.modal?.replace(/([A-Z])/g, ' $1').toLowerCase()}.`
    case 'addFavourite':   return `Added ${action.symbol} to favourites.`
    case 'fullscreen':     return `Fullscreen mode.`
    default:               return `Got it.`
  }
}

function inferActionFromBrainResponse(response, originalText) {
  // Try to infer an action from the JARVIS response text
  const lower = response.toLowerCase()

  // Navigation hints in response
  if (lower.includes('predictions') || lower.includes('signals')) return { type: 'navigate', to: '/predictions' }
  if (lower.includes('chart'))       return { type: 'navigate', to: '/charts' }
  if (lower.includes('jarvis console') || lower.includes('jarvis page')) return { type: 'navigate', to: '/jarvis' }
  if (lower.includes('backtest'))    return { type: 'navigate', to: '/backtest' }

  // Symbol mentions
  const sym = extractSymbol(originalText)
  if (sym && (lower.includes('signal') || lower.includes('predict'))) {
    return { type: 'generateSignals', symbol: sym }
  }

  return { type: 'chat', text: originalText }
}
