/**
 * User management routes.
 *
 * GET    /api/users                          — list all users (admin)
 * POST   /api/users                          — create user (admin)
 * PATCH  /api/users/:userId/preferences      — update preferences (self or admin)
 * PATCH  /api/users/:userId/activate         — reactivate user (admin)
 * DELETE /api/users/:userId                  — deactivate user (admin)
 * POST   /api/users/:userId/keygen           — generate key for user (admin)
 * POST   /api/users/:userId/reset-password   — admin reset password
 */

import { Router } from 'express'
import { requireAdmin, requireAuth, requireSelfOrAdmin } from '../middleware/auth.js'
import {
  createUser, getAllUsers, getUserById,
  updatePreferences, deactivateUser, reactivateUser,
  generateAccessKey, adminResetPassword, validatePasswordStrength,
} from '../services/authService.js'
import { stripHtml } from '../utils/sanitize.js'

const router = Router()

// GET /api/users — list all users (admin)
router.get('/', requireAdmin, (_req, res) => {
  const users = getAllUsers().map(u => ({
    userId:            u.userId,
    username:          u.username,
    role:              u.role,
    isActive:          u.isActive,
    createdAt:         u.createdAt,
    lastLoginAt:       u.lastLoginAt,
    loginCount:        u.loginCount ?? 0,
    mustChangePassword: u.mustChangePassword ?? false,
    hasKey:            !!u.keyHash,
    keyExpiresAt:      u.keyExpiresAt ?? null,
    preferences:       u.preferences,
  }))
  res.json(users)
})

// POST /api/users — create user (admin)
router.post('/', requireAdmin, async (req, res) => {
  const username = stripHtml(String(req.body.username ?? '').trim().toLowerCase())
  const password = String(req.body.password ?? '')
  const role     = req.body.role === 'admin' ? 'admin' : 'user'

  const pwCheck = validatePasswordStrength(password)
  if (!pwCheck.ok) return res.status(400).json({ error: pwCheck.error })

  const result = await createUser(
    { username, password, role, mustChangePassword: true },
    req.user.userId
  )
  if (!result.ok) return res.status(400).json({ error: result.error })
  res.status(201).json({ ok: true, userId: result.userId })
})

// PATCH /api/users/:userId/preferences — update preferences (self or admin)
router.patch('/:userId/preferences', requireSelfOrAdmin('userId'), (req, res) => {
  const result = updatePreferences(req.params.userId, req.body)
  if (!result.ok) return res.status(400).json({ error: result.error })
  res.json({ ok: true, preferences: result.preferences })
})

// PATCH /api/users/:userId/activate — reactivate (admin)
router.patch('/:userId/activate', requireAdmin, (req, res) => {
  const result = reactivateUser(req.params.userId)
  if (!result.ok) return res.status(400).json({ error: result.error })
  res.json({ ok: true })
})

// DELETE /api/users/:userId — deactivate (admin)
router.delete('/:userId', requireAdmin, (req, res) => {
  // Prevent admin from deactivating themselves
  if (req.params.userId === req.user.userId) {
    return res.status(400).json({ error: 'Cannot deactivate your own account' })
  }
  const result = deactivateUser(req.params.userId)
  if (!result.ok) return res.status(400).json({ error: result.error })
  res.json({ ok: true })
})

// POST /api/users/:userId/keygen — generate key for user (admin)
router.post('/:userId/keygen', requireAdmin, (req, res) => {
  const daysValid = Math.min(Number(req.body.daysValid ?? 30), 365)
  const user = getUserById(req.params.userId)
  if (!user) return res.status(404).json({ error: 'User not found' })

  const result = generateAccessKey(req.params.userId, daysValid)
  if (!result.ok) return res.status(500).json({ error: result.error })

  res.json({
    ok:        true,
    username:  user.username,
    key:       result.key,
    expiresAt: result.expiresAt,
    note:      'Save this key — it will not be shown again.',
  })
})

// POST /api/users/:userId/reset-password — admin reset (sets mustChangePassword)
router.post('/:userId/reset-password', requireAdmin, async (req, res) => {
  const newPassword = String(req.body.newPassword ?? '')

  const pwCheck = validatePasswordStrength(newPassword)
  if (!pwCheck.ok) return res.status(400).json({ error: pwCheck.error })

  const result = await adminResetPassword(req.params.userId, newPassword)
  if (!result.ok) return res.status(400).json({ error: result.error })

  res.json({ ok: true, message: 'Password reset. User must change it on next login.' })
})

export default router
