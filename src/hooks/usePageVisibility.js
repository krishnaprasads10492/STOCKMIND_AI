/**
 * usePageVisibility — tracks whether the browser tab is visible.
 *
 * Returns true when the tab is active/visible, false when hidden.
 * Polling hooks use this to pause background fetches when the user
 * switches tabs — conserves API quota and CPU.
 *
 * Uses the Page Visibility API (supported in all modern browsers).
 */
import { useState, useEffect } from 'react'

export function usePageVisibility() {
  const [visible, setVisible] = useState(
    typeof document !== 'undefined'
      ? document.visibilityState === 'visible'
      : true
  )

  useEffect(() => {
    function handler() {
      setVisible(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  return visible
}

/**
 * useVisibilityInterval — like setInterval but pauses when tab is hidden.
 *
 * When the tab becomes visible again, the callback fires immediately
 * (to catch up on missed data), then resumes normal interval.
 *
 * @param {() => void} callback
 * @param {number} intervalMs
 * @param {boolean} [enabled=true]
 */
export function useVisibilityInterval(callback, intervalMs, enabled = true) {
  const visible = usePageVisibility()

  useEffect(() => {
    if (!enabled) return

    // Fire immediately when tab becomes visible (catch up)
    if (visible) {
      callback()
    }

    if (!visible) return // don't start interval while hidden

    const t = setInterval(callback, intervalMs)
    return () => clearInterval(t)
  }, [visible, enabled, intervalMs]) // eslint-disable-line react-hooks/exhaustive-deps
  // callback intentionally excluded — use a ref-stable version if needed
}
