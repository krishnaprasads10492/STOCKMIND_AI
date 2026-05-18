/**
 * @fileoverview useSystemHealth — polls the backend health endpoint.
 *
 * Drives the graceful degradation UI (Section 16.5.2).
 * Components use this to show degraded-mode banners and suppress predictions.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '@services/apiClient.js'
import { SYSTEM_LEVELS } from '@utils/constants.js'

const AI_API_URL      = import.meta.env.VITE_AI_API_URL ?? ''
const POLL_INTERVAL = 60_000  // health check every 60s — low priority background task

/** @returns {import('@types/market.js').SystemHealth} */
function defaultHealth() {
  return {
    level:              SYSTEM_LEVELS.FULL,
    ece:                0,
    brierScore:         0,
    dataFeedHealthy:    true,
    aiInferenceHealthy: true,
    lastUpdated:        new Date().toISOString(),
  }
}

/**
 * @returns {{ health: import('@types/market.js').SystemHealth; loading: boolean }}
 */
export function useSystemHealth() {
  const [health, setHealth]   = useState(defaultHealth)
  const [loading, setLoading] = useState(true)
  const timerRef              = useRef(null)

  const poll = useCallback(async () => {
    if (!AI_API_URL) {
      setLoading(false)
      return
    }
    try {
      const res  = await apiFetch(`${AI_API_URL}/health`)
      const data = await res.json()
      setHealth(data)
    } catch {
      // Health endpoint down — degrade gracefully
      setHealth((prev) => ({
        ...prev,
        level:              SYSTEM_LEVELS.DEGRADED_1,
        aiInferenceHealthy: false,
        lastUpdated:        new Date().toISOString(),
      }))
    } finally {
      setLoading(false)
    }
  }, []) // AI_API_URL is a module-level constant — safe to omit

  useEffect(() => {
    poll()
    timerRef.current = setInterval(poll, POLL_INTERVAL)
    return () => clearInterval(timerRef.current)
  }, [poll])

  return { health, loading }
}
