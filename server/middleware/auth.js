/**
 * auth.js — Express middleware for session-based auth.
 *
 * Security:
 *   - Token read from x-session-token header only (never query string)
 *   - Token format validated before lookup (64 hex chars)
 *   - Role checked server-side on every request
 *   - No information leakage in error messages
 */

import { validateSession } from '../services/authService.js'

const TOKEN_REGEX = /^[0-9a-f]{64}$/i

function extractToken(req) {
  const token = req.headers['x-session-token']
  if (!token || typeof token !== 'string') return null
  if (!TOKEN_REGEX.test(token)) return null
  return token
}

/**
 * Require a valid fully-authenticated session (step 2).
 */
export function requireAuth(req, res, next) {
  const token = extractToken(req)
  if (!token) return res.status(401).json({ error: 'Authentication required' })

  const session = validateSession(token)
  if (!session) return res.status(401).json({ error: 'Session expired or invalid' })

  req.user = session
  next()
}

/**
 * Require admin role.
 */
export function requireAdmin(req, res, next) {
  const token = extractToken(req)
  if (!token) return res.status(401).json({ error: 'Authentication required' })

  const session = validateSession(token)
  if (!session) return res.status(401).json({ error: 'Session expired or invalid' })
  if (session.role !== 'admin' && session.role !== 'super-admin') return res.status(403).json({ error: 'Admin access required' })

  req.user = session
  next()
}

/**
 * Require super-admin role.
 * Super-admins have all admin capabilities plus elevated privileges
 * (ghost mode, voice commands, codebase engineering).
 */
export function requireSuperAdmin(req, res, next) {
  const token = extractToken(req)
  if (!token) return res.status(401).json({ error: 'Authentication required' })

  const session = validateSession(token)
  if (!session) return res.status(401).json({ error: 'Session expired or invalid' })
  if (session.role !== 'super-admin') return res.status(403).json({ error: 'Super-admin access required' })

  req.user = session
  next()
}

/**
 * Require the requesting user to be either admin OR the target user.
 * Used for self-service endpoints (change password, update prefs).
 */
export function requireSelfOrAdmin(paramName = 'userId') {
  return (req, res, next) => {
    const token = extractToken(req)
    if (!token) return res.status(401).json({ error: 'Authentication required' })

    const session = validateSession(token)
    if (!session) return res.status(401).json({ error: 'Session expired or invalid' })

    const targetId = req.params[paramName]
    if (session.role !== 'admin' && session.userId !== targetId) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    req.user = session
    next()
  }
}
