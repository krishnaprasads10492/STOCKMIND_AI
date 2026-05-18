/**
 * SymbolPicker — searchable symbol dropdown with favourites.
 *
 * Features:
 * - Shows all symbols for the active market module
 * - Favourites pinned to top with ★ star toggle
 * - Keyboard search filters the list in real time
 * - Keyboard navigable (arrow keys, Enter, Escape)
 * - Shows symbol + full name
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useMarketStore } from '@store/marketStore.js'
import styles from './SymbolPicker.module.css'

export function SymbolPicker({ value, onChange, disabled = false }) {
  const { getActiveModule, favourites, toggleFavourite } = useMarketStore()
  const mod = getActiveModule()
  const symbols = mod.symbols

  const [open,   setOpen]   = useState(false)
  const [query,  setQuery]  = useState('')
  const [cursor, setCursor] = useState(-1)

  const wrapperRef  = useRef(null)
  const inputRef    = useRef(null)
  const listRef     = useRef(null)

  const selected = symbols.find(s => s.symbol === value) ?? symbols[0]

  // Filtered + sorted: favourites first, then alphabetical
  const filtered = symbols
    .filter(s =>
      !query ||
      s.symbol.toLowerCase().includes(query.toLowerCase()) ||
      s.label.toLowerCase().includes(query.toLowerCase())
    )
    .sort((a, b) => {
      const aFav = favourites.includes(a.symbol)
      const bFav = favourites.includes(b.symbol)
      if (aFav && !bFav) return -1
      if (!aFav && bFav) return 1
      return 0
    })

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function openDropdown() {
    setOpen(true)
    setCursor(-1)
    setTimeout(() => inputRef.current?.focus(), 50)
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
        e.preventDefault()
        openDropdown()
      }
      return
    }
    if (e.key === 'Escape') { setOpen(false); setQuery(''); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(c => Math.min(c + 1, filtered.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => Math.max(c - 1, 0))
    }
    if (e.key === 'Enter' && cursor >= 0 && filtered[cursor]) {
      e.preventDefault()
      selectSymbol(filtered[cursor])
    }
  }, [open, cursor, filtered]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll cursor into view
  useEffect(() => {
    if (cursor >= 0 && listRef.current) {
      const item = listRef.current.children[cursor]
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [cursor])

  // Reset cursor when filter changes
  useEffect(() => { setCursor(-1) }, [query])

  const favSymbols = symbols.filter(s => favourites.includes(s.symbol))

  return (
    <div className={styles.wrapper} ref={wrapperRef} onKeyDown={handleKeyDown}>
      {/* ── Trigger button ── */}
      <button
        type="button"
        className={`${styles.trigger} ${disabled ? styles.disabled : ''}`}
        onClick={() => open ? setOpen(false) : openDropdown()}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Symbol: ${selected?.label ?? value}`}
        disabled={disabled}
      >
        <span className={styles.triggerSymbol}>{selected?.symbol ?? value}</span>
        <span className={styles.triggerLabel}>{selected?.label}</span>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label="Select symbol">
          {/* ── Search ── */}
          <div className={styles.searchRow}>
            <span className={styles.searchIcon} aria-hidden="true">🔍</span>
            <input
              ref={inputRef}
              className={styles.searchInput}
              type="text"
              placeholder={`Search ${mod.label}…`}
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Search symbols"
              autoComplete="off"
            />
            {query && (
              <button className={styles.clearBtn} onClick={() => setQuery('')} aria-label="Clear search">✕</button>
            )}
          </div>

          {/* ── Favourites strip (when no search query) ── */}
          {!query && favSymbols.length > 0 && (
            <div className={styles.favStrip}>
              <span className={styles.favStripLabel}>★ Favourites</span>
              <div className={styles.favChips}>
                {favSymbols.map(s => (
                  <button
                    key={s.symbol}
                    type="button"
                    className={`${styles.favChip} ${s.symbol === value ? styles.favChipActive : ''}`}
                    onClick={() => selectSymbol(s)}
                    title={s.label}
                  >
                    {s.symbol}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Symbol list ── */}
          <ul
            ref={listRef}
            className={styles.list}
            role="listbox"
            aria-label="Symbols"
          >
            {filtered.length === 0 && (
              <li className={styles.empty}>No symbols match "{query}"</li>
            )}
            {filtered.map((s, i) => {
              const isFav = favourites.includes(s.symbol)
              const isSelected = s.symbol === value
              return (
                <li
                  key={s.symbol}
                  role="option"
                  aria-selected={isSelected}
                  className={`${styles.item} ${isSelected ? styles.itemSelected : ''} ${i === cursor ? styles.itemCursor : ''}`}
                  onClick={() => selectSymbol(s)}
                >
                  <div className={styles.itemMain}>
                    <span className={styles.itemSymbol}>{s.symbol}</span>
                    <span className={styles.itemLabel}>{s.label}</span>
                  </div>
                  <div className={styles.itemRight}>
                    {isSelected && <span className={styles.selectedCheck} aria-hidden="true">✓</span>}
                    <button
                      type="button"
                      className={`${styles.starBtn} ${isFav ? styles.starActive : ''}`}
                      onClick={e => { e.stopPropagation(); toggleFavourite(s.symbol) }}
                      aria-label={isFav ? `Remove ${s.symbol} from favourites` : `Add ${s.symbol} to favourites`}
                      title={isFav ? 'Remove from favourites' : 'Add to favourites'}
                    >
                      {isFav ? '★' : '☆'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>

          <div className={styles.footer}>
            <span>{mod.exchange}</span>
            <span>{filtered.length} symbol{filtered.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      )}
    </div>
  )
}
