/**
 * useAutoRefreshPredictions — triggers prediction regeneration every 60s.
 *
 * Only runs during market hours. Tracks time to next refresh.
 * Calls onRefresh() when it's time to regenerate.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { usePredictionModeStore } from '@store/predictionModeStore.js'
import { getMarketSession } from '@utils/marketHours.js'

export function useAutoRefreshPredictions(moduleId, onRefresh) {
  const { autoRefresh, refreshIntervalMs, markRefreshed } = usePredictionModeStore()
  const [countdown, setCountdown] = useState(refreshIntervalMs)
  const timerRef    = useRef(null)
  const countRef    = useRef(null)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  const tick = useCallback(() => {
    const session = getMarketSession(moduleId)
    // Only auto-refresh during market hours (crypto always)
    if (!session.isLive && moduleId !== 'crypto') return

    markRefreshed()
    onRefreshRef.current?.()
    setCountdown(refreshIntervalMs)
  }, [moduleId, refreshIntervalMs, markRefreshed])

  useEffect(() => {
    if (!autoRefresh) {
      clearInterval(timerRef.current)
      clearInterval(countRef.current)
      return
    }

    // Main refresh timer
    timerRef.current = setInterval(tick, refreshIntervalMs)

    // Countdown display — updates every second
    countRef.current = setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1000))
    }, 1000)

    return () => {
      clearInterval(timerRef.current)
      clearInterval(countRef.current)
    }
  }, [autoRefresh, refreshIntervalMs, tick])

  // Reset countdown when refresh happens
  const forceRefresh = useCallback(() => {
    tick()
    clearInterval(timerRef.current)
    if (autoRefresh) timerRef.current = setInterval(tick, refreshIntervalMs)
  }, [tick, autoRefresh, refreshIntervalMs])

  return {
    countdown,
    countdownSecs: Math.ceil(countdown / 1000),
    forceRefresh,
  }
}
