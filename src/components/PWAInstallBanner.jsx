/**
 * PWAInstallBanner — "Add to Home Screen" prompt.
 *
 * Shows a native-looking install banner on mobile when:
 *   1. The browser fires the `beforeinstallprompt` event (Android Chrome)
 *   2. The app is not already installed (display-mode: standalone check)
 *   3. User hasn't dismissed the banner in the last 7 days
 *
 * iOS doesn't support beforeinstallprompt — shows a manual instruction
 * for "Add to Home Screen" via Safari share menu.
 *
 * WCAG AA compliant — fully keyboard navigable, ARIA roles set.
 */

import { useState, useEffect } from 'react'

const DISMISSED_KEY = 'sm_pwa_dismissed'
const DISMISS_TTL   = 7 * 24 * 60 * 60 * 1000  // 7 days

function isInstalled() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

function wasDismissed() {
  try {
    const ts = localStorage.getItem(DISMISSED_KEY)
    return ts && (Date.now() - Number(ts)) < DISMISS_TTL
  } catch { return false }
}

function dismiss() {
  try { localStorage.setItem(DISMISSED_KEY, String(Date.now())) } catch {}
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
}

export function PWAInstallBanner() {
  const [installPrompt, setInstallPrompt] = useState(null)
  const [showIOS,       setShowIOS]       = useState(false)
  const [visible,       setVisible]       = useState(false)

  useEffect(() => {
    if (isInstalled() || wasDismissed()) return

    // Android Chrome — listen for the native install prompt
    function handleBeforeInstall(e) {
      e.preventDefault()
      setInstallPrompt(e)
      setVisible(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall)

    // iOS Safari — no beforeinstallprompt, show manual instructions
    if (isIOS() && !isInstalled()) {
      // Show after a 3s delay so it doesn't appear immediately on login
      const t = setTimeout(() => {
        setShowIOS(true)
        setVisible(true)
      }, 3000)
      return () => { clearTimeout(t); window.removeEventListener('beforeinstallprompt', handleBeforeInstall) }
    }

    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
  }, [])

  function handleInstall() {
    if (!installPrompt) return
    installPrompt.prompt()
    installPrompt.userChoice.then(choice => {
      if (choice.outcome === 'accepted') {
        setVisible(false)
      }
    })
    setInstallPrompt(null)
  }

  function handleDismiss() {
    dismiss()
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      id="pwa-install-banner"
      role="dialog"
      aria-label="Install StockMind AI"
      aria-modal="false"
    >
      <span className="pwa-icon" aria-hidden="true">📱</span>
      <div className="pwa-text">
        <div className="pwa-title">Install StockMind AI</div>
        <div className="pwa-desc">
          {showIOS
            ? 'Tap the Share button → "Add to Home Screen" in Safari'
            : 'Add to your home screen for the best experience'}
        </div>
      </div>
      {!showIOS && (
        <button
          className="pwa-install-btn"
          onClick={handleInstall}
          aria-label="Install app"
        >
          Install
        </button>
      )}
      <button
        className="pwa-dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss install banner"
      >
        ✕
      </button>
    </div>
  )
}
