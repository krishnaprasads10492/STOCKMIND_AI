/**
 * selfOptimizer.js — Self-improvement AI module routes.
 *
 * POST /api/self-optimizer/outcome   — record a prediction outcome
 * GET  /api/self-optimizer/health    — get health report + recommendations
 * POST /api/self-optimizer/optimize  — run optimization cycle (admin only)
 * POST /api/self-optimizer/approve   — approve/reject proposed changes (admin only)
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const AI_URL = process.env.AI_BACKEND_URL ?? 'http://localhost:8001'

async function aiGet(path, timeoutMs = 10_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${AI_URL}${path}`, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`AI: ${res.status}`)
    return await res.json()
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

async function aiPost(path, body, timeoutMs = 15_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${AI_URL}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`AI: ${res.status}`)
    return await res.json()
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

// POST /api/self-optimizer/outcome
router.post('/outcome', requireAuth, async (req, res) => {
  const { signal_id, symbol, predicted_prob, actual_outcome, regime } = req.body
  if (!signal_id || !symbol || predicted_prob == null || !actual_outcome) {
    return res.status(400).json({ error: 'signal_id, symbol, predicted_prob, actual_outcome required' })
  }
  const validOutcomes = ['T1_HIT', 'T2_HIT', 'T3_HIT', 'SL_HIT', 'TIMEOUT']
  if (!validOutcomes.includes(actual_outcome)) {
    return res.status(400).json({ error: `actual_outcome must be one of: ${validOutcomes.join(', ')}` })
  }
  try {
    const result = await aiPost('/self-optimizer/outcome', { signal_id, symbol, predicted_prob, actual_outcome, regime: regime ?? 'trending' })
    res.json(result)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// GET /api/self-optimizer/health
router.get('/health', requireAuth, async (req, res) => {
  try {
    const result = await aiGet('/self-optimizer/health')
    res.json(result)
  } catch {
    res.status(503).json({
      error: 'AI backend unavailable',
      status: 'UNKNOWN',
      performance: { rolling_accuracy_pct: null, ece_pct: null, outcomes_tracked: 0 },
      recommendations: [],
    })
  }
})

// POST /api/self-optimizer/optimize — admin only
router.post('/optimize', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
  try {
    const result = await aiPost('/self-optimizer/optimize', {})
    res.json(result)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

// POST /api/self-optimizer/approve — admin only
router.post('/approve', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const { cycle, approved, params } = req.body
  try {
    const result = await aiPost('/self-optimizer/approve', { cycle, approved, params })
    res.json(result)
  } catch {
    res.status(503).json({ error: 'AI backend unavailable' })
  }
})

export default router
