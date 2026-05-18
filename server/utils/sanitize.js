/** Server-side input sanitization (mirrors src/utils/sanitize.js) */

const TICKER_PATTERN = /^[A-Z0-9.\-]{1,20}$/

export function sanitizeTicker(raw) {
  if (typeof raw !== 'string') return null
  const upper = raw.trim().toUpperCase()
  return TICKER_PATTERN.test(upper) ? upper : null
}

export function stripHtml(raw) {
  if (typeof raw !== 'string') return ''
  return raw.replace(/<[^>]*>/g, '').trim()
}
