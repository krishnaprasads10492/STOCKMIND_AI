/**
 * InfoTooltip — reusable ⓘ icon with overlay panel.
 *
 * Features:
 *   - Keyboard accessible (Enter/Space to open, Escape to close)
 *   - Respects global infoTooltips + showExamples preferences
 *   - Optional example block (customisable or removable)
 *   - Click-outside to dismiss
 *   - Positions itself to stay within viewport
 *
 * Usage:
 *   <InfoTooltip
 *     title="What is Probability?"
 *     content="The likelihood this signal hits T1 before SL."
 *     example={{ label: 'Example', text: '78% means ~22% chance of being wrong.' }}
 *     page="backtest"
 *   />
 */

import { useState, useRef, useEffect, useId } from 'react'
import { useUiPrefsStore } from '@store/uiPrefsStore.js'
import styles from './InfoTooltip.module.css'

export function InfoTooltip({ title, content, example, page, size = 'sm' }) {
  const { isTooltipVisible, showExamples } = useUiPrefsStore()
  const [open, setOpen] = useState(false)
  const btnRef  = useRef(null)
  const panelRef = useRef(null)
  const id = useId()

  // Don't render if tooltips are disabled for this page
  if (!isTooltipVisible(page)) return null

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (panelRef.current && !panelRef.current.contains(e.target) &&
          btnRef.current && !btnRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handler(e) { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() } }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  return (
    <span className={`${styles.wrap} ${styles[`size${size.toUpperCase()}`]}`}>
      <button
        ref={btnRef}
        type="button"
        className={styles.btn}
        onClick={() => setOpen(s => !s)}
        aria-label={`Info: ${title}`}
        aria-expanded={open}
        aria-controls={id}
      >
        ⓘ
      </button>

      {open && (
        <div
          ref={panelRef}
          id={id}
          className={styles.panel}
          role="tooltip"
          aria-live="polite"
        >
          <div className={styles.header}>
            <span className={styles.title}>{title}</span>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={() => setOpen(false)}
              aria-label="Close info"
            >×</button>
          </div>

          <p className={styles.content}>{content}</p>

          {example && showExamples && (
            <div className={styles.example}>
              <span className={styles.exampleLabel}>{example.label ?? 'Example'}</span>
              <p className={styles.exampleText}>{example.text}</p>
            </div>
          )}
        </div>
      )}
    </span>
  )
}
