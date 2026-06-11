/**
 * ImageThemeCreator.jsx — Unified Theme Studio
 *
 * Runs BOTH paths in parallel and shows them side-by-side for comparison:
 *   Web Search  — searches internet for images matching style text
 *   Your Image  — extracts colors from your uploaded reference image
 *
 * Both are scored against your intent. Pick the one that matches best.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { apiFetch } from '@services/apiClient.js'
import styles from './ImageThemeCreator.module.css'

function applyPreview(theme) {
  if (!theme?.vars) return
  const root = document.documentElement
  Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v))
  if (theme.bg?.color) root.style.setProperty('--color-bg-base', theme.bg.color)
}
function clearPreview() {
  document.documentElement.classList.toggle('_p'); requestAnimationFrame(() => document.documentElement.classList.toggle('_p'))
}

function Spinner({ large }) {
  return <span className={large ? styles.spinnerLg : styles.spinner} aria-hidden="true" />
}

export function ImageThemeCreator({ onClose, onThemeCreated }) {
  const fileRef = useRef(null)
  const dropRef = useRef(null)

  const [themeName,  setThemeName]  = useState('')
  const [style,      setStyle]      = useState('')
  const [image,      setImage]      = useState(null)
  const [useWall,    setUseWall]    = useState(true)
  const [nColors,    setNColors]    = useState(10)
  const [imgCount,   setImgCount]   = useState(6)
  const [dragOver,   setDragOver]   = useState(false)

  const [loading,    setLoading]    = useState(false)
  const [options,    setOptions]    = useState([])
  const [winner,     setWinner]     = useState(null)
  const [error,      setError]      = useState(null)
  const [webErr,     setWebErr]     = useState(null)
  const [imgErr,     setImgErr]     = useState(null)

  const [previewing, setPreviewing] = useState(null)
  const [writing,    setWriting]    = useState(null)
  const [written,    setWritten]    = useState(null)
  const [selWp,      setSelWp]      = useState({})

  const loadFile = useCallback((file) => {
    if (!file?.type?.startsWith('image/')) { setError('Upload an image file'); return }
    if (file.size > 20 * 1024 * 1024)     { setError('Max 20MB'); return }
    const rd = new FileReader()
    rd.onload = e => {
      setImage({ dataUrl: e.target.result, name: file.name })
      setError(null)
      if (!themeName) setThemeName(file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').slice(0, 50))
    }
    rd.readAsDataURL(file)
  }, [themeName])

  useEffect(() => {
    const el = dropRef.current; if (!el) return
    const ov = e => { e.preventDefault(); setDragOver(true) }
    const lv = () => setDragOver(false)
    const dp = e => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer.files?.[0]) }
    el.addEventListener('dragover', ov); el.addEventListener('dragleave', lv); el.addEventListener('drop', dp)
    return () => { el.removeEventListener('dragover', ov); el.removeEventListener('dragleave', lv); el.removeEventListener('drop', dp) }
  }, [loadFile])

  const generate = useCallback(async () => {
    if (!themeName.trim()) { setError('Enter a theme name'); return }
    if (!style.trim() && !image) { setError('Add a style description or upload an image (or both)'); return }
    setLoading(true); setError(null); setWebErr(null); setImgErr(null)
    setOptions([]); setWinner(null); setPreviewing(null); setWritten(null)
    try {
      const resp = await apiFetch('/api/jarvis/theme-compare', {
        method: 'POST',
        body: JSON.stringify({ name: themeName.trim(), style: style.trim(),
          image_b64: image?.dataUrl ?? null, use_as_wallpaper: useWall,
          n_colors: nColors, image_count: imgCount }),
        timeoutMs: 120_000,
      })
      const json = await resp.json()
      if (!json.ok) throw new Error(json.error ?? 'Failed')
      setOptions(json.options ?? [])
      setWinner(json.winner)
      if (json.web_error) setWebErr(json.web_error)
      if (json.image_error && json.image_error !== 'no_image_provided') setImgErr(json.image_error)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [themeName, style, image, useWall, nColors, imgCount])

  const togglePreview = useCallback((id, theme) => {
    if (previewing === id) { clearPreview(); setPreviewing(null) }
    else { applyPreview(theme); setPreviewing(id) }
  }, [previewing])

  const writeTheme = useCallback(async (id, theme) => {
    setWriting(id); setError(null)
    try {
      const tr = await (await apiFetch('/api/jarvis/issue-token', { method: 'POST' })).json()
      if (!tr.token) throw new Error('No token')
      const wr = await (await apiFetch('/api/jarvis/write-theme', {
        method: 'POST', body: JSON.stringify({ approval_token: tr.token, theme }), timeoutMs: 30_000,
      })).json()
      if (!wr.ok) throw new Error(wr.error ?? 'Write failed')
      setWritten(id); if (previewing === id) { clearPreview(); setPreviewing(null) }
      onThemeCreated?.(theme)
    } catch (e) { setError(e.message) }
    finally { setWriting(null) }
  }, [previewing, onThemeCreated])

  useEffect(() => () => { if (previewing) clearPreview() }, [previewing])
  const canGen = themeName.trim() && (style.trim() || image) && !loading

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Theme Studio">
      <div className={styles.modal}>

        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.headerIcon}>🎨</span>
            <div>
              <h2 className={styles.title}>Theme Studio</h2>
              <p className={styles.subtitle}>
                Describe your theme · upload a reference image · JARVIS searches the web <em>and</em> reads your image · compare side-by-side · pick yours
              </p>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={() => { if (previewing) clearPreview(); onClose() }} aria-label="Close">×</button>
        </div>

        {/* Input area */}
        <div className={styles.inputArea}>
          <div className={styles.textCol}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="tc-name">Theme Name *</label>
              <input id="tc-name" className={styles.input} value={themeName}
                onChange={e => setThemeName(e.target.value)} maxLength={60}
                placeholder="e.g. Gotham Night, Ocean Depths, Solar Flare…" autoFocus />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="tc-style">
                Style / Mood <span className={styles.labelSub}>(drives web image search)</span>
              </label>
              <input id="tc-style" className={styles.input} value={style}
                onChange={e => setStyle(e.target.value)} maxLength={300}
                placeholder="e.g. dark rainy cyberpunk neon city · deep ocean bioluminescent teal · desert amber spice…" />
            </div>
          </div>

          <div className={styles.imageCol}>
            <span className={styles.label}>Reference Image <span className={styles.labelSub}>(optional)</span></span>
            <div ref={dropRef}
              className={`${styles.dropZone} ${dragOver ? styles.dropOver : ''} ${image ? styles.dropHasImg : ''}`}
              onClick={() => fileRef.current?.click()} role="button" tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && fileRef.current?.click()}
              aria-label="Upload reference image">
              {image
                ? <>
                    <img src={image.dataUrl} alt="Reference" className={styles.dropImg} />
                    <button className={styles.clearImg} onClick={e => { e.stopPropagation(); setImage(null) }} aria-label="Remove image">×</button>
                  </>
                : <div className={styles.dropPrompt}>
                    <span className={styles.dropIcon}>🖼</span>
                    <span className={styles.dropTxt}>Drop or click to upload</span>
                    <span className={styles.dropHint}>PNG · JPG · WEBP · GIF</span>
                  </div>
              }
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => e.target.files?.[0] && loadFile(e.target.files[0])} />
          </div>

          <div className={styles.optsCol}>
            <span className={styles.label}>Settings</span>
            <div className={styles.sliderRow}>
              <span className={styles.sliderLbl}>Web images</span>
              <input type="range" min={2} max={12} step={2} value={imgCount}
                onChange={e => setImgCount(Number(e.target.value))} className={styles.slider} />
              <span className={styles.sliderVal}>{imgCount}</span>
            </div>
            <div className={styles.sliderRow}>
              <span className={styles.sliderLbl}>Colors</span>
              <input type="range" min={4} max={20} step={2} value={nColors}
                onChange={e => setNColors(Number(e.target.value))} className={styles.slider} />
              <span className={styles.sliderVal}>{nColors}</span>
            </div>
            <label className={styles.checkRow}>
              <input type="checkbox" checked={useWall} onChange={e => setUseWall(e.target.checked)} />
              <span>Image as wallpaper</span>
            </label>
          </div>
        </div>

        {/* Generate */}
        <div className={styles.genRow}>
          <button className={styles.genBtn} onClick={generate} disabled={!canGen}>
            {loading
              ? <><Spinner /> Generating{style && image ? ' web + image' : style ? ' web search' : ' from image'}…</>
              : <>⚡ Generate &amp; Compare{!style && image ? ' (image only)' : !image && style ? ' (web search)' : style && image ? ' (web + image)' : ''}</>
            }
          </button>
          {error && <span className={styles.genErr}>⚠ {error}</span>}
        </div>

        {/* Loading state */}
        {loading && options.length === 0 && (
          <div className={styles.loadState}>
            <Spinner large />
            <div className={styles.loadSteps}>
              {style && <span>🌐 Searching the web for "{themeName}"…</span>}
              {image && <span>🎨 Extracting palette from your image…</span>}
              <span>⚖ Scoring both against your intent…</span>
            </div>
          </div>
        )}

        {/* Results */}
        {options.length > 0 && (
          <div className={styles.results}>
            <div className={styles.resultsHdr}>
              <span className={styles.resultsTitle}>
                {options.length === 2 ? 'Both options ready — pick the one closest to your vision' : 'Generated theme'}
              </span>
              {winner && (
                <span className={styles.winnerBadge}>
                  🏆 Best match: {options.find(o => o.id === winner)?.label}
                </span>
              )}
            </div>

            <div className={styles.compareGrid} style={{ '--cols': options.length }}>
              {options.map(opt => (
                <ThemeCard
                  key={opt.id}
                  opt={opt}
                  isWinner={opt.id === winner}
                  isPreviewing={previewing === opt.id}
                  isWriting={writing === opt.id}
                  isWritten={written === opt.id}
                  selWp={selWp[opt.id] ?? 0}
                  onSelectWp={i => setSelWp(p => ({ ...p, [opt.id]: i }))}
                  onPreview={() => togglePreview(opt.id, opt.theme)}
                  onWrite={() => writeTheme(opt.id, opt.theme)}
                />
              ))}
            </div>

            {(webErr || imgErr) && (
              <div className={styles.partialErr}>
                {webErr && <span>🌐 {webErr}</span>}
                {imgErr && <span>🖼 {imgErr}</span>}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

// ── ThemeCard ────────────────────────────────────────────────────────────────

function ThemeCard({ opt, isWinner, isPreviewing, isWriting, isWritten, selWp, onSelectWp, onPreview, onWrite }) {
  const { theme, match_score, label, description, wallpaper_count } = opt
  const hex = theme.palette_hex ?? theme.palette ?? []
  const wallpapers = theme.wallpapers ?? []

  // Score color
  const scoreCls = match_score >= 70 ? styles.scoreHigh : match_score >= 50 ? styles.scoreMid : styles.scoreLow
  const scoreBar = `${match_score}%`

  // Key colors
  const keyColors = [
    { name: 'Accent', val: theme.vars?.['--color-accent'] },
    { name: 'BG',     val: theme.vars?.['--color-bg-base'] },
    { name: 'Text',   val: theme.vars?.['--color-text-primary'] },
    { name: 'Bull',   val: theme.vars?.['--color-bull'] },
    { name: 'Bear',   val: theme.vars?.['--color-bear'] },
    { name: 'AI',     val: theme.vars?.['--color-ai'] },
  ].filter(c => c.val)

  return (
    <div className={`${styles.card} ${isWinner ? styles.cardWinner : ''} ${isPreviewing ? styles.cardPreviewing : ''}`}>
      {isWinner && <div className={styles.winnerRibbon}>🏆 Best match</div>}
      {isPreviewing && <div className={styles.previewingBadge}>👁 Live preview</div>}

      {/* Header */}
      <div className={styles.cardHdr}>
        <div className={styles.cardHdrLeft}>
          <span className={styles.cardEmoji}>{theme.emoji ?? '🎨'}</span>
          <div>
            <div className={styles.cardName}>{theme.name}</div>
            <div className={styles.cardSource}>{label}</div>
          </div>
        </div>
        <div className={styles.scoreBox}>
          <div className={`${styles.scoreNum} ${scoreCls}`}>{match_score}<span className={styles.scoreOf}>/100</span></div>
          <div className={styles.scoreLabel}>match</div>
          <div className={styles.scoreBarTrack}><div className={`${styles.scoreBarFill} ${scoreCls}`} style={{ width: scoreBar }} /></div>
        </div>
      </div>

      {/* Description */}
      <p className={styles.cardDesc}>{description}</p>

      {/* Palette swatches */}
      <div className={styles.paletteRow}>
        {hex.slice(0, 12).map((c, i) => (
          <div key={i} className={styles.sw} style={{ background: c }} title={c}>
            <span className={styles.swTip}>{c}</span>
          </div>
        ))}
      </div>

      {/* Key color preview */}
      <div className={styles.keyColors}>
        {keyColors.map(({ name, val }) => (
          <div key={name} className={styles.keyColor}>
            <div className={styles.keyColorDot} style={{ background: val }} />
            <span className={styles.keyColorName}>{name}</span>
          </div>
        ))}
      </div>

      {/* Wallpaper picker */}
      {wallpapers.length > 0 && (
        <div className={styles.wallpaperSection}>
          <span className={styles.wpLabel}>Wallpaper options ({wallpapers.length})</span>
          <div className={styles.wpRow}>
            {wallpapers.slice(0, 6).map((wp, i) => (
              <button key={i} type="button"
                className={`${styles.wpThumb} ${selWp === i ? styles.wpThumbSel : ''}`}
                onClick={() => onSelectWp(i)}
                title={wp.credit || wp.title || `Option ${i + 1}`}
                aria-pressed={selWp === i}>
                {wp.url?.startsWith('data:') || wp.thumb_url?.startsWith('data:')
                  ? <img src={wp.url ?? wp.thumb_url} alt={`Wallpaper ${i + 1}`} loading="lazy" />
                  : <img src={wp.thumb_url || wp.url} alt={`Wallpaper ${i + 1}`} crossOrigin="anonymous" loading="lazy" onError={e => { e.target.style.display = 'none' }} />
                }
                {selWp === i && <span className={styles.wpCheck}>✓</span>}
              </button>
            ))}
          </div>
          {wallpapers[selWp]?.credit && (
            <span className={styles.wpCredit}>Credit: {wallpapers[selWp].credit}</span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className={styles.cardActions}>
        <button
          className={`${styles.previewBtn} ${isPreviewing ? styles.previewBtnActive : ''}`}
          onClick={onPreview}
        >
          {isPreviewing ? '⊠ Stop preview' : '👁 Preview live'}
        </button>

        {isWritten
          ? <div className={styles.writtenMsg}>✓ Saved! Reload app to use.</div>
          : <button className={styles.writeBtn} onClick={onWrite} disabled={isWriting}>
              {isWriting ? <><Spinner /> Saving…</> : `💾 Use "${theme.name}"`}
            </button>
        }
      </div>
    </div>
  )
}

export default ImageThemeCreator
