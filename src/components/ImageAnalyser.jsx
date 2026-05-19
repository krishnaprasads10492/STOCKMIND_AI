/**
 * ImageAnalyser — Universal image analysis component.
 *
 * Drop an image (chart screenshot, broker terminal, option chain, news, etc.)
 * and get structured financial intelligence extracted from it.
 *
 * Used in: AMI page (Image tab), JARVIS chat, Predictions page (context input).
 *
 * Props:
 *   onResult(data)   — called with merged analysis result
 *   symbol           — optional symbol context hint
 *   compact          — compact mode (no title/description)
 *   className        — extra CSS class
 */

import { useState, useRef, useCallback } from 'react'
import { useAuthStore } from '@store/authStore.js'
import { apiFetch } from '@services/apiClient.js'
import styles from './ImageAnalyser.module.css'

const MAX_SIZE_MB = 20
const ACCEPTED    = 'image/jpeg,image/png,image/webp,image/gif,image/bmp'

export function ImageAnalyser({ onResult, symbol = '', compact = false, className = '' }) {
  const token = useAuthStore(s => s.token)

  const [dragging,     setDragging]     = useState(false)
  const [preview,      setPreview]      = useState(null)   // data URL for preview
  const [loading,      setLoading]      = useState(false)
  const [result,       setResult]       = useState(null)
  const [error,        setError]        = useState('')
  const [capabilities, setCapabilities] = useState(null)
  const [context,      setContext]      = useState('')
  const [useCloud,     setUseCloud]     = useState(true)
  const fileRef = useRef(null)

  // Load capabilities on first render
  useState(() => {
    apiFetch('/api/image/capabilities', { headers: { 'x-session-token': token } })
      .then(r => r.json()).then(setCapabilities).catch(() => {})
  })

  const processFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) {
      setError('Please drop an image file (JPEG, PNG, WebP, etc.)')
      return
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`Image too large — max ${MAX_SIZE_MB} MB`)
      return
    }

    // Show preview
    const reader = new FileReader()
    reader.onload = e => setPreview(e.target.result)
    reader.readAsDataURL(file)

    setLoading(true)
    setError('')
    setResult(null)

    try {
      const form = new FormData()
      form.append('image', file)
      if (context) form.append('context', context)
      if (symbol)  form.append('symbol', symbol)
      form.append('use_cloud', String(useCloud))

      const endpoint = useCloud ? '/api/image/analyse' : '/api/image/analyse-sync'
      const res  = await apiFetch(endpoint, {
        method:    'POST',
        headers:   { 'x-session-token': token },
        body:      form,
        timeoutMs: useCloud ? 45_000 : 15_000,
      })
      const data = await res.json()

      if (data.error) { setError(data.error); return }

      setResult(data)
      onResult?.(data.merged ?? data)
    } catch (e) {
      setError(e?.message ?? 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }, [token, context, symbol, useCloud, onResult])

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  function onFileChange(e) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  function clearResult() {
    setResult(null)
    setPreview(null)
    setError('')
  }

  return (
    <div className={`${styles.wrap} ${className}`}>
      {!compact && (
        <div className={styles.header}>
          <h3 className={styles.title}>📸 Image Analysis</h3>
          <p className={styles.desc}>
            Drop any chart screenshot, broker terminal, option chain, or news image.
            AI extracts prices, patterns, indicators, support/resistance, and generates a trading summary.
          </p>
        </div>
      )}

      {/* Capabilities badge */}
      {capabilities && (
        <div className={styles.capsBadge}>
          {capabilities.cloudVision
            ? <span className={styles.capsOn}>✓ Cloud Vision active</span>
            : <span className={styles.capsOff}>⚠ OCR only — add OPENAI_API_KEY / ANTHROPIC_API_KEY for deep analysis</span>}
          {capabilities.tesseract
            ? <span className={styles.capsOn}>✓ OCR</span>
            : <span className={styles.capsOff}>⚠ Tesseract not installed</span>}
        </div>
      )}

      {/* Context input */}
      <div className={styles.contextRow}>
        <input
          className={styles.contextInput}
          placeholder="Optional context (e.g. 'NIFTY 15-min chart' or 'option chain screenshot')"
          value={context}
          onChange={e => setContext(e.target.value)}
          maxLength={200}
        />
        <label className={styles.cloudToggle}>
          <input type="checkbox" checked={useCloud} onChange={e => setUseCloud(e.target.checked)} />
          <span>Cloud Vision</span>
        </label>
      </div>

      {/* Drop zone */}
      {!preview && (
        <div
          className={`${styles.dropZone} ${dragging ? styles.dropZoneDrag : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Drop image or click to browse"
          onKeyDown={e => e.key === 'Enter' && fileRef.current?.click()}
        >
          <span className={styles.dropIcon}>📸</span>
          <span className={styles.dropText}>
            {dragging ? 'Drop image here' : 'Drop chart / screenshot here or click to browse'}
          </span>
          <span className={styles.dropHint}>JPEG · PNG · WebP · up to {MAX_SIZE_MB} MB</span>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED}
            onChange={onFileChange}
            className={styles.fileInput}
            aria-hidden="true"
          />
        </div>
      )}

      {/* Preview + loading */}
      {preview && (
        <div className={styles.previewWrap}>
          <img src={preview} alt="Uploaded chart" className={styles.preview} />
          {loading && (
            <div className={styles.loadingOverlay}>
              <span className={styles.spinner} aria-hidden="true" />
              <span>{useCloud ? 'Analysing with AI vision…' : 'Running OCR…'}</span>
            </div>
          )}
          {!loading && (
            <button className={styles.clearBtn} onClick={clearResult} type="button" aria-label="Clear image">✕</button>
          )}
        </div>
      )}

      {error && <div className={styles.error} role="alert">{error}</div>}

      {/* Results */}
      {result && !loading && <AnalysisResult result={result} />}
    </div>
  )
}

// ── Analysis Result display ───────────────────────────────────────────────────

function AnalysisResult({ result }) {
  const m = result.merged ?? {}
  const [showRaw, setShowRaw] = useState(false)

  const biasColor = m.bias === 'bullish' ? 'var(--color-bull)'
    : m.bias === 'bearish' ? 'var(--color-bear)'
    : 'var(--color-text-muted)'

  const fmt = n => n != null ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'

  return (
    <div className={styles.result}>
      {/* Header */}
      <div className={styles.resultHead}>
        <div className={styles.resultMeta}>
          <span className={styles.methodBadge}>{result.method === 'cloud_vision' ? '🤖 AI Vision' : '🔍 OCR'}</span>
          <span className={styles.confBadge}>Confidence: {result.confidence}%</span>
          {m.symbol && <span className={styles.symbolBadge}>{m.symbol}</span>}
          {m.timeframe && <span className={styles.tfBadge}>{m.timeframe}</span>}
        </div>
        <span className={styles.biasBadge} style={{ color: biasColor }}>
          {m.bias === 'bullish' ? '▲ Bullish' : m.bias === 'bearish' ? '▼ Bearish' : '↔ Neutral'}
        </span>
      </div>

      {/* Summary */}
      {m.summary && (
        <div className={styles.summary}>{m.summary}</div>
      )}

      {/* Price levels */}
      <div className={styles.priceGrid}>
        {[
          ['Current', m.currentPrice],
          ['Open',    m.open],
          ['High',    m.high],
          ['Low',     m.low],
          ['Close',   m.close],
        ].filter(([, v]) => v != null).map(([label, val]) => (
          <div key={label} className={styles.priceCell}>
            <span className={styles.priceCellLabel}>{label}</span>
            <span className={styles.priceCellVal}>₹{fmt(val)}</span>
          </div>
        ))}
        {m.priceChangePct != null && (
          <div className={styles.priceCell}>
            <span className={styles.priceCellLabel}>Change</span>
            <span className={styles.priceCellVal} style={{ color: m.priceChangePct >= 0 ? 'var(--color-bull)' : 'var(--color-bear)' }}>
              {m.priceChangePct >= 0 ? '+' : ''}{fmt(m.priceChangePct)}%
            </span>
          </div>
        )}
      </div>

      {/* Support / Resistance */}
      {(m.support != null || m.resistance != null) && (
        <div className={styles.srRow}>
          {m.support    != null && <span className={styles.srSupport}>Support ₹{fmt(m.support)}</span>}
          {m.resistance != null && <span className={styles.srResist}>Resistance ₹{fmt(m.resistance)}</span>}
        </div>
      )}

      {/* Key levels */}
      {m.keyLevels?.length > 0 && (
        <div className={styles.keyLevels}>
          {m.keyLevels.map((kl, i) => (
            <span key={i} className={styles.keyLevel}>
              {kl.label ?? kl.type ?? 'Level'}: ₹{fmt(kl.price ?? kl.value ?? kl)}
            </span>
          ))}
        </div>
      )}

      {/* Patterns & Indicators */}
      {(m.patterns?.length > 0 || m.indicators?.length > 0) && (
        <div className={styles.tagsRow}>
          {m.patterns?.map(p => <span key={p} className={styles.patternTag}>{p}</span>)}
          {m.indicators?.map(i => <span key={i} className={styles.indicatorTag}>{i.toUpperCase()}</span>)}
        </div>
      )}

      {/* Signals */}
      {m.signals?.length > 0 && (
        <div className={styles.signalsRow}>
          {m.signals.map((s, i) => <span key={i} className={styles.signalTag}>{s}</span>)}
        </div>
      )}

      {/* Volume / IV / OI */}
      <div className={styles.extraMetrics}>
        {m.volume        != null && <span>Vol: {fmt(m.volume)}</span>}
        {m.iv            != null && <span>IV: {fmt(m.iv)}%</span>}
        {m.openInterest  != null && <span>OI: {fmt(m.openInterest)}</span>}
      </div>

      {/* News headlines */}
      {m.newsHeadlines?.length > 0 && (
        <div className={styles.headlines}>
          <span className={styles.headlinesLabel}>📰 Headlines detected:</span>
          {m.newsHeadlines.map((h, i) => <div key={i} className={styles.headline}>{h}</div>)}
        </div>
      )}

      {/* Option data */}
      {m.optionData && (
        <div className={styles.optionData}>
          <span className={styles.optionDataLabel}>⚙ Option data detected</span>
          <pre className={styles.optionDataPre}>{JSON.stringify(m.optionData, null, 2)}</pre>
        </div>
      )}

      {/* Warnings */}
      {result.warnings?.length > 0 && (
        <div className={styles.warnings}>
          {result.warnings.map((w, i) => <div key={i} className={styles.warning}>⚠ {w}</div>)}
        </div>
      )}

      {/* Raw text toggle */}
      {m.rawText && (
        <div className={styles.rawSection}>
          <button className={styles.rawToggle} type="button" onClick={() => setShowRaw(s => !s)}>
            {showRaw ? '▲ Hide raw OCR text' : '▼ Show raw OCR text'}
          </button>
          {showRaw && <pre className={styles.rawText}>{m.rawText}</pre>}
        </div>
      )}
    </div>
  )
}
