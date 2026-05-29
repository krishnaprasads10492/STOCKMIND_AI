import { useState, useEffect } from 'react'
import { fetchPredictionHistory, fetchAccuracy } from '@services/backendClient.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import { GlobalSymbolPicker } from '@components/GlobalSymbolPicker.jsx'
import styles from './HistoryPage.module.css'

export default function HistoryPage() {
  const [symbol,  setSymbol]  = useState('NIFTY50')
  const [history, setHistory] = useState([])
  const [accuracy, setAccuracy] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function load(sym) {
    setLoading(true); setError('')
    try {
      const [hist, acc] = await Promise.all([
        fetchPredictionHistory(sym, 100),
        fetchAccuracy(sym, 30),
      ])
      setHistory(Array.isArray(hist) ? hist : [])
      setAccuracy(acc)
    } catch {
      setError('Failed to load history. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(symbol) }, [symbol])

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Prediction History</h1>
        <div className={styles.searchForm}>
          <GlobalSymbolPicker
            value={symbol}
            onChange={(sym) => setSymbol(sym)}
            size="sm"
          />
        </div>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {accuracy && (
        <ErrorBoundary>
          <AccuracyPanel accuracy={accuracy} />
        </ErrorBoundary>
      )}

      {loading ? (
        <div className={styles.loading} aria-live="polite">Loading…</div>
      ) : history.length === 0 ? (
        <div className={styles.empty}>No predictions found for {symbol}</div>
      ) : (
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span>Date</span><span>Type</span><span>Entry</span>
            <span>SL</span><span>T1</span><span>Prob</span>
            <span>Grade</span><span>Outcome</span>
          </div>
          {history.map(p => (
            <HistoryRow key={p.id} prediction={p} />
          ))}
        </div>
      )}
    </div>
  )
}

function AccuracyPanel({ accuracy: a }) {
  if (!a.totalResolved) return (
    <div className={styles.accuracyPanel}>
      <p className={styles.noData}>No resolved predictions yet — accuracy will appear once signals expire or hit targets.</p>
    </div>
  )

  return (
    <div className={styles.accuracyPanel}>
      <h2 className={styles.accTitle}>30-Day Accuracy — {a.symbol}</h2>
      <div className={styles.accGrid}>
        <AccStat label="Accuracy"  value={`${a.accuracyPct}%`}  color={a.accuracyPct >= 75 ? 'bull' : 'bear'} />
        <AccStat label="Win Rate"  value={`${a.t1HitRate}%`}    color="bull" />
        <AccStat label="Loss Rate" value={`${a.slHitRate}%`}    color="bear" />
        <AccStat label="Avg R:R"   value={`1:${a.avgRR}`}       color="neutral" />
        <AccStat label="Resolved"  value={a.totalResolved}      color="neutral" />
      </div>
      <p className={styles.accNote}>Win rate and loss rate are always shown together — no cherry-picking.</p>
    </div>
  )
}

function AccStat({ label, value, color }) {
  const cls = color === 'bull' ? styles.bull : color === 'bear' ? styles.bear : styles.neutral
  return (
    <div className={styles.accStat}>
      <span className={styles.accStatLabel}>{label}</span>
      <span className={`${styles.accStatValue} ${cls}`}>{value}</span>
    </div>
  )
}

function HistoryRow({ prediction: p }) {
  const outcome = p.outcome?.outcome
  const outcomeColor = outcome?.includes('HIT') && !outcome?.includes('SL')
    ? styles.bull : outcome === 'SL_HIT' ? styles.bear : styles.neutral

  return (
    <div className={styles.tableRow}>
      <span>{new Date(p.generatedAt ?? 0).toLocaleDateString('en-IN')}</span>
      <span className={p.type === 'LONG' ? styles.bull : styles.bear}>{p.type}</span>
      <span className={styles.mono}>{p.entryPrice?.toLocaleString('en-IN')}</span>
      <span className={`${styles.mono} ${styles.bear}`}>{p.stopLoss?.toLocaleString('en-IN')}</span>
      <span className={`${styles.mono} ${styles.bull}`}>{p.t1Price?.toLocaleString('en-IN')}</span>
      <span className={styles.mono}>{p.probability}%</span>
      <span>{p.grade}</span>
      <span className={outcomeColor}>{outcome ?? '—'}</span>
    </div>
  )
}
