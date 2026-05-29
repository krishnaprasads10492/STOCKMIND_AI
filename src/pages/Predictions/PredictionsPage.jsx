import { useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@store/authStore.js'
import { useMarketStore } from '@store/marketStore.js'
import { usePredictionModeStore } from '@store/predictionModeStore.js'
import { useAutoRefreshPredictions } from '@hooks/useAutoRefreshPredictions.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import { Disclaimer } from '@components/Disclaimer.jsx'
import { LivePricePanel } from '@components/LivePricePanel.jsx'
import { PredictionModeSelector } from '@components/PredictionModeSelector.jsx'
import { RefreshCountdown } from '@components/RefreshCountdown.jsx'
import { PredictionInputPanel } from './PredictionInputPanel.jsx'
import { SignalGrid } from './SignalGrid.jsx'
import { PredictionChart } from './PredictionChart.jsx'
import TradingViewChart from '@components/TradingViewChart.jsx'
import { generateSignals as jsGenerateSignals } from '@utils/predictionEngine.js'
import { sanitizeTicker } from '@utils/sanitize.js'
import { savePredictions } from '@services/backendClient.js'
import { DISCLAIMERS, JURISDICTIONS } from '@utils/constants.js'
import styles from './PredictionsPage.module.css'

const JURISDICTION = import.meta.env.VITE_DISCLAIMER_JURISDICTION ?? JURISDICTIONS.IN

// Modules where derivative recommendations make sense
const INDEX_MODULES = ['indices-india', 'global-indices']

/**
 * Try Python AI backend first, fall back to JS engine silently.
 * Python backend = smarter ensemble. JS engine = always available.
 */
async function generateSignals(params, token) {
  if (token) {
    try {
      const res = await fetch('/api/inference/predict', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': token },
        body:    JSON.stringify(params),
        signal:  AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.signals?.length) {
          return data.signals.map(s => ({ ...s, disclaimer: DISCLAIMERS[JURISDICTION] }))
        }
      }
    } catch {
      // Python backend not running — fall through to JS engine
    }
  }
  return jsGenerateSignals(params)
}

export default function PredictionsPage() {
  const [searchParams] = useSearchParams()
  const user  = useAuthStore(s => s.user)
  const prefs = user?.preferences ?? {}
  const { activeSymbol, activeModuleId } = useMarketStore()
  const token = useAuthStore(s => s.token)

  // Prediction mode store
  const { activeMode, getWeightForInstrType } = usePredictionModeStore()

  const [signals,    setSignals]    = useState([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [lastParams, setLastParams] = useState(null)
  const [viewMode,   setViewMode]   = useState('cards')
  const [derivRec,   setDerivRec]   = useState(false)

  const isIndexModule = INDEX_MODULES.includes(activeModuleId)

  // Keep a ref to the last params so auto-refresh can re-use them
  const lastParamsRef = useRef(null)

  const handleGenerate = useCallback(async (params) => {
    const tickerResult = sanitizeTicker(params.symbol)
    if (!tickerResult.ok) { setError('Invalid ticker symbol'); return }

    setLoading(true)
    setError('')
    setSignals([])

    const fullParams = {
      ...params,
      symbol:          tickerResult.value,
      moduleId:        activeModuleId,
      isIndexDerivRec: derivRec && isIndexModule,
      // Apply adaptive weight from learning mode
      adaptiveWeight:  getWeightForInstrType(params.instrType ?? 'spot'),
      predictionMode:  activeMode,
    }

    setLastParams(fullParams)
    lastParamsRef.current = fullParams

    try {
      const generated = await generateSignals(fullParams, token)
      setSignals(generated)

      await savePredictions({
        requestId:    crypto.randomUUID(),
        symbol:       tickerResult.value,
        exchange:     params.exchange,
        generatedAt:  Date.now(),
        marketRegime: 'trending',
        modelVersion: 'v0.1.0-engine',
        userCapital:  params.capital,
        userRiskPct:  params.riskPct,
        predictionMode: activeMode,
        signals:      generated,
        suppressedCount: 0,
        disclaimer:   DISCLAIMERS[JURISDICTION],
      }).catch(() => {})

    } catch (err) {
      setError(err?.message ?? 'Failed to generate predictions')
    } finally {
      setLoading(false)
    }
  }, [derivRec, isIndexModule, activeMode, getWeightForInstrType, token, activeModuleId])

  // Auto-refresh: re-run with last params every 60s during market hours
  const handleAutoRefresh = useCallback(() => {
    if (lastParamsRef.current) {
      handleGenerate(lastParamsRef.current)
    }
  }, [handleGenerate])

  const { countdown, countdownSecs, forceRefresh } = useAutoRefreshPredictions(
    activeModuleId,
    handleAutoRefresh,
  )

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Predictions</h1>
          <p className={styles.subtitle}>16 calibrated signals · sorted by probability</p>
        </div>
      </div>

      {/* ── Prediction mode selector ── */}
      <ErrorBoundary>
        <PredictionModeSelector />
      </ErrorBoundary>

      {/* ── Two-column layout: input + live price ── */}
      <div className={styles.topRow}>
        <div className={styles.inputCol}>
          {/* Derivative recommender toggle — only for index modules */}
          {isIndexModule && (
            <div className={styles.derivBanner}>
              <div className={styles.derivInfo}>
                <span className={styles.derivIcon}>🎯</span>
                <div>
                  <strong>Derivative Recommender</strong>
                  <p>Scan all nearby strikes + futures and rank by profit potential</p>
                </div>
              </div>
              <label className={styles.derivToggle}>
                <input
                  type="checkbox"
                  checked={derivRec}
                  onChange={e => setDerivRec(e.target.checked)}
                  className={styles.derivCheckbox}
                />
                <span className={`${styles.derivSwitch} ${derivRec ? styles.derivSwitchOn : ''}`} />
                <span className={styles.derivLabel}>{derivRec ? 'ON' : 'OFF'}</span>
              </label>
            </div>
          )}

          <ErrorBoundary>
            <PredictionInputPanel
              defaultModule={searchParams.get('module') ?? prefs.defaultModule ?? 'indices-india'}
              defaultCapital={prefs.defaultCapital ?? 100000}
              defaultRisk={prefs.riskPerTrade ?? 1.5}
              onGenerate={handleGenerate}
              loading={loading}
            />
          </ErrorBoundary>
        </div>

        <div className={styles.priceCol}>
          <ErrorBoundary fallbackMessage="Price data unavailable">
            <LivePricePanel
              symbol={lastParams?.symbol ?? activeSymbol}
              instrType={lastParams?.instrType ?? 'spot'}
              optionMeta={lastParams?.instrType === 'options' ? lastParams?.optionMeta : null}
            />
          </ErrorBoundary>
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {/* ── Auto-refresh countdown (only when signals are loaded) ── */}
      {signals.length > 0 && (
        <RefreshCountdown
          countdown={countdown}
          countdownSecs={countdownSecs}
          onForceRefresh={forceRefresh}
          loading={loading}
        />
      )}

      {/* ── Results section ── */}
      {signals.length > 0 && (
        <>
          {/* View mode toggle */}
          <div className={styles.viewToggle}>
            <span className={styles.viewLabel}>View as:</span>
            <div className={styles.viewBtns} role="group" aria-label="View mode">
              {[['cards','⊞ Cards'],['chart','📈 Signal Chart'],['tv','📊 Live Chart']].map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={`${styles.viewBtn} ${viewMode === mode ? styles.viewBtnActive : ''}`}
                  onClick={() => setViewMode(mode)}
                  aria-pressed={viewMode === mode}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {viewMode === 'cards' && (
            <ErrorBoundary>
              <SignalGrid signals={signals} params={lastParams} mode={activeMode} />
            </ErrorBoundary>
          )}

          {viewMode === 'chart' && (
            <ErrorBoundary>
              <PredictionChart signals={signals} params={lastParams} />
            </ErrorBoundary>
          )}

          {viewMode === 'tv' && (
            <ErrorBoundary>
              <div style={{ height: '600px', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
                <TradingViewChart
                  symbol={lastParams?.symbol ?? activeSymbol}
                  exchange={lastParams?.exchange ?? 'NSE'}
                  interval="D"
                  height="100%"
                  showToolbar
                  showSideToolbar
                  allowSymbolChange
                  studies={['RSI@tv-basicstudies', 'Volume@tv-basicstudies']}
                />
              </div>
            </ErrorBoundary>
          )}

          <Disclaimer />
        </>
      )}
    </div>
  )
}
