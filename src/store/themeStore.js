/**
 * themeStore — named sci-fi theme + night light intensity.
 *
 * Active theme: one of the 12 keys from themes.js (default: 'cyber-dark').
 * Night light: 0 = off, 100 = maximum warm amber tint.
 * Default night light: 30 (subtle warmth for long sessions).
 *
 * Theme vars are injected directly onto document.documentElement.style
 * so they override the :root defaults in index.css without touching the file.
 * Persisted to localStorage as 'sm_theme_v2'.
 *
 * Custom themes: JARVIS-generated themes can be previewed at runtime
 * without being written to themes.js. They are stored in the store's
 * customThemes map and applied the same way as built-in themes.
 */

import { create } from 'zustand'
import { getTheme, THEMES } from '@utils/themes.js'

const STORAGE_KEY      = 'sm_theme_v2'
const NIGHTLIGHT_KEY   = 'sm_nightlight'
const CUSTOM_THEMES_KEY = 'sm_custom_themes'

const DEFAULT_THEME       = 'cyber-dark'
const DEFAULT_NIGHT_LIGHT = 30

// ── Persistence helpers ───────────────────────────────────────────────────────

function loadActiveTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return stored  // allow custom theme keys too
  } catch { /* ignore */ }
  return DEFAULT_THEME
}

function loadNightLight() {
  try {
    const v = localStorage.getItem(NIGHTLIGHT_KEY)
    if (v !== null) return Math.max(0, Math.min(100, Number(v)))
  } catch { /* ignore */ }
  return DEFAULT_NIGHT_LIGHT
}

function loadCustomThemes() {
  try {
    const stored = localStorage.getItem(CUSTOM_THEMES_KEY)
    if (stored) return JSON.parse(stored)
  } catch { /* ignore */ }
  return {}
}

function saveCustomThemes(themes) {
  try {
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes))
  } catch { /* ignore */ }
}

// ── CSS application ───────────────────────────────────────────────────────────

/**
 * Apply a named theme + night light to the document root.
 * Applies: CSS vars, fonts, border radii, motion speeds, body background, shadows.
 * Works for both built-in themes and runtime custom themes.
 */
export function applyTheme(themeKey, nightLight, customThemes = {}) {
  // Look up in built-in themes first, then custom themes
  const rawTheme = THEMES[themeKey] ?? customThemes[themeKey]
  const theme    = getTheme(themeKey)   // merged with defaults
  const root     = document.documentElement
  const body     = document.body

  // ── data-theme attribute ──────────────────────────────────────────────────
  const isLight = themeKey === 'light-clean' || rawTheme?.category === 'light'
  root.setAttribute('data-theme', isLight ? 'light' : 'dark')

  // ── CSS color vars ────────────────────────────────────────────────────────
  const vars = theme?.vars ?? {}
  for (const [prop, value] of Object.entries(vars)) {
    root.style.setProperty(prop, value)
  }

  // ── Typography ────────────────────────────────────────────────────────────
  if (theme.fonts) {
    root.style.setProperty('--font-sans',    theme.fonts.sans)
    root.style.setProperty('--font-mono',    theme.fonts.mono)
    root.style.setProperty('--font-display', theme.fonts.display)
  }

  // ── Border radii ──────────────────────────────────────────────────────────
  if (theme.radii) {
    root.style.setProperty('--radius-sm',  theme.radii.sm)
    root.style.setProperty('--radius-md',  theme.radii.md)
    root.style.setProperty('--radius-lg',  theme.radii.lg)
    root.style.setProperty('--radius-xl',  theme.radii.xl)
    root.style.setProperty('--radius-2xl', theme.radii['2xl'])
  }

  // ── Motion speeds ─────────────────────────────────────────────────────────
  if (theme.motion) {
    root.style.setProperty('--transition-fast',   theme.motion.fast)
    root.style.setProperty('--transition-normal', theme.motion.normal)
    root.style.setProperty('--transition-slow',   theme.motion.slow)
  }

  // ── Shadows ───────────────────────────────────────────────────────────────
  if (theme.shadows) {
    if (theme.shadows.sm)   root.style.setProperty('--shadow-sm',   theme.shadows.sm)
    if (theme.shadows.md)   root.style.setProperty('--shadow-md',   theme.shadows.md)
    if (theme.shadows.lg)   root.style.setProperty('--shadow-lg',   theme.shadows.lg)
    if (theme.shadows.card) root.style.setProperty('--shadow-card', theme.shadows.card)
    if (theme.shadows.glowAccent) root.style.setProperty('--shadow-glow-accent', theme.shadows.glowAccent)
    if (theme.shadows.glowAI)     root.style.setProperty('--shadow-glow-ai',     theme.shadows.glowAI)
  }

  // ── Body background ───────────────────────────────────────────────────────
  // Apply background color, image/pattern, and optional overlay
  if (theme.bg) {
    const bgColor = theme.bg.color ?? vars['--color-bg-base'] ?? ''
    const gridLine = vars['--grid-line'] ?? 'transparent'

    body.style.backgroundColor = bgColor

    if (theme.bg.wallpaperUrl) {
      // Wallpaper mode: overlay + image
      const overlay = theme.bg.overlay ?? 'linear-gradient(rgba(0,0,0,0.85), rgba(0,0,0,0.85))'
      body.style.backgroundImage    = `${overlay}, url('${theme.bg.wallpaperUrl}')`
      body.style.backgroundSize     = `auto, cover`
      body.style.backgroundPosition = `center, center`
      body.style.backgroundAttachment = `fixed, fixed`
      body.style.backgroundRepeat   = `no-repeat, no-repeat`
    } else {
      // Pattern mode
      const bgImages = []
      if (theme.bg.overlay && theme.bg.overlay !== 'none') bgImages.push(theme.bg.overlay)
      if (theme.bg.image) {
        bgImages.push(theme.bg.image)
      } else {
        bgImages.push(`linear-gradient(${gridLine} 1px, transparent 1px)`)
        bgImages.push(`linear-gradient(90deg, ${gridLine} 1px, transparent 1px)`)
      }
      body.style.backgroundImage    = bgImages.join(', ')
      body.style.backgroundSize     = theme.bg.size ?? '40px 40px'
      body.style.backgroundPosition = 'center'
      body.style.backgroundAttachment = theme.bg.attachment ?? 'fixed'
      body.style.backgroundRepeat   = 'repeat'
    }
  }

  // ── Night light ───────────────────────────────────────────────────────────
  const nl = isLight ? 0 : nightLight
  if (nl > 0) {
    const intensity  = nl / 100
    const warmth     = Math.round(intensity * 18)
    const sepia      = Math.round(intensity * 22)
    const brightness = Math.round(100 - intensity * 12)
    root.style.setProperty('--night-light', String(nl))
    root.style.setProperty('--night-filter',
      `sepia(${sepia}%) brightness(${brightness}%) hue-rotate(-${warmth}deg)`)
  } else {
    root.style.setProperty('--night-light', '0')
    root.style.setProperty('--night-filter', 'none')
  }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useThemeStore = create((set, get) => {
  const activeTheme  = loadActiveTheme()
  const nightLight   = loadNightLight()
  const customThemes = loadCustomThemes()

  // Apply on init
  applyTheme(activeTheme, nightLight, customThemes)

  return {
    activeTheme,
    nightLight,
    customThemes,   // { [key]: { name, description, category, emoji, vars } }

    // Legacy compat — some components check theme === 'dark' / 'light'
    get theme() {
      const t = THEMES[get().activeTheme] ?? get().customThemes[get().activeTheme]
      return t?.category === 'light' ? 'light' : 'dark'
    },

    setTheme(themeKey) {
      const isBuiltIn = !!THEMES[themeKey]
      const isCustom  = !!get().customThemes[themeKey]
      if (!isBuiltIn && !isCustom) return
      localStorage.setItem(STORAGE_KEY, themeKey)
      applyTheme(themeKey, get().nightLight, get().customThemes)
      set({ activeTheme: themeKey })
    },

    // Legacy toggle — switches between cyber-dark and light-clean
    toggleTheme() {
      const next = get().activeTheme === 'light-clean' ? 'cyber-dark' : 'light-clean'
      get().setTheme(next)
    },

    setNightLight(value) {
      const clamped = Math.max(0, Math.min(100, Math.round(value)))
      localStorage.setItem(NIGHTLIGHT_KEY, String(clamped))
      applyTheme(get().activeTheme, clamped, get().customThemes)
      set({ nightLight: clamped })
    },

    /**
     * Add a JARVIS-generated theme to the runtime store.
     * The theme is available immediately for preview without reloading.
     * It is NOT written to themes.js until writeTheme() is called.
     * @param {object} theme — generated theme object from JARVIS
     */
    addCustomTheme(theme) {
      if (!theme?.key || !theme?.vars) return
      const updated = { ...get().customThemes, [theme.key]: theme }
      saveCustomThemes(updated)
      set({ customThemes: updated })
    },

    /**
     * Remove a custom theme from the runtime store.
     * Does NOT remove it from themes.js if it was already written.
     * @param {string} key
     */
    removeCustomTheme(key) {
      const updated = { ...get().customThemes }
      delete updated[key]
      saveCustomThemes(updated)
      // If this was the active theme, switch to default
      if (get().activeTheme === key) {
        get().setTheme(DEFAULT_THEME)
      }
      set({ customThemes: updated })
    },

    /**
     * Preview a theme object without saving it.
     * Applies the vars immediately but doesn't persist.
     * Handles wallpaper backgrounds.
     * @param {object} theme
     */
    previewTheme(theme) {
      if (!theme?.vars) return
      const root = document.documentElement
      const body = document.body
      const isLight = theme.category === 'light'
      root.setAttribute('data-theme', isLight ? 'light' : 'dark')
      for (const [prop, value] of Object.entries(theme.vars)) {
        root.style.setProperty(prop, value)
      }
      // Apply wallpaper if present
      if (theme.bg?.wallpaperUrl) {
        const overlay = theme.bg.overlay ?? 'linear-gradient(rgba(0,0,0,0.85), rgba(0,0,0,0.85))'
        body.style.backgroundImage    = `${overlay}, url('${theme.bg.wallpaperUrl}')`
        body.style.backgroundSize     = 'auto, cover'
        body.style.backgroundPosition = 'center, center'
        body.style.backgroundAttachment = 'fixed, fixed'
        body.style.backgroundRepeat   = 'no-repeat, no-repeat'
        body.style.backgroundColor    = theme.bg.color ?? theme.vars['--color-bg-base'] ?? ''
      }
    },

    /**
     * Cancel a preview — restore the active theme.
     */
    cancelPreview() {
      applyTheme(get().activeTheme, get().nightLight, get().customThemes)
    },
  }
})
