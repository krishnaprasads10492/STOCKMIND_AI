/**
 * @fileoverview usePrediction — fetches and manages a single prediction.
 *
 * Handles loading, error, and suppression states.
 * Never exposes raw probabilities — all values are pre-clamped by the service layer.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchPrediction } from '@services/predictionService.js'

/**
 * @typedef {Object} UsePredictionResult
 * @property {import('@types/market.js').PredictionPayload | null} prediction
 * @property {boolean}  loading
 * @property {string | null} error
 * @property {boolean}  suppressed
 * @property {() => void} refresh
 */

/**
 * @param {string | null} symbol
 * @param {string} [exchange='NSE']
 * @returns {UsePredictionResult}
 */
export function usePrediction(symbol, exchange = 'NSE') {
  const [prediction, setPrediction] = useState(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [suppressed, setSuppressed] = useState(false)

  // Prevent state updates on unmounted component
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const load = useCallback(async () => {
    if (!symbol) return

    setLoading(true)
    setError(null)
    setSuppressed(false)
    setPrediction(null)

    try {
      const result = await fetchPrediction(symbol, exchange)

      if (!mountedRef.current) return

      if (result === null) {
        setSuppressed(true)
      } else {
        setPrediction(result)
      }
    } catch (err) {
      if (!mountedRef.current) return
      setError(err?.message ?? 'Failed to load prediction')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [symbol, exchange])

  useEffect(() => {
    load()
  }, [load])

  return { prediction, loading, error, suppressed, refresh: load }
}
