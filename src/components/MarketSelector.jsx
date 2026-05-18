/**
 * MarketSelector — top-right market picker in the AppShell topbar.
 * Clicking it opens a dropdown of all 7 market modules.
 * Selection updates the global marketStore and reactively changes
 * Dashboard + Predictions.
 */

import { useState, useRef, useEffect } from 'react'
import { useMarketStore, MARKET_MODULES } from '@store/marketStore.js'
import styles from './MarketSelector.module.css'

export function MarketSelector() {
  const { activeModuleId, setActiveModule } = useMarketStore()
  const active = MARKET_MODULES.find(m => m.id === activeModuleId) ?? MARKET_MODULES[0]

  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Close on Escape
  useEffect(() => {
    function handler(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  function select(id) {
    setActiveModule(id)
    setOpen(false)
  }

  return (
    <div className={styles.wrapper} ref={ref}>
      <button
        className={styles.trigger}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Active market: ${active.label}`}
      >
        <span className={styles.icon} aria-hidden="true">{active.icon}</span>
        <span className={styles.label}>{active.label}</span>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden="true">▾</span>
      </button>

      {open && (
        <ul
          className={styles.dropdown}
          role="listbox"
          aria-label="Select market"
        >
          {MARKET_MODULES.map(mod => (
            <li
              key={mod.id}
              role="option"
              aria-selected={mod.id === activeModuleId}
              className={`${styles.option} ${mod.id === activeModuleId ? styles.optionActive : ''}`}
              onClick={() => select(mod.id)}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && select(mod.id)}
              tabIndex={0}
            >
              <span className={styles.optionIcon} aria-hidden="true">{mod.icon}</span>
              <div className={styles.optionText}>
                <span className={styles.optionLabel}>{mod.label}</span>
                <span className={styles.optionDesc}>{mod.desc}</span>
              </div>
              {mod.id === activeModuleId && (
                <span className={styles.check} aria-hidden="true">✓</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
