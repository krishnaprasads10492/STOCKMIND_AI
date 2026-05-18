/**
 * @fileoverview Input sanitization utilities.
 *
 * Prevents XSS and injection attacks (Section 16.6.1).
 * All user-supplied strings must pass through these before rendering or API use.
 */

/** Characters allowed in a stock ticker symbol */
const TICKER_PATTERN = /^[A-Z0-9.\-]{1,20}$/

/**
 * Validates and normalises a stock ticker symbol.
 * Rejects anything that doesn't match the allow-list pattern.
 *
 * @param {string} raw
 * @returns {{ ok: true; value: string } | { ok: false; error: string }}
 */
export function sanitizeTicker(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Ticker must be a string' }
  }
  const upper = raw.trim().toUpperCase()
  if (!TICKER_PATTERN.test(upper)) {
    return { ok: false, error: `Invalid ticker: "${raw}"` }
  }
  return { ok: true, value: upper }
}

/**
 * Strips HTML tags from a string to prevent XSS when rendering user content.
 *
 * @param {string} raw
 * @returns {string}
 */
export function stripHtml(raw) {
  if (typeof raw !== 'string') return ''
  return raw.replace(/<[^>]*>/g, '')
}

/**
 * Validates that a URL belongs to an allowed origin list (SSRF prevention).
 * Section 16.6.1 — no user-controlled URLs.
 *
 * @param {string} url
 * @param {string[]} allowedOrigins
 * @returns {boolean}
 */
export function isAllowedOrigin(url, allowedOrigins) {
  try {
    const { origin } = new URL(url)
    return allowedOrigins.includes(origin)
  } catch {
    return false
  }
}
