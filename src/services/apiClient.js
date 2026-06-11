/**
 * @fileoverview Base API client with circuit-breaker, retry, rate-limit handling,
 * and automatic session token injection from localStorage.
 */

const DEFAULT_TIMEOUT_MS = 8_000
const MAX_RETRIES        = 2
const RETRY_BASE_DELAY   = 200

const circuitState = new Map()
const CIRCUIT_FAILURE_THRESHOLD = 4
const CIRCUIT_OPEN_DURATION_MS  = 20_000

const TOKEN_KEY = 'sm_session'

/** Read the session token from localStorage (works in browser only). */
function getStoredToken() {
  try { return localStorage.getItem(TOKEN_KEY) ?? null } catch { return null }
}

/**
 * Resolve a URL to an absolute URL so new URL() never throws on relative paths.
 * In the browser, relative paths are resolved against window.location.origin.
 * @param {string} url
 * @returns {string}
 */
function toAbsolute(url) {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  // Relative path — prepend the current origin (works in browser + Vite proxy)
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4098'
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`
}

function getOrigin(url) {
  try {
    return new URL(toAbsolute(url)).origin
  } catch {
    return url
  }
}

function isCircuitOpen(origin) {
  const state = circuitState.get(origin)
  if (!state) return false
  if (state.openUntil > Date.now()) return true
  circuitState.delete(origin)
  return false
}

function recordFailure(origin) {
  const state = circuitState.get(origin) ?? { failures: 0, openUntil: 0 }
  state.failures += 1
  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + CIRCUIT_OPEN_DURATION_MS
  }
  circuitState.set(origin, state)
}

function recordSuccess(origin) {
  circuitState.delete(origin)
}

function backoff(attempt) {
  return new Promise(resolve => setTimeout(resolve, RETRY_BASE_DELAY * Math.pow(2, attempt)))
}

/**
 * Core fetch wrapper with timeout, retry, and circuit-breaker.
 * Accepts both absolute and relative URLs.
 *
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} [options]
 * @returns {Promise<Response>}
 */
export async function apiFetch(url, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options
  const origin = getOrigin(url)

  if (isCircuitOpen(origin)) {
    throw new ApiError('Service temporarily unavailable', 503, url)
  }

  let lastError

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          // Auto-inject session token — callers don't need to pass it manually.
          // Explicit header in fetchOptions.headers takes precedence if provided.
          ...(getStoredToken() ? { 'x-session-token': getStoredToken() } : {}),
          ...fetchOptions.headers,
        },
      })

      clearTimeout(timer)

      if (response.status === 429) {
        await backoff(attempt)
        continue
      }

      if (!response.ok) {
        // Try to get error message from response body
        let message = `HTTP ${response.status}`
        try {
          const body = await response.clone().json()
          if (body.error) message = body.error
        } catch { /* ignore */ }

        // 401 — token is invalid/expired. Clear it so the user gets redirected to login.
        if (response.status === 401) {
          try {
            localStorage.removeItem(TOKEN_KEY)
            localStorage.removeItem('sm_user')
          } catch { /* ignore */ }
        }

        throw new ApiError(message, response.status, url)
      }

      recordSuccess(origin)
      return response

    } catch (err) {
      clearTimeout(timer)
      lastError = err

      // Don't retry 4xx client errors
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        recordFailure(origin)
        throw err
      }

      recordFailure(origin)
      if (attempt < MAX_RETRIES - 1) await backoff(attempt)
    }
  }

  throw lastError ?? new ApiError('Request failed', 0, url)
}

export class ApiError extends Error {
  constructor(message, status, url) {
    super(message)
    this.name   = 'ApiError'
    this.status = status
    this.url    = url
  }
}
