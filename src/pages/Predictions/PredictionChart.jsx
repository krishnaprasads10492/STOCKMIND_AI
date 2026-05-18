/**
 * PredictionChart — graphical representation of prediction signals.
 *
 * Two panels:
 * 1. Signal levels — entry/SL/T1/T2/T3 as reference lines on a clean axis.
 *    No fake price bars — only real signal data is shown.
 * 2. Probability bar chart — all 16 signals ranked by probability,
 *    colour-coded by grade.
 */

import {
  BarChart, Bar, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell,
} from 'recharts'
import { useState } from 'react'
import styles from './PredictionChart.module.css'

const GRADE_COLORS = {
  'A+': '#00ff88',
  'A':  '#00d4ff',
  'B':  '#b060ff',
  'C':  '#ffaa00',
  'D':  '#ff3366',
}

export function PredictionChart({ signals, params }) {
  const [activeTab, setActiveTab] = useState('levels')

  if (!signals?.length || !params) return null

  const top = signals[0]

  // Signal levels chart — one bar per signal showing entry price
  // with reference lines for SL and targets
  const levelsData = signals.slice(0, 8).map(s => ({
    rank:  `#${s.rank}`,
    entry: s.entryPrice,
    grade: s.grade,
    type:  s.type,
    prob:  s.probability,
  }))

  // Price domain for levels chart
  const allPrices = signals.flatMap(s => [s.entryPrice, s.stopLoss, s.t1Price, s.t2Price, s.t3Price]).filter(Boolean)
  const minP = Math.min(...allPrices) * 0.997
  const maxP = Math.max(...allPrices) * 1.003

  // Probability chart data
  const probData = signals.map(s => ({
    rank:  `#${s.rank}`,
    prob:  s.probability,
    grade: s.grade,
    type:  s.type,
  }))

  const fmt = n => n?.toLocaleString('en-IN', { maximumFractionDigits: 0 }) ?? ''

  return (
    <div className={styles.wrapper}>
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'levels' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('levels')}
        >
          📐 Signal Levels
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'probability' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('probability')}
        >
          📊 Probability
        </button>
        <span className={styles.tabNote}>{params.symbol} · {signals.length} signals</span>
      </div>

      {/* ── Signal levels chart ── */}
      {activeTab === 'levels' && (
        <div className={styles.chartWrap}>
          <p className={styles.chartNote}>
            Key price levels for top signal — Entry, Stop Loss, T1 / T2 / T3
          </p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={levelsData}
              margin={{ top: 8, right: 80, bottom: 0, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" vertical={false} />
              <XAxis
                dataKey="rank"
                tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-border)' }}
              />
              <YAxis
                domain={[minP, maxP]}
                tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={fmt}
                width={72}
              />
              <Tooltip
                formatter={(v, _, props) => [
                  `₹${v?.toLocaleString('en-IN', { maximumFractionDigits: 2 })} — ${props.payload.type} Grade ${props.payload.grade}`,
                  'Entry',
                ]}
                contentStyle={{
                  background: 'var(--color-bg-elevated)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  color: 'var(--color-text-primary)',
                }}
              />

              {/* Entry bars */}
              <Bar dataKey="entry" radius={[3,3,0,0]} maxBarSize={28} isAnimationActive>
                {levelsData.map((e, i) => (
                  <Cell key={i} fill={GRADE_COLORS[e.grade] ?? '#94a3b8'} opacity={0.8} />
                ))}
              </Bar>

              {/* Reference lines — top signal levels */}
              <ReferenceLine y={top.entryPrice}        stroke="var(--color-accent)" strokeDasharray="6 3" strokeWidth={1.5}
                label={{ value: `Entry ${fmt(top.entryPrice)}`,  fill: 'var(--color-accent)', fontSize: 10, position: 'right' }} />
              <ReferenceLine y={top.stopLoss}          stroke="var(--color-bear)"   strokeDasharray="4 3" strokeWidth={1.5}
                label={{ value: `SL ${fmt(top.stopLoss)}`,       fill: 'var(--color-bear)',   fontSize: 10, position: 'right' }} />
              <ReferenceLine y={top.t1Price}           stroke="var(--color-bull)"   strokeDasharray="6 3" strokeWidth={1.5}
                label={{ value: `T1 ${fmt(top.t1Price)}`,        fill: 'var(--color-bull)',   fontSize: 10, position: 'right' }} />
              <ReferenceLine y={top.t2Price}           stroke="var(--color-bull)"   strokeDasharray="4 4" strokeWidth={1} strokeOpacity={0.6}
                label={{ value: `T2 ${fmt(top.t2Price)}`,        fill: 'var(--color-bull)',   fontSize: 9,  position: 'right' }} />
              <ReferenceLine y={top.t3Price}           stroke="var(--color-bull)"   strokeDasharray="3 5" strokeWidth={1} strokeOpacity={0.4}
                label={{ value: `T3 ${fmt(top.t3Price)}`,        fill: 'var(--color-bull)',   fontSize: 9,  position: 'right' }} />
              {top.immediateOptimalSL && (
                <ReferenceLine y={top.immediateOptimalSL} stroke="var(--color-warn)" strokeDasharray="3 3" strokeWidth={1}
                  label={{ value: 'Opt SL', fill: 'var(--color-warn)', fontSize: 9, position: 'right' }} />
              )}
            </BarChart>
          </ResponsiveContainer>

          <div className={styles.legend}>
            <LegendItem color="var(--color-accent)" label="Entry"      dash="6 3" />
            <LegendItem color="var(--color-bear)"   label="Stop Loss"  dash="4 3" />
            <LegendItem color="var(--color-bull)"   label="T1/T2/T3"   dash="6 3" />
            <LegendItem color="var(--color-warn)"   label="Optimal SL" dash="3 3" />
          </div>
        </div>
      )}

      {/* ── Probability chart ── */}
      {activeTab === 'probability' && (
        <div className={styles.chartWrap}>
          <p className={styles.chartNote}>
            All 16 signals · bar height = calibrated probability · colour = grade
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={probData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" horizontal vertical={false} />
              <XAxis dataKey="rank" tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }} tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} />
              <YAxis domain={[0, 100]} tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} width={40} />
              <Tooltip
                formatter={(v, _, p) => [`${v}% — Grade ${p.payload.grade} ${p.payload.type}`, 'Probability']}
                contentStyle={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '12px', color: 'var(--color-text-primary)' }}
              />
              <ReferenceLine y={75} stroke="var(--color-accent)" strokeDasharray="4 3" strokeWidth={1}
                label={{ value: '75%', fill: 'var(--color-accent)', fontSize: 9, position: 'right' }} />
              <Bar dataKey="prob" radius={[3,3,0,0]} isAnimationActive maxBarSize={32}>
                {probData.map((e, i) => (
                  <Cell key={i} fill={GRADE_COLORS[e.grade] ?? '#94a3b8'} opacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          <div className={styles.legend}>
            {Object.entries(GRADE_COLORS).map(([grade, color]) => (
              <span key={grade} className={styles.gradeLegend} style={{ color }}>
                <span className={styles.gradeDot} style={{ background: color }} />
                Grade {grade}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function LegendItem({ color, label, dash }) {
  return (
    <span className={styles.legendItem}>
      <svg width="24" height="8" aria-hidden="true">
        <line x1="0" y1="4" x2="24" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dash} />
      </svg>
      <span style={{ color }}>{label}</span>
    </span>
  )
}
