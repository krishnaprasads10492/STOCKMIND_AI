/**
 * SignalGrid — redesigned prediction cards.
 *
 * Mobile-first, touch-friendly, clear visual hierarchy.
 * Each card shows: instrument badge, direction, probability bar,
 * price levels in a clean table, Greeks for options, mini R:R bar.
 */

import { useState, memo } from 'react'
import { complementLabel } from '@utils/clamp.js'
import styles from './SignalGrid.module.css'

const GRADE_META = {
  'A+': { color: '#00ff88', bg: 'rgba(0,255,136,0.08)',  border: 'rgba(0,255,136,0.25)'  },
  'A':  { color: '#00d4ff', bg: 'rgba(0,212,255,0.08)',  border: 'rgba(0,212,255,0.25)'  },
  'B':  { color: '#b060ff', bg: 'rgba(176,96,255,0.08)', border: 'rgba(176,96,255,0.25)' },
  'C':  { color: '#ffaa00', bg: 'rgba(255,170,0,0.08)',  border: 'rgba(255,170,0,0.25)'  },
  'D':  { color: '#ff3366', bg: 'rgba(255,51,102,0.08)', border: 'rgba(255,51,102,0.25)' },
}

export function SignalGrid({ signals, params, mode = 'both' }) {
  const [expanded, setExpanded] = useState(null)
  const isNextDay = signals[0]?.isNextDay ?? false
  const nextDay   = signals[0]?.nextTradingDay ?? ''

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionLeft}>
          <span className={styles.count}>{signals.length}</span>
          <span className={styles.sectionTitle}>Signals</span>
          <span className={styles.symbol}>{params?.symbol}</span>
          {mode !== 'both' && (
            <span className={`${styles.modeBadge} ${mode === 'learning' ? styles.modeLearning : styles.modeReal}`}>
              {mode === 'learning' ? '🧠 Learning' : '🎯 Real-World'}
            </span>
          )}
        </div>
        <span className={styles.sortNote}>↓ probability</span>
      </div>

      {isNextDay && (
        <div className={styles.nextDayBanner} role="status">
          <span>📅</span>
          <div>
            <strong>Next Day — {nextDay}</strong>
            <p>Market closed. Based on today's EOD close.</p>
          </div>
        </div>
      )}

      <div className={styles.grid}>
        {signals.map(sig => (
          <SignalCard
            key={sig.id}
            signal={sig}
            expanded={expanded === sig.id}
            onToggle={() => setExpanded(expanded === sig.id ? null : sig.id)}
          />
        ))}
      </div>
    </div>
  )
}

const SignalCard = memo(function SignalCard({ signal: s, expanded, onToggle }) {
  const isLong     = s.type === 'LONG'
  const validUntil = new Date(s.validity)
  const isStale    = validUntil < new Date()
  const grade      = GRADE_META[s.grade] ?? GRADE_META['D']
  const rrColor    = s.riskRewardRatio >= 2 ? 'var(--color-bull)' : s.riskRewardRatio >= 1.5 ? 'var(--color-warn)' : 'var(--color-bear)'
  const fmt        = n => typeof n === 'number' ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'

  return (
    <article
      className={`${styles.card} ${isStale ? styles.stale : ''} ${isLong ? styles.cardLong : styles.cardShort}`}
      style={{ '--gc': grade.color, '--gb': grade.bg, '--gbr': grade.border }}
      aria-label={`Signal ${s.rank}: ${s.type} ${s.probability}% grade ${s.grade}`}
    >
      {/* ── Accent stripe ── */}
      <div className={`${styles.stripe} ${isLong ? styles.stripeLong : styles.stripeShort}`} />

      {/* ── Card header ── */}
      <div className={styles.cardHead}>
        <div className={styles.cardHeadLeft}>
          <span className={styles.rank}>#{s.rank}</span>
          <span className={`${styles.dir} ${isLong ? styles.long : styles.short}`}>
            {isLong ? '▲' : '▼'} {s.type}
          </span>
          {s.instrType && s.instrType !== 'spot' && (
            <span className={`${styles.instrBadge} ${s.instrType === 'options' ? styles.optBadge : styles.futBadge}`}>
              {s.instrType === 'options' ? `${s.optType} ${s.strike?.toLocaleString('en-IN')}` : 'FUT'}
            </span>
          )}
          {s.isNextDay && !isStale && <span className={styles.nextDayBadge}>NEXT DAY</span>}
          {isStale && <span className={styles.staleBadge}>STALE</span>}
        </div>

        <div className={styles.cardHeadRight}>
          <span className={styles.gradeBadge} style={{ color: grade.color, background: grade.bg, borderColor: grade.border }}>
            {s.grade}
          </span>
          <div className={styles.probWrap}>
            <span className={styles.probNum}>{s.probability}%</span>
          </div>
        </div>
      </div>

      {/* ── Probability bar ── */}
      <div className={styles.probBar} title={complementLabel(s.probability)}>
        <div
          className={`${styles.probFill} ${isLong ? styles.probFillLong : styles.probFillShort}`}
          style={{ width: `${s.probability}%` }}
        />
        <span className={styles.probComplement}>{complementLabel(s.probability)}</span>
      </div>

      {/* ── Price levels — compact table ── */}
      <div className={styles.levels}>
        <div className={styles.levelEntry}>
          <span className={styles.levelTag}>Entry</span>
          <span className={styles.levelPrice} style={{ color: 'var(--color-text-primary)', fontWeight: 800 }}>
            {fmt(s.entryPrice)}
          </span>
          <span className={styles.levelZone}>
            {fmt(s.entryZoneLow)} – {fmt(s.entryZoneHigh)}
          </span>
        </div>

        <div className={styles.levelRow}>
          <div className={styles.levelItem}>
            <span className={styles.levelTag} style={{ color: 'var(--color-bear)' }}>SL</span>
            <span className={styles.levelPrice} style={{ color: 'var(--color-bear)' }}>{fmt(s.stopLoss)}</span>
          </div>
          <div className={styles.levelItem}>
            <span className={styles.levelTag} style={{ color: 'var(--color-warn)' }}>Opt SL</span>
            <span className={styles.levelPrice} style={{ color: 'var(--color-warn)' }}>{fmt(s.immediateOptimalSL)}</span>
          </div>
        </div>

        <div className={styles.targets}>
          {[
            { label: 'T1', price: s.t1Price, prob: s.t1Probability, dim: false },
            { label: 'T2', price: s.t2Price, prob: s.t2Probability, dim: true  },
            { label: 'T3', price: s.t3Price, prob: s.t3Probability, dim: true  },
          ].map(({ label, price, prob, dim }) => (
            <div key={label} className={`${styles.target} ${dim ? styles.targetDim : ''}`}>
              <span className={styles.targetLabel}>{label}</span>
              <span className={styles.targetPrice} style={{ color: 'var(--color-bull)' }}>{fmt(price)}</span>
              <span className={styles.targetProb}>{prob}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── R:R visual bar ── */}
      <div className={styles.rrBar} title={`Risk:Reward = 1:${s.riskRewardRatio}`}>
        <div className={styles.rrRisk} style={{ flex: 1 }}>
          <span className={styles.rrLabel}>Risk</span>
          <span className={styles.rrVal} style={{ color: 'var(--color-bear)' }}>₹{s.maxRisk?.toLocaleString('en-IN')}</span>
        </div>
        <div className={styles.rrDivider} />
        <div className={styles.rrReward} style={{ flex: s.riskRewardRatio }}>
          <span className={styles.rrLabel}>Reward</span>
          <span className={styles.rrVal} style={{ color: rrColor }}>1:{s.riskRewardRatio}</span>
        </div>
      </div>

      {/* ── Metrics strip ── */}
      <div className={styles.metrics}>
        <Metric label="Valid"  value={isStale ? 'Expired' : fmtValidity(validUntil)} />
        <Metric label="Lots"   value={s.lotCount ? `${s.lotCount}×${s.lotSize}` : `${s.validityBars}b`} />
        {s.instrType === 'options' && s.iv && <Metric label="IV" value={`${s.iv}%`} color={s.iv > 25 ? 'var(--color-warn)' : undefined} />}
        {s.instrType === 'futures' && s.basis != null && <Metric label="Basis" value={`${s.basis > 0 ? '+' : ''}${s.basis?.toFixed(1)}`} color={s.basis > 0 ? 'var(--color-bull)' : 'var(--color-bear)'} />}
      </div>

      {/* ── Greeks (options only) ── */}
      {s.instrType === 'options' && s.delta != null && (
        <div className={styles.greeks}>
          <Greek label="Δ" value={s.delta?.toFixed(3)} color={s.delta > 0 ? 'var(--color-bull)' : 'var(--color-bear)'} />
          <Greek label="Γ" value={s.gamma?.toFixed(5)} />
          <Greek label="Θ" value={`${s.theta?.toFixed(2)}/d`} color="var(--color-bear)" />
          <Greek label="ν" value={s.vega?.toFixed(2)} />
        </div>
      )}

      {/* ── Index breakeven context ── */}
      {s.instrType === 'options' && s.breakeven && (
        <div className={styles.context}>
          <span>{s.optType === 'CE' ? '📈' : '📉'}</span>
          <span className={styles.contextText}>
            Breakeven <strong>{s.breakeven?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</strong>
            <span className={s.indexMoveNeeded > 0 ? styles.bull : styles.bear}>
              {' '}({s.indexMoveNeeded > 0 ? '+' : ''}{s.indexMoveNeeded?.toFixed(0)} pts)
            </span>
          </span>
          {s.probReachBreakeven && (
            <span className={styles.contextProb}>{s.probReachBreakeven}%</span>
          )}
        </div>
      )}

      {/* ── Spot price context (derivatives) ── */}
      {s.spotPrice != null && s.instrType !== 'spot' && (
        <div className={styles.context} style={{ borderColor: 'rgba(176,96,255,0.2)', background: 'rgba(176,96,255,0.04)' }}>
          <span>📍</span>
          <span className={styles.contextText}>
            Underlying spot <strong>{fmt(s.spotPrice)}</strong>
            {s.instrType === 'futures' && s.basis != null && (
              <span style={{ color: s.basis >= 0 ? 'var(--color-bull)' : 'var(--color-bear)' }}>
                {' '}(basis {s.basis >= 0 ? '+' : ''}{s.basis?.toFixed(1)})
              </span>
            )}
          </span>
        </div>
      )}

      <button className={styles.expandBtn} onClick={onToggle} aria-expanded={expanded}>
        <span>{expanded ? '▲' : '▼'}</span>
        {expanded ? 'Hide analysis' : 'Why this signal?'}
      </button>

      {expanded && (
        <ul className={styles.reasons} id={`reasons-${s.id}`}>
          {s.reasons?.map((r, i) => (
            <li key={i} className={styles.reason}>
              <span className={styles.reasonDot} aria-hidden="true" />
              {r}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
})

function Metric({ label, value, color }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue} style={color ? { color } : {}}>{value}</span>
    </div>
  )
}

function Greek({ label, value, color }) {
  return (
    <div className={styles.greekItem}>
      <span className={styles.greekLabel}>{label}</span>
      <span className={styles.greekValue} style={color ? { color } : {}}>{value}</span>
    </div>
  )
}

function fmtValidity(date) {
  const diff = date - Date.now()
  if (diff < 0) return 'Expired'
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}
