/**
 * ImageThemeCreator.jsx
 *
 * Upload a single image → JARVIS extracts all colors + mood → builds a complete
 * named theme → preview it live → write it permanently to themes.js
 *
 * The image can be anything:
 *   - Color mood boards / design references
 *   - Screenshots of UIs you like
 *   - Photos / artwork with appealing colors
 *   - Custom color swatches you've made
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { apiFetch } from '@services/apiClient.js'
import { useThemeStore } from '@store/themeStore.js'
import styles from './ImageThemeCreator.module.css'

// Preview: apply theme vars temporarily without writing to disk
function applyPreview(theme) {
  if (!theme?.vars) return
  const root = document.documentElement
  Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v))
  if (theme.bg?.color) {
    root.style.setProperty('--color-bg-base', theme.bg.color)
  }
}

function removePreview() {
  // Reloading from the active theme store reverts the preview
  // Just force a style recalculation by toggling a class
  document.documentElement.classList.add('theme-revert')
  requestAnimationFrame(() => document.documentElement.classList.remove('theme-revert'))
}

export function ImageThemeCreator({ onClose, onThemeCreated }) {
  const { activeTheme } = useThemeStore()
  const fileRef    = useRef(null)
  const canvasRef  = useRef(null)
  const dropRef    = useRef(null)

  const [image,       setImage]       = useState(null)   // { dataUrl, name, size }
  const [themeName,   setThemeName]   = useState('')
  const [description, setDescription] = useState('')
  const [useAsWallpaper, setUseAsWallpaper] = useState(true)
  const [nColors,     setNColors]     = useState(10)
  const [loading,     setLoading]     = useState(false)
  const [result,      setResult]      = useState(null)   // generated theme
  const [error,       setError]       = useState(null)
  const [previewing,  setPreviewing]  = useState(false)
  const [writing,     setWriting]     = useState(false)
  const [written,     setWritten]     = useState(false)
  const [dragOver,    setDragOver]    = useState(false)

  // Load image from file
  const loadFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) {
      setError('Please upload an image file (PNG, JPG, WEBP, GIF)')
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('Image too large (max 20MB)')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      setImage({ dataUrl: e.target.result, name: file.name, size: file.size })
      setError(null)
      setResult(null)
      setPreviewing(false)
      setWritten(false)
      // Auto-suggest theme name from filename
      if (!themeName) {
        const base = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
        setThemeName(base.slice(0, 50))
      }
    }
    reader.readAsDataURL(file)
  }, [themeName])

  // Drag-and-drop
  useEffect(() => {
    const el = dropRef.current
    if (!el) return
    const over = (e) => { e.preventDefault(); setDragOver(true) }
    const leave = () => setDragOver(false)
    const drop = (e) => {
      e.preventDefault(); setDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file) loadFile(file)
    }
    el.addEventListener('dragover', over)
    el.addEventListener('dragleave', leave)
    el.addEventListener('drop', drop)
    return () => { el.removeEventListener('dragover', over); el.removeEventListener('dragleave', leave); el.removeEventListener('drop', drop) }
  }, [loadFile])

  // Generate theme from image
  const generate = useCallback(async () => {
    if (!image || !themeName.trim()) return
    setLoading(true); setError(null); setResult(null)
    setPreviewing(false); setWritten(false)
    try {
      const data = await apiFetch('/api/jarvis/theme-from-image', {
        method: 'POST',
        body: JSON.stringify({
          image_b64:       image.dataUrl,
          name:            themeName.trim(),
          description:     description.trim(),
          use_as_wallpaper: useAsWallpaper,
          n_colors:        nColors,
        }),
        timeoutMs: 90_000,
      })
      const json = await data.json()
      if (!json.ok) throw new Error(json.error ?? 'Generation failed')
      setResult(json.theme)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [image, themeName, description, useAsWallpaper, nColors])

  // Preview theme
  const togglePreview = useCallback(() => {
    if (!result) return
    if (previewing) {
      removePreview()
      setPreviewing(false)
    } else {
      applyPreview(result)
      setPreviewing(true)
    }
  }, [result, previewing])

  // Write to themes.js permanently
  const writeTheme = useCallback(async () => {
    if (!result) return
    setWriting(true); setError(null)
    try {
      // Get an approval token first
      const tokenResp = await apiFetch('/api/jarvis/issue-token', { method: 'POST' })
      const tokenJson = await tokenResp.json()
      const token = tokenJson.token
      if (!token) throw new Error('Could not get approval token')

      const writeResp = await apiFetch('/api/jarvis/write-theme', {
        method: 'POST',
        body: JSON.stringify({ approval_token: token, theme: result }),
        timeoutMs: 30_000,
      })
      const writeJson = await writeResp.json()
      if (!writeJson.ok) throw new Error(writeJson.error ?? 'Write failed')

      setWritten(true)
      onThemeCreated?.(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setWriting(false)
    }
  }, [result, onThemeCreated])

  // Cleanup preview on unmount
  useEffect(() => () => { if (previewing) removePreview() }, [previewing])

  return (
    <div className={styles.overlay} role="dialog" aria-label="Image Theme Creator">
      <div className={styles.modal}>

        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.headerIcon}>🎨</span>
            <div>
              <h2 className={styles.title}>Image → Theme</h2>
              <p className={styles.subtitle}>Upload any image — JARVIS extracts colors and builds a complete theme</p>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.body}>
          {/* Left: upload + controls */}
          <div className={styles.left}>

            {/* Drop zone */}
            <div
              ref={dropRef}
              className={`${styles.dropZone} ${dragOver ? styles.dropOver : ''} ${image ? styles.dropZoneHasImage : ''}`}
              onClick={() => fileRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && fileRef.current?.click()}
              aria-label="Upload image"
            >
              {image ? (
                <img src={image.dataUrl} alt="Theme reference" className={styles.preview} />
              ) : (
                <div className={styles.dropPrompt}>
                  <span className={styles.dropIcon}>🖼</span>
                  <span className={styles.dropText}>Drop image here or click to browse</span>
                  <span className={styles.dropHint}>PNG · JPG · WEBP · GIF · up to 20MB</span>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => e.target.files?.[0] && loadFile(e.target.files[0])}
            />

            {/* Controls */}
            <div className={styles.controls}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="theme-name">Theme Name *</label>
                <input
                  id="theme-name"
                  className={styles.input}
                  value={themeName}
                  onChange={e => setThemeName(e.target.value)}
                  placeholder="e.g. Ocean Breeze, Crimson Forge, Aurora…"
                  maxLength={60}
                  autoComplete="off"
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="theme-desc">Description (optional)</label>
                <input
                  id="theme-desc"
                  className={styles.input}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="e.g. Dark ocean vibes with teal accents"
                  maxLength={200}
                />
              </div>

              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label className={styles.label}>Colors to extract</label>
                  <div className={styles.colorCountRow}>
                    <input type="range" min={4} max={20} step={2} value={nColors}
                      onChange={e => setNColors(Number(e.target.value))}
                      className={styles.slider} aria-label={`Extract ${nColors} colors`} />
                    <span className={styles.colorCountVal}>{nColors}</span>
                  </div>
                </div>

                <label className={styles.checkboxField}>
                  <input type="checkbox" checked={useAsWallpaper}
                    onChange={e => setUseAsWallpaper(e.target.checked)} />
                  <span>Use image as wallpaper</span>
                </label>
              </div>

              <button
                className={styles.generateBtn}
                onClick={generate}
                disabled={!image || !themeName.trim() || loading}
                aria-busy={loading}
              >
                {loading
                  ? <><span className={styles.spinner} /> Extracting colors & building theme…</>
                  : '⚡ Generate Theme from Image'}
              </button>
            </div>

            {error && <div className={styles.error} role="alert">⚠ {error}</div>}
          </div>

          {/* Right: result */}
          <div className={styles.right}>
            {result ? (
              <ThemeResult
                theme={result}
                previewing={previewing}
                written={written}
                writing={writing}
                onTogglePreview={togglePreview}
                onWrite={writeTheme}
              />
            ) : (
              <div className={styles.emptyResult}>
                <span className={styles.emptyIcon}>🎭</span>
                <span className={styles.emptyText}>
                  {loading ? 'Analyzing image…' : 'Upload an image and click Generate'}
                </span>
                <span className={styles.emptyHint}>
                  JARVIS will extract the dominant colors, build all CSS variables,
                  assign accent / bull / bear / AI colors, and prepare a complete theme
                  ready to preview and apply.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Theme Result Panel ────────────────────────────────────────────────────────

function ThemeResult({ theme, previewing, written, writing, onTogglePreview, onWrite }) {
  const hex = theme.palette_hex ?? theme.palette ?? []
  const score = theme.score ?? 0
  const hints = theme.style_hints ?? []

  return (
    <div className={styles.result}>
      {/* Theme header */}
      <div className={styles.resultHeader}>
        <span className={styles.resultEmoji}>{theme.emoji ?? '🎨'}</span>
        <div>
          <div className={styles.resultName}>{theme.name}</div>
          <div className={styles.resultMeta}>
            {theme.category} · score {score}/100 · {hex.length} colors
          </div>
        </div>
        <div className={`${styles.scoreBadge} ${score >= 60 ? styles.scoreGood : score >= 40 ? styles.scoreOk : styles.scoreLow}`}>
          {score >= 60 ? '★★★' : score >= 40 ? '★★' : '★'}
        </div>
      </div>

      {/* Description */}
      {theme.description && (
        <p className={styles.resultDesc}>{theme.description}</p>
      )}

      {/* Style hints */}
      {hints.length > 0 && (
        <div className={styles.hintChips}>
          {hints.map(h => <span key={h} className={styles.hintChip}>{h.replace('_', ' ')}</span>)}
        </div>
      )}

      {/* Extracted palette */}
      <div className={styles.paletteSection}>
        <span className={styles.paletteLbl}>Extracted Palette</span>
        <div className={styles.swatches}>
          {hex.map((c, i) => (
            <div key={i} className={styles.swatch} style={{ background: c }} title={c}>
              <span className={styles.swatchHex}>{c}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Key CSS vars preview */}
      <div className={styles.varsPreview}>
        {[
          ['Accent',     theme.vars?.['--color-accent']],
          ['Background', theme.vars?.['--color-bg-base']],
          ['Text',       theme.vars?.['--color-text-primary']],
          ['Bull',       theme.vars?.['--color-bull']],
          ['Bear',       theme.vars?.['--color-bear']],
          ['AI',         theme.vars?.['--color-ai']],
        ].filter(([, v]) => v).map(([label, val]) => (
          <div key={label} className={styles.varRow}>
            <span className={styles.varSwatch} style={{ background: val }} />
            <span className={styles.varLabel}>{label}</span>
            <span className={styles.varVal}>{val}</span>
          </div>
        ))}
      </div>

      {/* Wallpaper thumbnail */}
      {theme.wallpapers?.[0]?.url && (
        <div className={styles.wallpaperThumb}>
          <span className={styles.paletteLbl}>Wallpaper (from your image)</span>
          <img
            src={theme.wallpapers[0].thumbnail ?? theme.wallpapers[0].url}
            alt="Theme wallpaper"
            className={styles.wallpaperImg}
            loading="lazy"
          />
        </div>
      )}

      {/* Actions */}
      <div className={styles.actions}>
        <button
          className={`${styles.previewBtn} ${previewing ? styles.previewBtnActive : ''}`}
          onClick={onTogglePreview}
        >
          {previewing ? '⊠ Stop Preview' : '👁 Preview Live'}
        </button>

        {written ? (
          <div className={styles.writtenBadge}>✓ Theme saved! Reload the app to use it.</div>
        ) : (
          <button
            className={styles.writeBtn}
            onClick={onWrite}
            disabled={writing}
          >
            {writing
              ? <><span className={styles.spinner} /> Saving…</>
              : `💾 Save "${theme.name}" to App`}
          </button>
        )}
      </div>

      {previewing && (
        <div className={styles.previewNote}>
          🎨 Preview is live — the app is using this theme right now.
          Click "Stop Preview" or close this dialog to revert.
        </div>
      )}
    </div>
  )
}

export default ImageThemeCreator
