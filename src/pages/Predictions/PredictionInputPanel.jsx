import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMarketStore, MARKET_MODULES } from '@store/marketStore.js'
import { SymbolPicker } from '@components/SymbolPicker.jsx'
import { OptionsPanel } from '@components/OptionsPanel.jsx'
import { FuturesPanel } from '@components/FuturesPanel.jsx'
import styles from './PredictionsPage.module.css'

export function PredictionInputPanel({ defaultCapital, defaultRisk, onGenerate, loading }) {
  const [searchParams] = useSearchParams()
  const {
    activeModuleId, activeSymbol,
    setActiveModule, setActiveSymbol,
    getActiveModule, getActiveSymbolMeta,
  } = useMarketStore()

  // Honour ?module= and ?symbol= query params on mount
  useEffect(() => {
    const qModule = searchParams.get('module')
    const qSymbol = searchParams.get('symbol')
    if (qModule && MARKET_MODULES.find(m => m.id === qModule)) setActiveModule(qModule)
    if (qSymbol) setActiveSymbol(qSymbol)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const activeMod  = getActiveModule()
  const symbolMeta = getActiveSymbolMeta()
  const isFnO      = activeModuleId === 'fno-india'

  const [capital,    setCapital]    = useState(defaultCapital)
  const [riskPct,    setRiskPct]    = useState(defaultRisk)
  const [direction,  setDirection]  = useState('both')
  const [minGrade,   setMinGrade]   = useState('C')
  const [instrType,  setInstrType]  = useState('futures') // futures | options
  const [optionMeta, setOptionMeta] = useState(null)
  const [futuresMeta, setFuturesMeta] = useState(null)

  const maxRisk = Math.round(capital * (riskPct / 100))

  function handleSubmit(e) {
    e.preventDefault()
    const sym = isFnO && instrType === 'options' && optionMeta
      ? optionMeta.symbol
      : isFnO && instrType === 'futures' && futuresMeta
        ? futuresMeta.symbol
        : (activeSymbol || symbolMeta.symbol)
    onGenerate({
      symbol:    sym,
      exchange:  activeMod.exchange,
      capital,
      riskPct,
      basePrice: optionMeta?.basePrice ?? futuresMeta?.spotPrice ?? symbolMeta.basePrice,
      direction,
      minGrade,
      instrType: isFnO ? instrType : 'spot',
      lotSize:   futuresMeta?.lotSize ?? symbolMeta.lotSize,
      optionMeta:  isFnO && instrType === 'options'  ? optionMeta  : null,
      futuresMeta: isFnO && instrType === 'futures'  ? futuresMeta : null,
    })
  }

  return (
    <form className={styles.inputPanel} onSubmit={handleSubmit} noValidate>
      <div className={styles.panelTitle}>
        <span>Configure Prediction</span>
        <span className={styles.panelMod}>{activeMod.icon} {activeMod.label}</span>
      </div>

      {/* ── Main controls grid ── */}
      <div className={styles.inputGrid}>
        {/* Market module */}
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="pred-module">Market</label>
          <select
            id="pred-module"
            className={styles.select}
            value={activeModuleId}
            onChange={e => setActiveModule(e.target.value)}
            disabled={loading}
          >
            {MARKET_MODULES.map(m => (
              <option key={m.id} value={m.id}>{m.icon} {m.label}</option>
            ))}
          </select>
        </div>

        {/* Symbol picker */}
        <div className={styles.field}>
          <label className={styles.fieldLabel}>
            Symbol <span className={styles.fieldHint}>— ★ to favourite</span>
          </label>
          <SymbolPicker
            value={activeSymbol || symbolMeta.symbol}
            onChange={sym => setActiveSymbol(sym)}
            disabled={loading}
          />
        </div>

        {/* Capital */}
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="pred-capital">Capital (₹)</label>
          <input
            id="pred-capital"
            className={styles.input}
            type="number"
            min={1000}
            max={100000000}
            value={capital}
            onChange={e => setCapital(Number(e.target.value))}
            disabled={loading}
          />
        </div>

        {/* Risk slider */}
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="pred-risk">
            Risk per trade
            <span className={styles.riskPreview}> {riskPct}% = ₹{maxRisk.toLocaleString('en-IN')}</span>
          </label>
          <div className={styles.sliderRow}>
            <input
              id="pred-risk"
              type="range"
              min={0.5} max={5} step={0.5}
              value={riskPct}
              onChange={e => setRiskPct(Number(e.target.value))}
              className={styles.slider}
              disabled={loading}
              aria-valuetext={`${riskPct}% risk, max ₹${maxRisk.toLocaleString('en-IN')}`}
            />
            <span className={styles.sliderVal}>{riskPct}%</span>
          </div>
        </div>

        {/* Direction — radio buttons */}
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Direction</label>
          <div className={styles.radioGroup} role="radiogroup" aria-label="Signal direction">
            {[['both','Both','↕'],['long','Long','▲'],['short','Short','▼']].map(([val, lbl, icon]) => (
              <label
                key={val}
                className={`${styles.radioLabel} ${direction === val ? styles.radioActive : ''} ${val === 'long' ? styles.radioLong : val === 'short' ? styles.radioShort : ''}`}
              >
                <input
                  type="radio"
                  name="direction"
                  value={val}
                  checked={direction === val}
                  onChange={() => setDirection(val)}
                  disabled={loading}
                  className={styles.radioInput}
                />
                <span className={styles.radioIcon} aria-hidden="true">{icon}</span>
                {lbl}
              </label>
            ))}
          </div>
        </div>

        {/* Min grade */}
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="pred-grade">Min Grade</label>
          <select
            id="pred-grade"
            className={styles.select}
            value={minGrade}
            onChange={e => setMinGrade(e.target.value)}
            disabled={loading}
          >
            <option value="A+">A+ only (highest)</option>
            <option value="A">A and above</option>
            <option value="B">B and above</option>
            <option value="C">C and above</option>
            <option value="D">All signals</option>
          </select>
        </div>
      </div>

      {/* ── F&O: Futures vs Options toggle ── */}
      {isFnO && (
        <div className={styles.fnoRow}>
          <span className={styles.fieldLabel}>Instrument</span>
          <div className={styles.segmented} role="group" aria-label="Instrument type">
            {[['futures','Futures'],['options','Options CE/PE']].map(([val, lbl]) => (
              <button
                key={val} type="button"
                className={`${styles.seg} ${instrType === val ? styles.segActive : ''}`}
                onClick={() => setInstrType(val)}
                disabled={loading}
                aria-pressed={instrType === val}
              >{lbl}</button>
            ))}
          </div>
        </div>
      )}

      {/* ── Options panel (F&O only) ── */}
      {isFnO && instrType === 'options' && (
        <OptionsPanel
          underlying={activeSymbol || symbolMeta.symbol}
          basePrice={symbolMeta.basePrice}
          onOptionSelect={setOptionMeta}
        />
      )}

      {/* ── Futures panel (F&O only) ── */}
      {isFnO && instrType === 'futures' && (
        <FuturesPanel
          underlying={activeSymbol || symbolMeta.symbol}
          basePrice={symbolMeta.basePrice}
          onFuturesSelect={setFuturesMeta}
        />
      )}

      {/* ── Footer ── */}
      <div className={styles.panelFooter}>
        <div className={styles.summaryChips}>
          <span className={styles.chip}>{activeMod.exchange}</span>
          <span className={styles.chip}>
            {isFnO && instrType === 'options' && optionMeta
              ? optionMeta.symbol
              : isFnO && instrType === 'futures' && futuresMeta
                ? futuresMeta.symbol
                : (activeSymbol || symbolMeta.symbol)}
          </span>
          <span className={styles.chip}>₹{maxRisk.toLocaleString('en-IN')} max risk</span>
          {isFnO && instrType === 'futures' && futuresMeta && (
            <span className={styles.chip}>
              {futuresMeta.lots}L × {futuresMeta.lotSize} = ₹{futuresMeta.marginRequired?.toLocaleString('en-IN')} margin
            </span>
          )}
          {isFnO && instrType === 'options' && (
            <span className={styles.chip}>Options</span>
          )}
        </div>
        <button className={styles.generateBtn} type="submit" disabled={loading}>
          {loading
            ? <><span className={styles.spinner} aria-hidden="true" /> Generating…</>
            : '⚡ Generate 16 Signals'
          }
        </button>
      </div>
    </form>
  )
}
