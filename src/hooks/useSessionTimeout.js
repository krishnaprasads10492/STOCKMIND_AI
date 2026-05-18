/**
 * useSessionTimeout — auto-logout after 45 minutes of inactivity.
 * Resets on any mouse move, keypress, click, or scroll.
 */

import { useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@store/authStore.js'
import { logoutApi } from '@services/backendClient.js'

const TIMEOUT_MS = 45 * 60 * 1000  // 45 minutes
const WARN_MS    = 2 * 60 * 1000   // warn 2 min before

export function useSessionTimeout(onWarn) {
  const { isAuthenticated, clearSession } = useAuthStore()
  const navigate  = useNavigate()
  const timerRef  = useRef(null)
  const warnRef   = useRef(null)

  const reset = useCallback(() => {
    clearTimeout(timerRef.current)
    clearTimeout(warnRef.current)
    if (!isAuthenticated) return

    warnRef.current = setTimeout(() => {
      onWarn?.()
    }, TIMEOUT_MS - WARN_MS)

    timerRef.current = setTimeout(async () => {
      await logoutApi().catch(() => {})
      clearSession()
      navigate('/login?reason=timeout', { replace: true })
    }, TIMEOUT_MS)
  }, [isAuthenticated, clearSession, navigate, onWarn])

  useEffect(() => {
    if (!isAuthenticated) return

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll']
    events.forEach(e => window.addEventListener(e, reset, { passive: true }))
    reset()

    return () => {
      events.forEach(e => window.removeEventListener(e, reset))
      clearTimeout(timerRef.current)
      clearTimeout(warnRef.current)
    }
  }, [isAuthenticated, reset])
}
