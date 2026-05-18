/**
 * TooltipPageControl — compact per-page tooltip preference bar.
 * Desktop: pill bar. Mobile: icon → panel.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTooltipStore } from '@store/tooltipStore.js'
import styles from './TooltipPageControl.module.css'

export function TooltipPageControl({ pageId, pageName }) {
  const getPageSettings = useTooltipStore(s => s.getPageSettings)
  const setPageOverride = useTooltipStore(s => s.setPageOverride)
  const setGlobal       = useTooltipStore(s => s.setGlobal)
  const globalEnabled   = useTooltipStore(s => s.enabled)
  const globalExamples  = useTooltipStore(s => s.showExamples)

  const { enabled, showExamples } = getPageSettings(pageId)
  const [mobileOpen, setMobileOpen] = useState(false)
  const panelRef   = useRef(null)
  const triggerRef = useRef(null)

  const handleOutside = useCallback((e) => {
    if (panelRef.current && !panelRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)) setMobileOpen(false)
  }, [])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { setMobileOpen(false); triggerRef.current?.focus() }
  }, [])

  useEffect(() => {
    if (mobileOpen) {
      document.addEventListener('mousedown', handleOutside)
      document.addEventListener('keydown',   handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown',   handleKeyDown)
    }
  }, [mobileOpen, handleOutside, handleKeyDown])

  const controls = (
    <>
      <label className={styles.toggle}>
        <button type="button" role="switch" aria-checked={enabled}
          aria-label={`Tooltips for ${pageName}: ${enabled ? 'on' : 'off'}`}
          className={`${styles.toggleBtn} ${enabled ? styles.toggleOn : styles.toggleOff}`}
          onClick={() => setPageOverride(pageId, !enabled, showExamples)}>
          <span className={styles.toggleThumb} aria-hidden="true" />
        </button>
        <span className={styles.toggleLabel}>{enabled ? 'On' : 'Off'}</span>
      </label>

      {enabled && (
        <label className={styles.toggle}>
          <button type="button" role="switch" aria-checked={showExamples}
            aria-label={`Examples: ${showExamples ? 'shown' : 'hidden'}`}
            className={`${styles.toggleBtn} ${styles.toggleSmall} ${showExamples ? styles.toggleOn : styles.toggleOff}`}
            onClick={() => setPageOverride(pageId, enabled, !showExamples)}>
            <span className={styles.toggleThumb} aria-hidden="true" />
          </button>
          <span className={styles.toggleLabel}>{showExamples ? 'Show examples' : 'Hide examples'}</span>
        </label>
      )}

      {globalEnabled && (
        <button type="button" className={styles.globalOff}
          onClick={() => { setGlobal(false, globalExamples); setMobileOpen(false) }}>
          Turn off all tips
        </button>
      )}
    </>
  )

  return (
    <div className={styles.root}>
      <div className={styles.bar} role="group" aria-label="Tooltip preferences">
        <span className={styles.label} aria-hidden="true">
          <span className={styles.labelIcon}>ⓘ</span> Tips
        </span>
        {controls}
      </div>

      <div className={styles.mobile}>
        <button ref={triggerRef} type="button"
          className={`${styles.mobileTrigger} ${enabled ? styles.mobileTriggerActive : ''}`}
          aria-label="Tooltip settings" aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(v => !v)}>
          <span aria-hidden="true">ⓘ</span>
        </button>
        {mobileOpen && (
          <div ref={panelRef} className={styles.mobilePanel} role="dialog" aria-label={`Tooltip settings for ${pageName}`}>
            <p className={styles.mobilePanelTitle}><span aria-hidden="true">ⓘ</span> Tips — {pageName}</p>
            <div className={styles.mobilePanelControls}>{controls}</div>
          </div>
        )}
      </div>
    </div>
  )
}
