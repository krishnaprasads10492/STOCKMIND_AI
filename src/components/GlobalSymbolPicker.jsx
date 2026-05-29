/**
 * GlobalSymbolPicker — searchable dropdown across ALL market modules.
 *
 * Unlike SymbolPicker (which only shows the active module), this shows
 * every symbol from every module — indices, equities, F&O, crypto, forex,
 * commodities, global indices — grouped by category.
 *
 * Props:
 *   value        — current symbol string
 *   exchange     — current exchange string (optional, for display)
 *   onChange(symbol, meta) — called when a symbol is selected
 *                            meta = { symbol, label, exchange, instrType, basePrice, ... }
 *   disabled     — disable the picker
 *   placeholder  — placeholder text on the trigger button
 *   showExchange — show exchange badge next to symbol (default true)
 *   size         — 'sm' | 'md' (default 'md')
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { MARKET_MODULES } from '@store/marketStore.js'
import styles from './GlobalSymbolPicker.module.css'

// Flatten all symbols with module metadata
const ALL_SYMBOLS = MARKET_MODULES.flatMap(mod =>
  mod.symbols.map(s => ({
    ...s,
    exchange:    mod.exchange,
    moduleId:    mod.id,
    moduleLabel: mod.label,
    moduleIcon:  mod.icon,
  }))
)

// Group by module for display
const GROUPED = MARKET_MODULES.map(mod => ({
  id:       mod.id,
  label:    mod.label,
  icon:     mod.icon,
  exchange: mod.exchange,
  symbols:  mod.symbols.map(s => ({ ...s, exchange: mod.exchange, moduleId: mod.id })),
}))

export function GlobalSymbolPicker({
  value,
  exchange,
  onChange,
  disabled    = false,
  placeholder = 'Select symbol',
  showExchange = true,
  size        = 'md',
}) {
  const [open,   setOpen]   = useState(false)
  const [query,  setQuery]  = useState('')
  const [cursor, setCursor] = useState(-1)

  const wrapperRef = useRef(null)
  const inputRef   = useRef(null)
  const listRef    = useRef(null)

  // Find selected symbol metadata
  const selected = useMemo(() =>
    ALL_SYMBOLS.find(s => s.symbol === value) ?? null
  , [value])

  // Filtered results — search across symbol + label + module
  const filtered = useMemo(() => {
    if (!query) return []
    const q = query.toLowerCase()
    return ALL_SYMBOLS.filter(s =>
      s.symbol.toLowerCase().includes(q) ||
      s.label.toLowerCase().includes(q) ||
      s.moduleLabel.toLowerCase().includes(q)
    ).slice(0, 40)
  }, [query])

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false)
        setQuery('')
        setCursor(-1)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function openDropdown() {
    if (disabled) return
    setOpen(true)
    setCursor(-1)
    setTimeout(() => inputRef.current?.focus(), 30)
  }

  function selectSymbol(sym) {
    onChange(sym.symbol, sym)
    setOpen(false)
    setQuery('')
    setCursor(-1)
  }

  const handleKeyDown = useCallback((e) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault(); openDropdown()
      }
      return
    }
    if (e.key === 'Escape') { setOpen(false); setQuery(''); return }
    const list = query ? filtered : ALL_SYMBOLS
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, list.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    if (e.key === 'Enter' && cursor >= 0 && list[cursor]) {
      e.preventDefault(); selectSymbol(list[cursor])
    }
  }, [open, cursor, filtered, query]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll cursor into view
  useEffect(() => {
    if (cursor >= 0 && listRef.current) {
      listRef.current.children[cursor]?.scrollIntoView({ block: 'nearest' })
    }
  }, [cursor])

  useEffect(() => { setCursor(-1) }, [query])

  const triggerLabel = selected
    ? `${selected.symbol} — ${selected.label}`
    : value || placeholder

  return (
    <div
      className={`${styles.wrapper} ${styles[`size_${size}`]} ${disabled ? styles.disabled : ''}`}
      ref={wrapperRef}
      onKeyDown={handleKeyDown}
    >
      {/* ── Trigger ── */}
      <button
        type="button"
        className={styles.trigger}
        onClick={() => open ? setOpen(false) : openDropdown()}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Symbol: ${triggerLabel}`}
        disabled={disabled}
      >
        <span className={styles.triggerLeft}>
          {selected?.moduleIcon && (
            <span className={styles.triggerModIcon} aria-hidden="true">{selected.moduleIcon}</span>
          )}
          <span className={styles.triggerSymbol}>{value || placeholder}</span>
          {selected && (
            <span className={styles.triggerLabel}>{selected.label}</span>
          )}
        </span>
        <span className={styles.triggerRight}>
          {showExchange && (selected?.exchange || exchange) && (
            <span className={styles.exchangeBadge}>{selected?.exchange ?? exchange}</span>
          )}
          <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden="true">▾</span>
        </span>
      </button>

      {/* ── Dropdown panel ── */}
      {open && (
        <div className={styles.panel} role="dialog" aria-label="Select symbol">
          {/* Search */}
          <div className={styles.searchRow}>
            <span className={styles.searchIcon} aria-hidden="true">🔍</span>
            <input
              ref={inputRef}
              className={styles.searchInput}
              type="text"
              placeholder="Search any symbol, name, or market…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Search symbols"
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button className={styles.clearBtn} onClick={() => setQuery('')} aria-label="Clear">✕</button>
            )}
          </div>

          {/* Search results */}
          {query && (
            <ul ref={listRef} className={styles.list} role="listbox">
              {filtered.length === 0 && (
                <li className={styles.empty}>No symbols match "{query}"</li>
              )}
              {filtered.map((s, i) => (
                <SymbolOption
                  key={`${s.moduleId}:${s.symbol}`}
                  sym={s}
                  isSelected={s.symbol === value}
                  isCursor={i === cursor}
                  onSelect={selectSymbol}
                  showModule
                />
              ))}
            </ul>
          )}

          {/* Grouped browse (no search) */}
          {!query && (
            <div className={styles.groups} ref={listRef}>
              {GROUPED.map(group => (
                <div key={group.id} className={styles.group}>
                  <div className={styles.groupHeader}>
                    <span className={styles.groupIcon}>{group.icon}</span>
                    <span className={styles.groupLabel}>{group.label}</span>
                    <span className={styles.groupExchange}>{group.exchange}</span>
                  </div>
                  <div className={styles.groupSymbols}>
                    {group.symbols.map(s => (
                      <button
                        key={s.symbol}
                        type="button"
                        className={`${styles.groupChip} ${s.symbol === value ? styles.groupChipActive : ''}`}
                        onClick={() => selectSymbol(s)}
                        title={s.label}
                      >
                        <span className={styles.chipSymbol}>{s.symbol}</span>
                        <span className={styles.chipLabel}>{s.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className={styles.footer}>
            <span>{ALL_SYMBOLS.length} symbols across {MARKET_MODULES.length} markets</span>
            <span className={styles.footerHint}>↑↓ navigate · Enter select · Esc close</span>
          </div>
        </div>
      )}
    </div>
  )
}

function SymbolOption({ sym, isSelected, isCursor, onSelect, showModule }) {
  return (
    <li
      role="option"
      aria-selected={isSelected}
      className={`${styles.item} ${isSelected ? styles.itemSelected : ''} ${isCursor ? styles.itemCursor : ''}`}
      onClick={() => onSelect(sym)}
    >
      <div className={styles.itemMain}>
        <span className={styles.itemSymbol}>{sym.symbol}</span>
        <span className={styles.itemLabel}>{sym.label}</span>
      </div>
      <div className={styles.itemRight}>
        {showModule && (
          <span className={styles.itemModule}>{sym.moduleIcon} {sym.exchange}</span>
        )}
        {isSelected && <span className={styles.selectedCheck} aria-hidden="true">✓</span>}
      </div>
    </li>
  )
}
