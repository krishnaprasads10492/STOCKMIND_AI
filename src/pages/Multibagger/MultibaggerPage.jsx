/**
 * MultibaggerPage — Dedicated page for discovering high-growth potential stocks.
 *
 * Screens NSE equities using fundamental + technical criteria.
 * Composite score 0–100. Integrates with AMI capabilities.
 */

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@store/authStore.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import { Disclaimer } from '@components/Disclaimer.jsx'
import { apiFetch } from '@services/apiClient.js'
import styles from './MultibaggerPage.module.css'

const SORT_OPTIONS = [
  { value: 'compositeScore',   label: 'Composite Score' },
  { value: 'revenueCagr',      label: 'Revenue Growth' },
  { value: 'roe',              label: 'Return on Equity' },
  { value: 'relativeStrength', label: 'Technical Strength' },
]

export default function MultibaggerPage() {
  const token   = useAuthStore(s => s.token)
  const user    = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin' || user?.role === 'super-admin'

  const [candidates,  setCandidates]  = useState([])
  const [status,      setStatus]      = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [scanning,    setScanning]    = useState(false)
  const [error,       setError]       = useState('')
  const [selected,    setSelected]    = useState(null)
  const [sortBy,      setSortBy]      = useState('compositeScore')
  const [minScore,    setMinScore]    = useState(0)
  const [minRevGrowth,setMinRevGrowth]= useState(0)
  const [sector,      setSector]      = useState('')

  const loadCandidates = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ sortBy })
      if (minScore > 0)    params.set('minScore', minScore)
      if (minRevGrowth > 0) params.set('minRevGrowth', minRevGrowth)
      if (sector)          params.set('sector', sector)

      const [candRes, statusRes] = await Promise.all([
        apiFetch(`/api/multibagger/candidates?${params}`, { headers: { 'x-session-token': token } }),
        apiFetch('/api/multibagger/status', { headers: { 'x-session-token': token } }),
      ])
      const candData   = await candRes.json()
      const statusData = await statusRes.json()
      setCandidates(candData.candidates ?? [])
      setStatus(statusData)
    } catch (e) {
      setError(e?.message ?? 'Failed to load candidates')
    } finally {
      setLoading(false)
    }
  }, [token, sortBy, minScore, minRevGrowth, sector])

  useEffect(() => { loadCandidates() }, [loadCandidates])

  async function handleScan() {
    if (!isAdmin) return
    setScanning(true); setError('')
    try {
      await apiFetch('/api/multibagger/scan', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': token },
        body:    JSON.stringify({}),
      })
      // Poll for completion
      setTimeout(loadCandidates, 5000)
    } catch (e) {
      setError(e?.message ?? 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  const sectors = [...new Set(candidates.map(c => c.sector).filter(Boolean))].sort()

  return (
    <div className={styles.page}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>🚀 Multibagger Discovery</h1>
          <p className={styles.subtitle}>
            Fundamental + technical screening for high-growth potential stocks
          </p>
          <div className={styles.disclaimer}>
            ⚠ Multibagger screening is probabilistic — past growth does not guarantee future returns
          </div>
        </div>
        <div className={styles.headerActions}>
          {status && (
            <div className={styles.scanStatus}>
              <span className={styles.scanCount}>{status.candidateCount} candidates</span>
              {status.lastScanTime && (
                <span className={styles.scanTime}>
                  Last scan: {new Date(status.lastScanTime).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              )}
              {!status.cacheValid && <span className={styles.staleTag}>stale</span>}
            </div>
          )}
          {isAdmin && (
            <button className={styles.scanBtn} onClick={handleScan}
              disabled={scanning || status?.scanning} type="button">
              {scanning || status?.scanning ? '⏳ Scanning…' : '🔍 Run Scan'}
            </button>
          )}
        </div>
      </div>

      {/* ── Filters ── */}
      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Sort by</label>
          <select className={styles.select} value={sortBy} onChange={e => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Min Score: {minScore}</label>
          <input type="range" min={0} max={80} step={5} value={minScore}
            onChange={e => setMinScore(Number(e.target.value))} className={styles.slider} />
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Min Rev Growth: {minRevGrowth}%</label>
          <input type="range" min={0} max={50} step={5} value={minRevGrowth}
            onChange={e => setMinRevGrowth(Number(e.target.value))} className={styles.slider} />
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Sector</label>
          <select className={styles.select} value={sector} onChange={e => setSector(e.target.value)}>
            <option value="">All Sectors</option>
            {sectors.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {/* ── Candidate list ── */}
      <ErrorBoundary>
        <div className={styles.layout}>
          <div className={styles.candidateList}>
            {loading && <div className={styles.loading}>Loading candidates…</div>}
            {!loading && candidates.length === 0 && (
              <div className={styles.empty}>
                No candidates match the current filters.
                {!status?.cacheValid && ' Run a scan to populate the list.'}
                {' '}Try relaxing the filters.
              </div>
            )}
            {candidates.map(c => (
              <ErrorBoundary key={c.symbol}>
                <CandidateCard
                  candidate={c}
                  selected={selected?.symbol === c.symbol}
                  onSelect={() => setSelected(c)}
                />
              </ErrorBoundary>
            ))}
          </div>

          {/* ── Detail panel ── */}
          {selected && (
            <ErrorBoundary>
              <CandidateDetail candidate={selected} token={token} onClose={() => setSelected(null)} />
            </ErrorBoundary>
          )}
        </div>
      </ErrorBoundary>

      <Disclaimer />
    </div>
  )
}

// ── Candidate Card ────────────────────────────────────────────────────────────

function CandidateCard({ candidate: c, selected, onSelect }) {
  const scoreColor = c.compositeScore >= 70 ? 'var(--color-bull)'
    : c.compositeScore >= 50 ? 'var(--color-warn)' : 'var(--color-bear)'

  return (
    <button
      type="button"
      className={`${styles.card} ${selected ? styles.cardSelected : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className={styles.cardHead}>
        <div className={styles.cardLeft}>
          <span className={styles.cardSymbol}>{c.symbol}</span>
          <span className={styles.cardName}>{c.companyName}</span>
          <span className={styles.cardSector}>{c.sector}</span>
        </div>
        <div className={styles.cardRight}>
          <div className={styles.scoreCircle} style={{ borderColor: scoreColor }}>
            <span className={styles.scoreNum} style={{ color: scoreColor }}>{c.compositeScore}</span>
            <span className={styles.scoreLabel}>score</span>
          </div>
        </div>
      </div>
      <div className={styles.cardMetrics}>
        <Metric label="Fund" value={c.fundamentalScore} max={50} color="var(--color-accent)" />
        <Metric label="Tech" value={c.technicalScore}   max={50} color="var(--color-ai)" />
        {c.fundamentals?.revenueGrowthYoY != null && (
          <span className={styles.metricChip}>Rev +{c.fundamentals.revenueGrowthYoY.toFixed(0)}%</span>
        )}
        {c.fundamentals?.roe != null && (
          <span className={styles.metricChip}>ROE {c.fundamentals.roe.toFixed(0)}%</span>
        )}
        {c.price != null && (
          <span className={styles.metricChip}>₹{c.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
        )}
      </div>
    </button>
  )
}

function Metric({ label, value, max, color }) {
  const pct = Math.min(100, (value / max) * 100)
  return (
    <div className={styles.metricBar}>
      <span className={styles.metricBarLabel}>{label}</span>
      <div className={styles.metricBarTrack}>
        <div className={styles.metricBarFill} style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className={styles.metricBarVal}>{value}</span>
    </div>
  )
}

// ── Candidate Detail ──────────────────────────────────────────────────────────

function CandidateDetail({ candidate: c, token, onClose }) {
  const [activeTab, setActiveTab] = useState('overview')

  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <div>
          <h2 className={styles.detailTitle}>{c.symbol} — {c.companyName}</h2>
          <span className={styles.detailSector}>{c.sector}</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close detail">✕</button>
      </div>

      <div className={styles.detailTabs}>
        {[['overview','📊 Overview'],['fundamentals','💰 Fundamentals'],['technical','📈 Technical']].map(([id, label]) => (
          <button key={id} type="button"
            className={`${styles.detailTab} ${activeTab === id ? styles.detailTabActive : ''}`}
            onClick={() => setActiveTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className={styles.detailContent}>
          <div className={styles.scoreRow}>
            <ScoreBlock label="Composite" value={c.compositeScore} max={100} />
            <ScoreBlock label="Fundamental" value={c.fundamentalScore} max={50} />
            <ScoreBlock label="Technical" value={c.technicalScore} max={50} />
          </div>
          <div className={styles.priceRow}>
            <span>₹{c.price?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
            <span className={c.changePct >= 0 ? styles.bull : styles.bear}>
              {c.changePct >= 0 ? '▲' : '▼'} {Math.abs(c.changePct ?? 0).toFixed(2)}%
            </span>
          </div>
          <p className={styles.detailNote}>
            Click "View Full Analysis" to run multi-timeframe strategies and derivatives matrix for this stock.
          </p>
          <a href={`/predictions?symbol=${c.symbol}&exchange=NSE`} className={styles.analysisBtn}>
            ⚡ View Full Analysis
          </a>
        </div>
      )}

      {activeTab === 'fundamentals' && (
        <div className={styles.detailContent}>
          <div className={styles.metricsGrid}>
            {[
              ['Revenue Growth', c.fundamentals?.revenueGrowthYoY, '%'],
              ['Net Margin',     c.fundamentals?.netMargin,        '%'],
              ['ROE',            c.fundamentals?.roe,              '%'],
              ['Debt/Equity',    c.fundamentals?.debtEquity,       'x'],
              ['P/E Ratio',      c.fundamentals?.pe,               'x'],
            ].map(([label, val, unit]) => (
              <div key={label} className={styles.metricItem}>
                <span className={styles.metricItemLabel}>{label}</span>
                <span className={styles.metricItemValue}>
                  {val != null ? `${val.toFixed(1)}${unit}` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'technical' && (
        <div className={styles.detailContent}>
          <div className={styles.metricsGrid}>
            {[
              ['52W High', c.week52High, '₹'],
              ['52W Low',  c.week52Low,  '₹'],
              ['Volume',   c.volume,     ''],
              ['Tech Score', c.technicalScore, '/50'],
            ].map(([label, val, unit]) => (
              <div key={label} className={styles.metricItem}>
                <span className={styles.metricItemLabel}>{label}</span>
                <span className={styles.metricItemValue}>
                  {val != null ? `${unit}${typeof val === 'number' ? val.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : val}` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ScoreBlock({ label, value, max }) {
  const pct = Math.min(100, (value / max) * 100)
  const color = pct >= 70 ? 'var(--color-bull)' : pct >= 50 ? 'var(--color-warn)' : 'var(--color-bear)'
  return (
    <div className={styles.scoreBlock}>
      <span className={styles.scoreBlockNum} style={{ color }}>{value}</span>
      <span className={styles.scoreBlockLabel}>{label}</span>
      <span className={styles.scoreBlockMax}>/{max}</span>
    </div>
  )
}
