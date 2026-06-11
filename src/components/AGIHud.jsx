/**
 * AGIHud.jsx — Financial Traffic Light + ARC Energy Gauge + Reasoning Traces
 * StockMind AGI Blueprint // Layer I: Client HUD Interface
 *
 * Components:
 *   <FinancialTrafficLight />  — Emerald / Amber / Crimson safety markers
 *   <ARCEnergyGauge />         — Compute token burn tracker
 *   <ReasoningContextTraces /> — Plain-English strategy explanations
 *   <AGIStatusPanel />         — Full HUD combining all above
 *   <WaveProjectionPanel />    — Multi-horizon wave projections
 */

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@services/apiClient.js'
import styles from './AGIHud.module.css'

// ── Financial Traffic Light ───────────────────────────────────────────────────

export function FinancialTrafficLight({ symbol, ps, ptrap, arcColor }) {
  // Ps: portfolio safety 0–1 (1=safe, 0=danger)
  // ptrap: manipulation probability 0–1
  // arcColor: 'emerald' | 'amber' | 'crimson'

  const getLight = () => {
    if (ptrap > 0.65 || ps < 0.25 || arcColor === 'crimson') return 'crimson'
    if (ptrap > 0.40 || ps < 0.50 || arcColor === 'amber')   return 'amber'
    return 'emerald'
  }

  const light  = getLight()
  const labels = {
    emerald: { text: 'GO',      sub: 'Conditions favorable',       icon: '✓' },
    amber:   { text: 'CAUTION', sub: 'Elevated risk detected',     icon: '⚠' },
    crimson: { text: 'HALT',    sub: 'High risk / circuit active', icon: '✗' },
  }
  const info = labels[light]

  return (
    <div className={`${styles.trafficLight} ${styles[`tl_${light}`]}`}
      role="status" aria-label={`Market condition: ${info.text}`}>
      <div className={styles.tlDots}>
        {['crimson','amber','emerald'].map(c => (
          <div key={c} className={`${styles.tlDot} ${styles[`dot_${c}`]} ${light === c ? styles.tlDotActive : ''}`}
            aria-hidden="true" />
        ))}
      </div>
      <div className={styles.tlInfo}>
        <span className={styles.tlText}>{info.icon} {info.text}</span>
        <span className={styles.tlSub}>{info.sub}</span>
        {symbol && <span className={styles.tlSymbol}>{symbol}</span>}
      </div>
      <div className={styles.tlMetrics}>
        <span className={styles.tlMetric}>Ps <b>{ps != null ? (ps * 100).toFixed(0) + '%' : '—'}</b></span>
        <span className={styles.tlMetric}>Ptrap <b style={{ color: ptrap > 0.5 ? 'var(--color-bear)' : 'inherit' }}>
          {ptrap != null ? (ptrap * 100).toFixed(0) + '%' : '—'}
        </b></span>
      </div>
    </div>
  )
}

// ── ARC Compute Energy Gauge ──────────────────────────────────────────────────

export function ARCEnergyGauge({ gauge }) {
  if (!gauge) return null
  const { daily_pct, hourly_pct, color, circuit_open, total_burned, daily_budget } = gauge

  return (
    <div className={`${styles.arcGauge} ${styles[`arc_${color}`]}`}
      role="meter" aria-label={`Compute usage: ${daily_pct}%`}>
      <div className={styles.arcHeader}>
        <span className={styles.arcTitle}>⚡ ARC Compute</span>
        {circuit_open && <span className={styles.arcCircuit}>CIRCUIT OPEN</span>}
      </div>
      <div className={styles.arcBars}>
        <div className={styles.arcBarRow}>
          <span className={styles.arcBarLabel}>Daily</span>
          <div className={styles.arcBarTrack}>
            <div className={`${styles.arcBarFill} ${styles[`arc_${color}`]}`}
              style={{ width: `${daily_pct}%` }} />
          </div>
          <span className={styles.arcBarVal}>{daily_pct}%</span>
        </div>
        <div className={styles.arcBarRow}>
          <span className={styles.arcBarLabel}>Hourly</span>
          <div className={styles.arcBarTrack}>
            <div className={`${styles.arcBarFill} ${styles[`arc_${color}`]}`}
              style={{ width: `${hourly_pct}%` }} />
          </div>
          <span className={styles.arcBarVal}>{hourly_pct}%</span>
        </div>
      </div>
      <div className={styles.arcBurned}>
        {(total_burned / 1000).toFixed(1)}K / {(daily_budget / 1000).toFixed(0)}K tokens
      </div>
    </div>
  )
}

// ── Reasoning Context Traces ──────────────────────────────────────────────────

export function ReasoningContextTraces({ signals, waveProjection }) {
  if (!signals?.length) return null

  const topSignal = signals[0]

  // Plain-English strategy explanation
  const explain = (sig) => {
    const dir   = sig.direction === 'long' ? 'Bullish' : 'Bearish'
    const prob  = sig.probability ?? 0
    const grade = sig.grade ?? 'C'
    const rr    = sig.riskReward ?? 1.5
    const entry = sig.entry?.toLocaleString('en-IN') ?? '—'
    const t1    = sig.t1?.toLocaleString('en-IN') ?? '—'
    const sl    = sig.stopLoss?.toLocaleString('en-IN') ?? '—'

    return `${dir} signal at ${entry}. ${prob}% probability (Grade ${grade}). ` +
      `Target T1: ${t1}, Stop: ${sl}. Risk/Reward: 1:${rr}. ` +
      `~${100 - prob}% chance of being wrong — use defined stop-loss.`
  }

  const wave = waveProjection?.unified
  const waveText = wave
    ? `Wave analysis shows ${wave.direction.toUpperCase()} bias ` +
      `(${(wave.alignment_score * 100).toFixed(0)}% horizon alignment, ` +
      `strength ${(wave.strength * 100).toFixed(0)}%).`
    : ''

  return (
    <div className={styles.reasoningTraces}>
      <div className={styles.rtHeader}>
        <span className={styles.rtTitle}>🧠 Reasoning Context</span>
        <span className={styles.rtBadge}>Plain English</span>
      </div>

      {/* Top signal explanation */}
      <div className={styles.rtBlock}>
        <span className={styles.rtBlockLabel}>Signal Analysis</span>
        <p className={styles.rtText}>{explain(topSignal)}</p>
      </div>

      {/* Wave projection context */}
      {waveText && (
        <div className={styles.rtBlock}>
          <span className={styles.rtBlockLabel}>Wave Projection</span>
          <p className={styles.rtText}>{waveText}</p>
          {waveProjection?.intraday && (
            <div className={styles.rtHorizons}>
              {['intraday','swing','macro'].map(h => {
                const proj = waveProjection[h]
                if (!proj) return null
                return (
                  <div key={h} className={`${styles.rtHorizon} ${styles[`dir_${proj.direction}`]}`}>
                    <span className={styles.rtHLabel}>{h}</span>
                    <span className={styles.rtHDir}>{proj.direction === 'bull' ? '▲' : proj.direction === 'bear' ? '▼' : '→'}</span>
                    <span className={styles.rtHProb}>{(proj.probability * 100).toFixed(0)}%</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Signal reasons */}
      {topSignal.reasons?.length > 0 && (
        <div className={styles.rtBlock}>
          <span className={styles.rtBlockLabel}>AI Reasoning Factors</span>
          <ul className={styles.rtReasons}>
            {topSignal.reasons.slice(0, 5).map((r, i) => (
              <li key={i} className={styles.rtReason}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.rtDisclaimer}>
        NOT financial advice. All probabilities carry inherent risk of loss.
      </div>
    </div>
  )
}

// ── Wave Projection Panel ─────────────────────────────────────────────────────

export function WaveProjectionPanel({ symbol, exchange }) {
  const [wave,    setWave]    = useState(null)
  const [loading, setLoading] = useState(false)

  const fetchWave = useCallback(async () => {
    if (!symbol) return
    setLoading(true)
    try {
      const d = await apiFetch('/api/jarvis/multi-horizon', {
        method: 'POST',
        body: JSON.stringify({ symbol, exchange: exchange ?? 'NSE' }),
      })
      if (d.ok) setWave(d)
    } catch { /* non-fatal */ }
    finally { setLoading(false) }
  }, [symbol, exchange])

  useEffect(() => { fetchWave() }, [fetchWave])

  if (loading) return <div className={styles.waveLoading}>Projecting wave vectors…</div>
  if (!wave?.unified) return null

  const { unified, intraday, swing, macro } = wave
  const dirIcon = { bull: '▲', bear: '▼', neutral: '→' }

  return (
    <div className={styles.wavePanel}>
      <div className={styles.waveHeader}>
        <span className={styles.waveTitle}>〜 Multi-Horizon Wave</span>
        <span className={styles.waveSymbol}>{symbol}</span>
        <span className={`${styles.waveUnified} ${styles[`dir_${unified.direction}`]}`}>
          {dirIcon[unified.direction]} {unified.direction.toUpperCase()}
          <span className={styles.waveAlign}>{(unified.alignment_score * 100).toFixed(0)}% aligned</span>
        </span>
      </div>

      <div className={styles.waveHorizons}>
        {[intraday, swing, macro].filter(Boolean).map(h => (
          <div key={h.horizon} className={`${styles.waveHBlock} ${styles[`dir_${h.direction}`]}`}>
            <div className={styles.waveHName}>{h.horizon?.replace('_', ' ')}</div>
            <div className={styles.waveHDir}>{dirIcon[h.direction]}</div>
            <div className={styles.waveHProb}>{(h.probability * 100).toFixed(0)}%</div>
            <div className={styles.waveHTarget}>T: {h.price_target?.toLocaleString('en-IN')}</div>
          </div>
        ))}
      </div>

      {/* Wave vector visualization */}
      <div className={styles.waveVector}>
        {unified.wave_vector?.map((v, i) => (
          <div key={i} className={styles.waveVBar}>
            <div className={styles.waveVFill} style={{ height: `${v * 100}%` }} />
          </div>
        ))}
      </div>

      <div className={styles.waveFooter}>
        Horizons agree: {unified.horizons_agree}/3 · Strength: {(unified.strength * 100).toFixed(0)}%
      </div>
    </div>
  )
}

// ── Full AGI HUD Panel ────────────────────────────────────────────────────────

export function AGIStatusPanel({ symbol, exchange, signals, compact = false }) {
  const [isqStatus, setIsqStatus]   = useState(null)
  const [waveData,  setWaveData]    = useState(null)

  useEffect(() => {
    // Poll ISQ status every 30s
    const fetch = async () => {
      try {
        const d = await apiFetch('/api/jarvis/isq-status')
        if (d.ok) setIsqStatus(d)
      } catch {}
    }
    fetch()
    const t = setInterval(fetch, 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!symbol) return
    apiFetch('/api/jarvis/multi-horizon', {
      method: 'POST',
      body: JSON.stringify({ symbol, exchange: exchange ?? 'NSE' }),
    }).then(d => { if (d.ok) setWaveData(d) }).catch(() => {})
  }, [symbol, exchange])

  const arc    = isqStatus?.arc_gauge
  const ps     = isqStatus?.last_ps ?? null
  const ptrap  = isqStatus?.last_ptrap ?? null
  const color  = arc?.color ?? 'emerald'

  if (compact) {
    return (
      <div className={styles.hudCompact}>
        <FinancialTrafficLight symbol={symbol} ps={ps} ptrap={ptrap} arcColor={color} />
        {arc && <ARCEnergyGauge gauge={arc} />}
      </div>
    )
  }

  return (
    <div className={styles.hudFull}>
      <div className={styles.hudRow}>
        <FinancialTrafficLight symbol={symbol} ps={ps} ptrap={ptrap} arcColor={color} />
        {arc && <ARCEnergyGauge gauge={arc} />}
      </div>
      {signals?.length > 0 && (
        <ReasoningContextTraces signals={signals} waveProjection={waveData} />
      )}
      {symbol && <WaveProjectionPanel symbol={symbol} exchange={exchange} />}
    </div>
  )
}

export default AGIStatusPanel
