/**
 * Auth routes — login, logout, session, keygen, password change.
 *
 * POST /api/auth/login/step1          — username + password
 * POST /api/auth/login/step2          — 12-digit key
 * POST /api/auth/logout               — invalidate session
 * GET  /api/auth/me                   — current session info
 * POST /api/auth/keygen               — generate key (requires password re-auth)
 * POST /api/auth/change-password      — change own password
 */

import { Router } from 'express'
import {
  loginStep1, loginStep2, logout, validateSession,
  generateAccessKey, changePassword, getUserById,
  validatePasswordStrength, validateStepToken,
} from '../services/authService.js'
import { requireAuth } from '../middleware/auth.js'
import { stripHtml } from '../utils/sanitize.js'
import argon2 from 'argon2'

const router = Router()

// POST /api/auth/login/step1
router.post('/login/step1', async (req, res) => {
  const username = stripHtml(String(req.body.username ?? '').trim().toLowerCase())
  const password = String(req.body.password ?? '')

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' })
  }
  // Reject suspiciously long inputs
  if (username.length > 64 || password.length > 256) {
    return res.status(400).json({ error: 'Invalid input' })
  }

  const result = await loginStep1(username, password)
  if (!result.ok) return res.status(401).json({ error: result.error })

  res.json({
    stepToken:          result.stepToken,
    mustChangePassword: result.mustChangePassword,
  })
})

// POST /api/auth/login/step2
router.post('/login/step2', (req, res) => {
  const stepToken = String(req.body.stepToken ?? '')
  const key       = String(req.body.key ?? '').replace(/[^0-9\-]/g, '')

  if (!stepToken || !key) {
    return res.status(400).json({ error: 'Step token and key required' })
  }
  if (stepToken.length !== 64) {
    return res.status(400).json({ error: 'Invalid step token' })
  }

  const result = loginStep2(stepToken, key)
  if (!result.ok) return res.status(401).json({ error: result.error })

  res.json({
    sessionToken:       result.sessionToken,
    user:               result.user,
    mustChangePassword: result.user.mustChangePassword,
  })
})

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const token = req.headers['x-session-token']
  if (token) logout(token)
  res.json({ ok: true })
})

// GET /api/auth/me
router.get('/me', (req, res) => {
  const token = req.headers['x-session-token']
  if (!token) return res.status(401).json({ error: 'No session' })
  const session = validateSession(token)
  if (!session) return res.status(401).json({ error: 'Invalid session' })
  res.json(session)
})

// POST /api/auth/keygen
// Generates a new 12-digit access key for the authenticated user.
// Requires password re-verification as a second factor.
router.post('/keygen', requireAuth, async (req, res) => {
  const password  = String(req.body.password ?? '')
  const daysValid = Math.min(Number(req.body.daysValid ?? 30), 365)

  if (!password) {
    return res.status(400).json({ error: 'Password required to generate key' })
  }

  // Re-verify password before issuing a new key
  const user = getUserById(req.user.userId)
  if (!user) return res.status(404).json({ error: 'User not found' })

  const valid = await argon2.verify(user.passwordHash, password)
  if (!valid) return res.status(401).json({ error: 'Incorrect password' })

  const result = generateAccessKey(req.user.userId, daysValid)
  if (!result.ok) return res.status(500).json({ error: result.error })

  // Key is returned ONCE — never stored in plaintext
  res.json({
    key:       result.key,
    expiresAt: result.expiresAt,
    note:      'Save this key — it will not be shown again.',
  })
})

// POST /api/auth/keygen-with-step-token
router.post('/keygen-with-step-token', async (req, res) => {
  const stepToken = String(req.body.stepToken ?? '')
  // Validity fixed at 7 days max
  const DAYS_VALID = 7

  if (!stepToken || stepToken.length !== 64) {
    return res.status(400).json({ error: 'Valid step token required' })
  }

  const sess = validateStepToken(stepToken)
  if (!sess) {
    return res.status(401).json({ error: 'Step token expired or invalid — go back and log in again' })
  }

  const result = generateAccessKey(sess.userId, DAYS_VALID)
  if (!result.ok) return res.status(500).json({ error: result.error })

  res.json({
    key:       result.key,
    username:  sess.username,
    expiresAt: result.expiresAt,
    note:      'Save this key — it will not be shown again. Enter it below to continue.',
  })
})

// POST /api/auth/keygen-with-credentials
// Generates a key using username + password directly.
// Used when the user has no stepToken (first-time, expired, or direct access).
router.post('/keygen-with-credentials', async (req, res) => {
  // Sanitize: strip HTML, trim whitespace, lowercase
  const rawUsername = String(req.body.username ?? '')
  const username    = stripHtml(rawUsername).trim().toLowerCase().replace(/\s/g, '')
  const password    = String(req.body.password ?? '')

  // Validity is fixed at 7 days max — no user choice
  const DAYS_VALID = 7

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' })
  }
  if (username.length > 64 || password.length > 256) {
    return res.status(400).json({ error: 'Invalid input' })
  }

  // Verify credentials — loginStep1 returns a stepToken if valid
  const step1 = await loginStep1(username, password)
  if (!step1.ok) return res.status(401).json({ error: step1.error })

  // Use the stepToken to get the verified userId (avoids second username lookup)
  const sess = validateStepToken(step1.stepToken)
  if (!sess) {
    return res.status(500).json({ error: 'Internal error — please retry' })
  }

  // Generate key using the verified userId from the session
  const result = generateAccessKey(sess.userId, DAYS_VALID)
  if (!result.ok) return res.status(500).json({ error: result.error })

  res.json({
    key:       result.key,
    username:  sess.username,
    expiresAt: result.expiresAt,
    stepToken: step1.stepToken,   // fresh stepToken so login can continue
    note:      'Save this key — it will not be shown again. Enter it below to continue.',
  })
})
// Self-service password change. Requires current password.
router.post('/change-password', requireAuth, async (req, res) => {
  const currentPassword = String(req.body.currentPassword ?? '')
  const newPassword     = String(req.body.newPassword ?? '')

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password required' })
  }

  const pwCheck = validatePasswordStrength(newPassword)
  if (!pwCheck.ok) return res.status(400).json({ error: pwCheck.error })

  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'New password must be different from current password' })
  }

  const result = await changePassword(req.user.userId, currentPassword, newPassword, false)
  if (!result.ok) return res.status(400).json({ error: result.error })

  res.json({ ok: true, message: 'Password changed. Please log in again.' })
})

export default router
