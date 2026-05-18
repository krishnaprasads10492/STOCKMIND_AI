import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMarketStore, MARKET_MODULES } from '@store/marketStore.js'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import styles from './FavouritesPage.module.css'

// Group favourites by their module type
const TABS = [
  { id: 'all',        label: 'All',       icon: '★' },
  { id: 'indices-india',  label: 'Indices',  icon: '📈' },
  { id: 'equities-india', label: 'Equities', icon: '🏢' },
  { id: 'fno-india',      label: 'F&O',      icon: '⚡' },
  { id: 'crypto',         label: 'Crypto',   icon: '₿' },
  { id: 'forex',          label: 'Forex',    icon: '💱' },
  { id: 'commodities',    label: 'Commodities', icon: '🥇' },
  { id: 'global-indices', label: 'Global',   icon: '🌐' },
]

// Find which module a symbol belongs to
function findSymbolModule(symbol) {
  for (const mod of MARKET_MODULES) {
    const found = mod.symbols.find(s => s.symbol === symbol)
    if (found) return { mod, meta: found }
  }
  return null
}

export default function FavouritesPage() {
  const { favourites, toggleFavourite, setActiveModule, setActiveSymbol } = useMarketStore()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('all')

  // Build enriched favourite list
  const enriched = favourites
    .map(sym => {
      const found = findSymbolModule(sym)
      if (!found) return null
      return { symbol: sym, label: found.meta.label, basePrice: found.meta.basePrice, moduleId: found.mod.id, moduleLabel: found.mod.label, moduleIcon: found.mod.icon, exchange: found.mod.exchange }
    })
    .filter(Boolean)

  const filtered = activeTab === 'all'
    ? enriched
    : enriched.filter(f => f.moduleId === activeTab)

  function handlePredict(fav) {
    setActiveModule(fav.moduleId)
    setActiveSymbol(fav.symbol)
    navigate(`/predictions?module=${fav.moduleId}&symbol=${fav.symbol}`)
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Favourites</h1>
        <p className={styles.subtitle}>{favourites.length} saved — click ★ on any symbol to add</p>
      </div>

      {/* ── Tabs ── */}
      <div className={styles.tabs} role="tablist" aria-label="Filter by market">
        {TABS.map(tab => {
          const count = tab.id === 'all'
            ? enriched.length
            : enriched.filter(f => f.moduleId === tab.id).length
          if (tab.id !== 'all' && count === 0) return null
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span aria-hidden="true">{tab.icon}</span>
              {tab.label}
              <span className={styles.tabCount}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* ── Content ── */}
      {filtered.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true">☆</span>
          <p>No favourites yet.</p>
          <p className={styles.emptyHint}>Click the ★ star on any symbol in the Symbol Picker to save it here.</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {filtered.map(fav => (
            <ErrorBoundary key={fav.symbol} fallbackMessage="">
              <FavCard
                fav={fav}
                onPredict={() => handlePredict(fav)}
                onRemove={() => toggleFavourite(fav.symbol)}
              />
            </ErrorBoundary>
          ))}
        </div>
      )}
    </div>
  )
}

function FavCard({ fav, onPredict, onRemove }) {
  // Simulate a price change for display
  const change = ((Math.random() - 0.48) * fav.basePrice * 0.015)
  const pct    = (change / fav.basePrice * 100).toFixed(2)
  const up     = change >= 0

  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <div className={styles.cardMeta}>
          <span className={styles.cardModule}>
            <span aria-hidden="true">{fav.moduleIcon}</span> {fav.moduleLabel}
          </span>
          <span className={styles.cardExchange}>{fav.exchange}</span>
        </div>
        <button
          className={styles.removeBtn}
          onClick={onRemove}
          aria-label={`Remove ${fav.symbol} from favourites`}
          title="Remove from favourites"
        >★</button>
      </div>

      <div className={styles.cardSymbol}>{fav.symbol}</div>
      <div className={styles.cardLabel}>{fav.label}</div>

      <div className={styles.cardPrice}>
        <span className={styles.price}>
          {fav.basePrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </span>
        <span className={`${styles.change} ${up ? styles.up : styles.down}`}>
          {up ? '▲' : '▼'} {Math.abs(Number(pct))}%
        </span>
      </div>

      <button className={styles.predictBtn} onClick={onPredict}>
        ⚡ Predict
      </button>
    </div>
  )
}
