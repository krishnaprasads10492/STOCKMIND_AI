/**
 * DangerSignalBanner — Non-dismissible alert when a live price hits severe
 * negative territory vs an active prediction.
 *
 * Listens to the SSE stream for 'danger_signal' and 'danger_resolved' events.
 * Uses both colour AND text to convey the alert (WCAG 2.1 AA compliant).
 */

import { useState, useEffect } from 'react'
import { useAuthStore } from '@store/authStore.js'
import styles from './DangerSignalBanner.module.css'

export function DangerSignalBanner() {
  const token = useAuthStore(s => s.token)
  const [signals, setSignals] = useState([])   // active danger signals

  useEffect(() => {
    if (!token) return

    // Listen to the existing SSE stream
    let es = null
    let pollTimer = null
    let lastTs = Date.now() / 1000 - 60

    async function poll() {
      try {
        const res = await fetch(`/api/validator/events/poll?since=${lastTs}`, {
          headers: { 'x-session-token': token },
          signal: AbortSignal.timeout(8000),
        })
        if (res.ok) {
          const data = await res.json()
          for (const evt of data.events ?? []) {
            lastTs = Math.max(lastTs, evt.timestamp ?? lastTs)
            if (evt.type === 'danger_signal') {
              setSignals(prev => {
                if (prev.find(s => s.predictionId === evt.data?.predictionId)) return prev
                return [...prev, evt.data ?? evt]
              })
            } else if (evt.type === 'danger_resolved') {
              const resolvedId = evt.data?.predictionId
              if (resolvedId) {
                setSignals(prev => prev.filter(s => s.predictionId !== resolvedId))
              }
            }
          }
          lastTs = data.timestamp ?? lastTs
        }
      } catch { /* non-fatal */ }
      pollTimer = setTimeout(poll, 5000)
    }

    // Also listen to the SSE endpoint directly
    try {
      es = new EventSource(`/api/validator/events`)
      es.addEventListener('danger_signal', (e) => {
        try {
          const data = JSON.parse(e.data)
          setSignals(prev => {
            if (prev.find(s => s.predictionId === data.predictionId)) return prev
            return [...prev, data]
          })
        } catch { /* ignore */ }
      })
      es.addEventListener('danger_resolved', (e) => {
        try {
          const data = JSON.parse(e.data)
          setSignals(prev => prev.filter(s => s.predictionId !== data.predictionId))
        } catch { /* ignore */ }
      })
    } catch {
      // SSE not available — fall back to polling
      poll()
    }

    return () => {
      es?.close()
      clearTimeout(pollTimer)
    }
  }, [token])

  if (signals.length === 0) return null

  return (
    <div className={styles.container} role="alert" aria-live="assertive" aria-atomic="true">
      {signals.map((s, i) => (
        <div key={s.predictionId ?? i} className={styles.banner}>
          <span className={styles.icon} aria-hidden="true">⚠</span>
          <div className={styles.content}>
            <strong className={styles.title}>⚠ DANGER: Severe adverse move detected</strong>
            <span className={styles.detail}>
              {s.symbol} #{String(s.predictionId ?? '').slice(0, 8)} ·
              Live ₹{s.livePrice?.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ·
              SL ₹{s.stopLoss?.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ·
              Deviation {s.deviationPct?.toFixed(1)}%
            </span>
          </div>
          <span className={styles.time}>
            {new Date(s.timestamp ?? Date.now()).toLocaleTimeString('en-IN', { hour12: false })}
          </span>
        </div>
      ))}
    </div>
  )
}
